use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("文件解析错误: {0}")]
    Parse(#[from] crate::parser::ParseError),

    #[error("嵌入模型错误: {0}")]
    Embedding(#[from] crate::embeddings::EmbeddingError),

    #[error("网络请求错误: {0}")]
    Request(#[from] reqwest::Error),

    #[error("任务执行错误: {0}")]
    Join(#[from] tokio::task::JoinError),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ErrorResponse {
    pub error: String,
}
