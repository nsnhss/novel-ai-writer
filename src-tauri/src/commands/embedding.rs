use serde::{Deserialize, Serialize};

use crate::embeddings::{self, EmbeddingConfig};
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConfigView {
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub has_api_key: bool,
    pub dimensions: usize,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetEmbeddingConfigRequest {
    pub provider: String,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub dimensions: Option<usize>,
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    match provider {
        "ollama" | "openai_compatible" => Ok(()),
        _ => Err(AppError::Other(format!(
            "不支持的 embedding provider: {}，仅支持 ollama / openai_compatible",
            provider
        ))),
    }
}

fn effective_endpoint(provider: &str, endpoint: &str) -> String {
    if endpoint.trim().is_empty() {
        match provider {
            "ollama" => "http://localhost:11434".to_string(),
            _ => "https://api.deepseek.com".to_string(),
        }
    } else {
        endpoint.to_string()
    }
}

fn config_to_view(config: &EmbeddingConfig) -> EmbeddingConfigView {
    EmbeddingConfigView {
        provider: config.provider.clone(),
        endpoint: config.endpoint.clone(),
        model: config.model.clone(),
        has_api_key: config
            .api_key
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false),
        dimensions: config.dimensions,
    }
}

#[tauri::command]
pub fn get_embedding_config() -> Result<EmbeddingConfigView, AppError> {
    let config = embeddings::load_embedding_config()?;
    Ok(config_to_view(&config))
}

#[tauri::command]
pub fn set_embedding_config(
    req: SetEmbeddingConfigRequest,
) -> Result<EmbeddingConfigView, AppError> {
    let mut config = embeddings::load_embedding_config()?;

    validate_provider(&req.provider)?;
    config.provider = req.provider;

    if let Some(endpoint) = req.endpoint {
        config.endpoint = effective_endpoint(&config.provider, &endpoint);
    }
    if let Some(model) = req.model {
        config.model = model;
    }
    if let Some(dimensions) = req.dimensions {
        config.dimensions = dimensions;
    }
    if let Some(key) = req.api_key {
        config.api_key = if key.trim().is_empty() {
            None
        } else {
            Some(key)
        };
    }

    embeddings::save_embedding_config(&config)?;
    Ok(config_to_view(&config))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestEmbeddingResult {
    pub ok: bool,
    pub error: Option<String>,
    pub dimensions: Option<usize>,
}

#[tauri::command]
pub async fn test_embedding_connection(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<TestEmbeddingResult, AppError> {
    match state
        .embedding_provider
        .embed(&["测试文本".to_string()])
        .await
    {
        Ok(embeddings) => Ok(TestEmbeddingResult {
            ok: true,
            error: None,
            dimensions: embeddings.first().map(|e| e.len()),
        }),
        Err(e) => Ok(TestEmbeddingResult {
            ok: false,
            error: Some(e.to_string()),
            dimensions: None,
        }),
    }
}
