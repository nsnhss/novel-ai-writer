use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

pub mod ollama;
pub mod openai_compatible;

/// Events streamed from the LLM provider to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum StreamEvent {
    Token(String),
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        latency_ms: u64,
        tokens_per_sec: f64,
    },
    Error(String),
    Done,
}

/// Configuration for a generation provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationConfig {
    pub provider: String, // "ollama" | "openai_compatible"
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub repetition_penalty: Option<f32>,
    pub frequency_penalty: Option<f32>,
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            provider: "ollama".to_string(),
            endpoint: "http://localhost:11434".to_string(),
            model: "qwen2.5".to_string(),
            api_key: None,
            max_tokens: 2000,
            temperature: 0.7,
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        }
    }
}

/// A single request to generate text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub request_type: String, // "continue" | "rewrite" | "outline" | "chat"
    pub system_prompt: String,
    pub user_prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub repetition_penalty: Option<f32>,
    pub frequency_penalty: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct GenerateResult {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[async_trait]
pub trait GenerationProvider: Send + Sync {
    /// Stream generation tokens through the given channel.
    async fn generate_stream(
        &self,
        request: GenerateRequest,
        channel: tauri::ipc::Channel<StreamEvent>,
        cancel_token: CancellationToken,
    ) -> Result<(), AppError>;

    /// Non-streaming generation. Used for summaries and analysis.
    async fn generate(&self, request: GenerateRequest) -> Result<GenerateResult, AppError>;

    fn config(&self) -> GenerationConfig;
}

pub fn create_provider(config: GenerationConfig) -> Box<dyn GenerationProvider> {
    match config.provider.as_str() {
        "ollama" => Box::new(ollama::OllamaProvider::new(config)),
        "openai_compatible" => Box::new(openai_compatible::OpenAiCompatibleProvider::new(config)),
        other => panic!(
            "Unknown generation provider: {}. Use 'ollama' or 'openai_compatible'.",
            other
        ),
    }
}
