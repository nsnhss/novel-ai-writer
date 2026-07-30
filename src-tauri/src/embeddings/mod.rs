use rusqlite::params;
use serde::{Deserialize, Serialize};

pub mod ollama;
pub mod openai_compatible;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConfig {
    pub provider: String, // "ollama" | "openai_compatible"
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
    pub dimensions: usize,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            provider: "ollama".to_string(),
            endpoint: "http://localhost:11434".to_string(),
            model: "bge-m3".to_string(),
            api_key: None,
            dimensions: 1024,
        }
    }
}

#[async_trait::async_trait]
pub trait EmbeddingProvider: Send + Sync {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError>;

    fn dimensions(&self) -> usize;

    fn config(&self) -> EmbeddingConfig;
}

#[derive(Debug, thiserror::Error)]
pub enum EmbeddingError {
    #[error("HTTP 请求失败: {0}")]
    Http(#[from] reqwest::Error),

    #[error("API 返回错误: {0}")]
    Api(String),

    #[error("响应解析失败: {0}")]
    Parse(#[from] serde_json::Error),

    #[error("嵌入维度不匹配: 期望 {expected}, 实际 {actual}")]
    DimensionMismatch { expected: usize, actual: usize },

    #[error("Provider 未初始化")]
    NotInitialized,

    #[error("{0}")]
    Other(String),
}

pub fn create_provider(
    config: EmbeddingConfig,
) -> Result<Box<dyn EmbeddingProvider>, crate::error::AppError> {
    match config.provider.as_str() {
        "ollama" => Ok(Box::new(ollama::OllamaEmbeddingProvider::new(config))),
        "openai_compatible" => Ok(Box::new(
            openai_compatible::OpenAiCompatibleEmbeddingProvider::new(config),
        )),
        other => Err(crate::error::AppError::Other(format!(
            "不支持的 embedding provider: {}，仅支持 ollama / openai_compatible",
            other
        ))),
    }
}

const EMBEDDING_CONFIG_KEY: &str = "embedding_config";

pub fn load_embedding_config() -> Result<EmbeddingConfig, crate::error::AppError> {
    let conn = crate::db::get_db()?;
    match conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [EMBEDDING_CONFIG_KEY],
        |row| row.get::<_, String>(0),
    ) {
        Ok(json) => {
            let config: EmbeddingConfig = serde_json::from_str(&json)?;
            Ok(config)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let mut config = EmbeddingConfig::default();
            // E2E 测试钩子: 允许用环境变量覆盖默认 embedding 端点（指向 mock 服务）
            if let Ok(endpoint) = std::env::var("NOVEL_WRITER_TEST_OLLAMA_ENDPOINT") {
                if !endpoint.is_empty() {
                    config.endpoint = endpoint;
                }
            }
            Ok(config)
        }
        Err(e) => Err(e.into()),
    }
}

pub fn save_embedding_config(config: &EmbeddingConfig) -> Result<(), crate::error::AppError> {
    let conn = crate::db::get_db()?;
    let json = serde_json::to_string(config)?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![EMBEDDING_CONFIG_KEY, json],
    )?;
    Ok(())
}
