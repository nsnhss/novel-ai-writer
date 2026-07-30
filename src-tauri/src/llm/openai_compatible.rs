use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::llm::{
    GenerateRequest, GenerateResult, GenerationConfig, GenerationProvider, StreamEvent,
};

pub struct OpenAiCompatibleProvider {
    client: reqwest::Client,
    config: GenerationConfig,
}

impl OpenAiCompatibleProvider {
    pub fn new(config: GenerationConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
        }
    }
}

#[derive(Debug, Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    stream: bool,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    frequency_penalty: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiDelta,
}

#[derive(Debug, Deserialize, Default)]
struct OpenAiDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamResponse {
    choices: Option<Vec<OpenAiStreamChoice>>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    usage: OpenAiUsage,
}

#[async_trait]
impl GenerationProvider for OpenAiCompatibleProvider {
    async fn generate_stream(
        &self,
        request: GenerateRequest,
        channel: tauri::ipc::Channel<StreamEvent>,
        cancel_token: CancellationToken,
    ) -> Result<(), AppError> {
        let url = format!(
            "{}/v1/chat/completions",
            self.config.endpoint.trim_end_matches('/')
        );

        let body = OpenAiChatRequest {
            model: self.config.model.clone(),
            messages: vec![
                OpenAiMessage {
                    role: "system".to_string(),
                    content: request.system_prompt,
                },
                OpenAiMessage {
                    role: "user".to_string(),
                    content: request.user_prompt,
                },
            ],
            stream: true,
            max_tokens: request.max_tokens.or(Some(self.config.max_tokens)),
            temperature: request.temperature.or(Some(self.config.temperature)),
            top_p: request.top_p.or(self.config.top_p),
            frequency_penalty: request.frequency_penalty.or(self.config.frequency_penalty),
        };

        let mut builder = self.client.post(&url).json(&body);
        if let Some(ref key) = self.config.api_key {
            builder = builder.header("Authorization", format!("Bearer {}", key));
        }

        if cancel_token.is_cancelled() {
            return Ok(());
        }

        let response = builder
            .send()
            .await
            .map_err(|e| AppError::Other(format!("API 请求失败: {}", e)))?;

        if !response.status().is_success() {
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "未知错误".to_string());
            return Err(AppError::Other(format!("API 返回错误: {}", text)));
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
                if line.is_empty() || line == ":" {
                    continue;
                }

                if !line.starts_with("data: ") {
                    continue;
                }

                let data = &line[6..];
                if data == "[DONE]" {
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

                match serde_json::from_str::<OpenAiStreamResponse>(data) {
                    Ok(resp) => {
                        if let Some(usage) = resp.usage {
                            input_tokens = Some(usage.prompt_tokens);
                            output_tokens = Some(usage.completion_tokens);
                        }

                        if let Some(choices) = resp.choices {
                            for choice in choices {
                                if let Some(content) = choice.delta.content {
                                    if !content.is_empty() {
                                        let _ = channel.send(StreamEvent::Token(content));
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("解析 SSE 数据失败: {} | 数据: {}", e, data);
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
            "{}/v1/chat/completions",
            self.config.endpoint.trim_end_matches('/')
        );

        let body = OpenAiChatRequest {
            model: self.config.model.clone(),
            messages: vec![
                OpenAiMessage {
                    role: "system".to_string(),
                    content: request.system_prompt,
                },
                OpenAiMessage {
                    role: "user".to_string(),
                    content: request.user_prompt,
                },
            ],
            stream: false,
            max_tokens: request.max_tokens.or(Some(self.config.max_tokens)),
            temperature: request.temperature.or(Some(self.config.temperature)),
            top_p: request.top_p.or(self.config.top_p),
            frequency_penalty: request.frequency_penalty.or(self.config.frequency_penalty),
        };

        let mut builder = self.client.post(&url).json(&body);
        if let Some(ref key) = self.config.api_key {
            builder = builder.header("Authorization", format!("Bearer {}", key));
        }

        let response = builder
            .send()
            .await
            .map_err(|e| AppError::Other(format!("API 请求失败: {}", e)))?;

        if !response.status().is_success() {
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "未知错误".to_string());
            return Err(AppError::Other(format!("API 返回错误: {}", text)));
        }

        let data: OpenAiChatResponse = response
            .json()
            .await
            .map_err(|e| AppError::Other(format!("解析 API 响应失败: {}", e)))?;

        let text = data
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();

        Ok(GenerateResult {
            text,
            input_tokens: data.usage.prompt_tokens,
            output_tokens: data.usage.completion_tokens,
        })
    }

    fn config(&self) -> GenerationConfig {
        self.config.clone()
    }
}
