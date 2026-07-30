use serde::{Deserialize, Serialize};

use super::{EmbeddingConfig, EmbeddingError, EmbeddingProvider};

pub struct OllamaEmbeddingProvider {
    config: EmbeddingConfig,
    client: reqwest::Client,
}

impl OllamaEmbeddingProvider {
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
struct OllamaEmbedRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

#[async_trait::async_trait]
impl EmbeddingProvider for OllamaEmbeddingProvider {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let url = format!("{}/api/embed", self.config.endpoint.trim_end_matches('/'));

        let request = OllamaEmbedRequest {
            model: self.config.model.clone(),
            input: texts.to_vec(),
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(EmbeddingError::Http)?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(EmbeddingError::Api(format!(
                "HTTP {}: {}",
                status.as_u16(),
                body
            )));
        }

        let data: OllamaEmbedResponse = response
            .json()
            .await
            .map_err(|e| EmbeddingError::Other(format!("响应解析失败: {}", e)))?;

        if data.embeddings.len() != texts.len() {
            return Err(EmbeddingError::Other(format!(
                "返回的 embedding 数量不匹配: 请求 {}, 返回 {}",
                texts.len(),
                data.embeddings.len()
            )));
        }

        for embedding in &data.embeddings {
            if embedding.len() != self.config.dimensions {
                return Err(EmbeddingError::DimensionMismatch {
                    expected: self.config.dimensions,
                    actual: embedding.len(),
                });
            }
        }

        Ok(data.embeddings)
    }

    fn dimensions(&self) -> usize {
        self.config.dimensions
    }

    fn config(&self) -> EmbeddingConfig {
        self.config.clone()
    }
}
