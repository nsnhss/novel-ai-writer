use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::llm::{
    GenerateRequest, GenerateResult, GenerationConfig, GenerationProvider, StreamEvent,
};

pub struct OllamaProvider {
    client: reqwest::Client,
    config: GenerationConfig,
}

impl OllamaProvider {
    pub fn new(config: GenerationConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
        }
    }
}

#[derive(Debug, Serialize)]
struct OllamaGenerateRequest {
    model: String,
    prompt: String,
    system: String,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    temperature: f32,
    top_p: Option<f32>,
    top_k: Option<i32>,
    repeat_penalty: Option<f32>,
    frequency_penalty: Option<f32>,
    num_predict: u32,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    response: Option<String>,
    done: bool,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

#[async_trait]
impl GenerationProvider for OllamaProvider {
    async fn generate_stream(
        &self,
        request: GenerateRequest,
        channel: tauri::ipc::Channel<StreamEvent>,
        cancel_token: CancellationToken,
    ) -> Result<(), AppError> {
        let url = format!(
            "{}/api/generate",
            self.config.endpoint.trim_end_matches('/')
        );

        let body = OllamaGenerateRequest {
            model: self.config.model.clone(),
            prompt: request.user_prompt,
            system: request.system_prompt,
            stream: true,
            options: OllamaOptions {
                temperature: request.temperature.unwrap_or(self.config.temperature),
                top_p: request.top_p.or(self.config.top_p),
                top_k: request.top_k.or(self.config.top_k),
                repeat_penalty: request
                    .repetition_penalty
                    .or(self.config.repetition_penalty),
                frequency_penalty: request.frequency_penalty.or(self.config.frequency_penalty),
                num_predict: request.max_tokens.unwrap_or(self.config.max_tokens),
            },
        };

        if cancel_token.is_cancelled() {
            return Ok(());
        }

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("Ollama 请求失败: {}", e)))?;

        if !response.status().is_success() {
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "未知错误".to_string());
            return Err(AppError::Other(format!("Ollama 返回错误: {}", text)));
        }

        let mut stream = response.bytes_stream();
        let mut input_tokens: Option<u64> = None;
        let mut output_tokens: Option<u64> = None;
        let start_time = Instant::now();

        while let Some(chunk) = stream.next().await {
            if cancel_token.is_cancelled() {
                break;
            }
            let chunk = chunk.map_err(|e| AppError::Other(format!("读取流失败: {}", e)))?;
            let text = String::from_utf8_lossy(&chunk);

            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                match serde_json::from_str::<OllamaGenerateResponse>(line) {
                    Ok(data) => {
                        if let Some(err) = data.error {
                            let _ = channel.send(StreamEvent::Error(err));
                            break;
                        }

                        if let Some(token) = data.response {
                            if !token.is_empty() {
                                let _ = channel.send(StreamEvent::Token(token));
                            }
                        }

                        if let Some(n) = data.prompt_eval_count {
                            input_tokens = Some(n);
                        }
                        if let Some(n) = data.eval_count {
                            output_tokens = Some(n);
                        }

                        if data.done {
                            let latency_ms = start_time.elapsed().as_millis() as u64;
                            let out = output_tokens.unwrap_or(0);
                            let tokens_per_sec = if latency_ms > 0 {
                                out as f64 / (latency_ms as f64 / 1000.0)
                            } else {
                                0.0
                            };
                            let _ = channel.send(StreamEvent::Usage {
                                input_tokens: input_tokens.unwrap_or(0),
                                output_tokens: out,
                                latency_ms,
                                tokens_per_sec,
                            });
                            let _ = channel.send(StreamEvent::Done);
                            return Ok(());
                        }
                    }
                    Err(e) => {
                        // Ignore parse errors for partial lines; Ollama sometimes sends chunks that split JSON.
                        tracing::warn!("解析 Ollama 流行失败: {} | 行: {}", e, line);
                    }
                }
            }
        }

        let latency_ms = start_time.elapsed().as_millis() as u64;
        let out = output_tokens.unwrap_or(0);
        let tokens_per_sec = if latency_ms > 0 {
            out as f64 / (latency_ms as f64 / 1000.0)
        } else {
            0.0
        };
        let _ = channel.send(StreamEvent::Usage {
            input_tokens: input_tokens.unwrap_or(0),
            output_tokens: out,
            latency_ms,
            tokens_per_sec,
        });
        let _ = channel.send(StreamEvent::Done);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<GenerateResult, AppError> {
        let url = format!(
            "{}/api/generate",
            self.config.endpoint.trim_end_matches('/')
        );

        let body = OllamaGenerateRequest {
            model: self.config.model.clone(),
            prompt: request.user_prompt,
            system: request.system_prompt,
            stream: false,
            options: OllamaOptions {
                temperature: request.temperature.unwrap_or(self.config.temperature),
                top_p: request.top_p.or(self.config.top_p),
                top_k: request.top_k.or(self.config.top_k),
                repeat_penalty: request
                    .repetition_penalty
                    .or(self.config.repetition_penalty),
                frequency_penalty: request.frequency_penalty.or(self.config.frequency_penalty),
                num_predict: request.max_tokens.unwrap_or(self.config.max_tokens),
            },
        };

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("Ollama 请求失败: {}", e)))?;

        if !response.status().is_success() {
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "未知错误".to_string());
            return Err(AppError::Other(format!("Ollama 返回错误: {}", text)));
        }

        let data: OllamaGenerateResponse = response
            .json()
            .await
            .map_err(|e| AppError::Other(format!("解析 Ollama 响应失败: {}", e)))?;

        if let Some(err) = data.error {
            return Err(AppError::Other(format!("Ollama 错误: {}", err)));
        }

        Ok(GenerateResult {
            text: data.response.unwrap_or_default(),
            input_tokens: data.prompt_eval_count.unwrap_or(0),
            output_tokens: data.eval_count.unwrap_or(0),
        })
    }

    fn config(&self) -> GenerationConfig {
        self.config.clone()
    }
}
