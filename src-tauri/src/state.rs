use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use crate::commands::ai_model::{credential_entry, get_ai_model, get_default_ai_model};
use crate::embeddings::{create_provider, EmbeddingProvider};
use crate::error::AppError;
use crate::llm::{
    create_provider as create_generation_provider, GenerationConfig, GenerationProvider,
};
use crate::vectordb::VectorStore;

pub struct AppState {
    pub embedding_provider: Arc<dyn EmbeddingProvider>,
    pub generation_provider: RwLock<Arc<dyn GenerationProvider>>,
    pub current_model_id: RwLock<String>,
    pub generation_cancel: Mutex<HashMap<String, CancellationToken>>,
    pub vector_store: Mutex<Option<Arc<VectorStore>>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub async fn new(data_dir: PathBuf) -> Result<Self, AppError> {
        let embedding_config =
            tokio::task::spawn_blocking(crate::embeddings::load_embedding_config)
                .await
                .map_err(|e| AppError::Other(format!("加载嵌入配置失败: {}", e)))??;
        let embedding_provider: Arc<dyn EmbeddingProvider> =
            Arc::from(create_provider(embedding_config)?);

        let vector_store =
            Arc::new(VectorStore::open(&data_dir, embedding_provider.dimensions()).await?);
        let vector_store_warmup = vector_store.clone();
        tokio::spawn(async move {
            let _ = vector_store_warmup.ensure_loaded().await;
        });

        // Load or create the default AI model.
        let (model_id, generation_provider) = tokio::task::spawn_blocking(|| -> Result<(String, Arc<dyn GenerationProvider>), AppError> {
            let default = get_default_ai_model()?;
            let model = match default {
                Some(m) => m,
                None => {
                    let now = chrono::Utc::now().to_rfc3339();
                    let id = uuid::Uuid::new_v4().to_string();
                    // E2E 测试钩子: 允许用环境变量覆盖默认模型端点（指向 mock 服务）
                    let default_endpoint = std::env::var("NOVEL_WRITER_TEST_OLLAMA_ENDPOINT")
                        .ok()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "http://localhost:11434".to_string());
                    {
                        let conn = crate::db::get_db()?;
                        conn.execute(
                            "INSERT INTO ai_model (
                                id, name, provider, endpoint, api_key_ref, model_name, parameters, recommended_for, is_default, created_at
                            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                            rusqlite::params![
                                &id,
                                "Ollama qwen2.5",
                                "ollama",
                                &default_endpoint,
                                Option::<&str>::None,
                                "qwen2.5",
                                "{}",
                                "",
                                1,
                                &now
                            ],
                        )?;
                    }
                    crate::commands::ai_model::get_ai_model(id)?
                }
            };
            let config = generation_config_from_model(&model)?;
            Ok((model.id, Arc::from(create_generation_provider(config)) as Arc<dyn GenerationProvider>))
        }).await??;

        Ok(Self {
            embedding_provider,
            generation_provider: RwLock::new(generation_provider),
            current_model_id: RwLock::new(model_id),
            generation_cancel: Mutex::new(HashMap::new()),
            vector_store: Mutex::new(Some(vector_store)),
            data_dir,
        })
    }

    pub async fn vector_store(&self) -> Result<Arc<VectorStore>, AppError> {
        let guard = self.vector_store.lock().await;
        guard
            .clone()
            .ok_or_else(|| AppError::Other("向量数据库未初始化".to_string()))
    }

    /// Switch the active generation provider to the given ai_model id.
    pub async fn switch_generation_provider(&self, model_id: &str) -> Result<(), AppError> {
        let new_provider = tokio::task::spawn_blocking({
            let model_id = model_id.to_string();
            move || -> Result<Arc<dyn GenerationProvider>, AppError> {
                let model = get_ai_model(model_id)?;
                let config = generation_config_from_model(&model)?;
                Ok(Arc::from(create_generation_provider(config)) as Arc<dyn GenerationProvider>)
            }
        })
        .await??;

        let mut provider_guard = self.generation_provider.write().await;
        *provider_guard = new_provider;
        let mut id_guard = self.current_model_id.write().await;
        *id_guard = model_id.to_string();
        Ok(())
    }

    pub async fn get_current_model_id(&self) -> String {
        self.current_model_id.read().await.clone()
    }
}

fn generation_config_from_model(
    model: &crate::models::AiModel,
) -> Result<GenerationConfig, AppError> {
    let params: serde_json::Value = serde_json::from_str(&model.parameters).unwrap_or_default();

    let api_key = credential_entry(&model.id)
        .ok()
        .and_then(|entry| entry.get_password().ok());

    let mut config = GenerationConfig {
        provider: model.provider.clone(),
        endpoint: model.endpoint.clone(),
        model: model.model_name.clone(),
        api_key,
        max_tokens: params["max_tokens"].as_u64().unwrap_or(2000) as u32,
        temperature: params["temperature"].as_f64().unwrap_or(0.7) as f32,
        top_p: params["top_p"].as_f64().map(|v| v as f32),
        top_k: params["top_k"].as_i64().map(|v| v as i32),
        repetition_penalty: params["repetition_penalty"].as_f64().map(|v| v as f32),
        frequency_penalty: params["frequency_penalty"].as_f64().map(|v| v as f32),
    };

    // Ensure openai_compatible provider has an endpoint and key.
    if config.provider == "openai_compatible" {
        if config.endpoint.is_empty() {
            config.endpoint = "https://api.deepseek.com".to_string();
        }
        if config.api_key.is_none() {
            return Err(AppError::Other(format!(
                "模型 {} 未配置 API Key",
                model.name
            )));
        }
    }

    Ok(config)
}
