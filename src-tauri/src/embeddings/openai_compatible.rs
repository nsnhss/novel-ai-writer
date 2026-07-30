use serde::{Deserialize, Serialize};

use super::{EmbeddingConfig, EmbeddingError, EmbeddingProvider};

pub struct OpenAiCompatibleEmbeddingProvider {
    config: EmbeddingConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleEmbeddingProvider {
    pub fn new(config: EmbeddingConfig) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default(),
            config,
        }
    }
}

#[derive(Serialize)]
struct OpenAiEmbeddingRequest {
    model: String,
    input: Vec<String>,
    encoding_format: String,
}

#[derive(Deserialize)]
struct OpenAiEmbeddingResponse {
    data: Vec<OpenAiEmbeddingItem>,
}

#[derive(Deserialize)]
struct OpenAiEmbeddingItem {
    embedding: Vec<f32>,
    index: usize,
}

#[async_trait::async_trait]
impl EmbeddingProvider for OpenAiCompatibleEmbeddingProvider {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let url = format!(
            "{}/v1/embeddings",
            self.config.endpoint.trim_end_matches('/')
        );

        let request = OpenAiEmbeddingRequest {
            model: self.config.model.clone(),
            input: texts.to_vec(),
            encoding_format: "float".to_string(),
        };

        let mut req = self.client.post(&url).json(&request);
        if let Some(key) = &self.config.api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let response = req.send().await.map_err(EmbeddingError::Http)?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(EmbeddingError::Api(format!(
                "HTTP {}: {}",
                status.as_u16(),
                body
            )));
        }

        let mut data: OpenAiEmbeddingResponse = response
            .json()
            .await
            .map_err(|e| EmbeddingError::Other(format!("响应解析失败: {}", e)))?;

        if data.data.len() != texts.len() {
            return Err(EmbeddingError::Other(format!(
                "返回的 embedding 数量不匹配: 请求 {}, 返回 {}",
                texts.len(),
                data.data.len()
            )));
        }

        // OpenAI-compatible responses should preserve order via `index`,
        // but sort just in case.
        data.data.sort_by_key(|item| item.index);

        for item in &data.data {
            if item.embedding.len() != self.config.dimensions {
                return Err(EmbeddingError::DimensionMismatch {
                    expected: self.config.dimensions,
                    actual: item.embedding.len(),
                });
            }
        }

        Ok(data.data.into_iter().map(|item| item.embedding).collect())
    }

    fn dimensions(&self) -> usize {
        self.config.dimensions
    }

    fn config(&self) -> EmbeddingConfig {
        self.config.clone()
    }
}
