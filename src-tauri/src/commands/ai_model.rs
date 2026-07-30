use std::time::Duration;

use chrono::Utc;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::models::AiModel;
use crate::state::AppState;

const KEYRING_SERVICE: &str = "novel-ai-writer";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateAiModelRequest {
    pub name: String,
    pub provider: String, // "ollama" | "openai_compatible"
    pub endpoint: Option<String>,
    pub model_name: String,
    pub parameters: Option<String>, // JSON string
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAiModelRequest {
    pub id: String,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub endpoint: Option<String>,
    pub model_name: Option<String>,
    pub parameters: Option<String>,
}

pub(crate) fn credential_entry(model_id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(KEYRING_SERVICE, model_id)
        .map_err(|e| AppError::Other(format!("无法访问凭据管理器: {}", e)))
}

fn default_endpoint(provider: &str) -> String {
    match provider {
        "ollama" => "http://localhost:11434".to_string(),
        _ => "https://api.deepseek.com".to_string(),
    }
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    match provider {
        "ollama" | "openai_compatible" => Ok(()),
        _ => Err(AppError::Other(format!(
            "不支持的 provider: {}，仅支持 ollama / openai_compatible",
            provider
        ))),
    }
}

fn effective_endpoint(provider: &str, endpoint: &str) -> String {
    if endpoint.trim().is_empty() {
        default_endpoint(provider)
    } else {
        endpoint.to_string()
    }
}

fn row_to_model(row: &rusqlite::Row) -> Result<AiModel, rusqlite::Error> {
    Ok(AiModel {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: row.get(2)?,
        endpoint: row.get(3)?,
        api_key_ref: row.get::<_, Option<String>>(4)?,
        model_name: row.get(5)?,
        parameters: row.get(6)?,
        recommended_for: row.get(7)?,
        is_default: row.get::<_, i32>(8)? != 0,
        created_at: row.get(9)?,
    })
}

#[tauri::command]
pub fn list_ai_models() -> Result<Vec<AiModel>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, provider, endpoint, api_key_ref, model_name, parameters, recommended_for, is_default, created_at
         FROM ai_model ORDER BY is_default DESC, name ASC",
    )?;
    let models = stmt
        .query_map([], row_to_model)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(models)
}

#[tauri::command]
pub fn get_ai_model(id: String) -> Result<AiModel, AppError> {
    let conn = db::get_db()?;
    let model = conn.query_row(
        "SELECT id, name, provider, endpoint, api_key_ref, model_name, parameters, recommended_for, is_default, created_at
         FROM ai_model WHERE id = ?1",
        [&id],
        row_to_model,
    )?;
    Ok(model)
}

#[tauri::command]
pub fn get_default_ai_model() -> Result<Option<AiModel>, AppError> {
    let conn = db::get_db()?;
    let model = conn
        .query_row(
            "SELECT id, name, provider, endpoint, api_key_ref, model_name, parameters, recommended_for, is_default, created_at
             FROM ai_model WHERE is_default = 1 LIMIT 1",
            [],
            row_to_model,
        )
        .optional()?;
    Ok(model)
}

#[tauri::command]
pub fn create_ai_model(req: CreateAiModelRequest) -> Result<AiModel, AppError> {
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    validate_provider(&req.provider)?;
    let endpoint = req
        .endpoint
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_endpoint(&req.provider));
    let parameters = req.parameters.unwrap_or_else(|| "{}".to_string());

    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO ai_model (
            id, name, provider, endpoint, api_key_ref, model_name, parameters, recommended_for, is_default, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            &id,
            &req.name,
            &req.provider,
            &endpoint,
            Option::<&str>::None,
            &req.model_name,
            &parameters,
            "",
            0,
            &now
        ],
    )?;

    Ok(AiModel {
        id,
        name: req.name,
        provider: req.provider,
        endpoint,
        api_key_ref: None,
        model_name: req.model_name,
        parameters,
        recommended_for: "".to_string(),
        is_default: false,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_ai_model(req: UpdateAiModelRequest) -> Result<AiModel, AppError> {
    let existing = get_ai_model(req.id.clone())?;

    let name = req.name.unwrap_or(existing.name);
    let provider_changed = req.provider.is_some();
    let provider = req.provider.unwrap_or(existing.provider);
    validate_provider(&provider)?;
    let endpoint = req
        .endpoint
        .map(|e| effective_endpoint(&provider, &e))
        .unwrap_or_else(|| {
            if provider_changed {
                default_endpoint(&provider)
            } else {
                existing.endpoint
            }
        });
    let model_name = req.model_name.unwrap_or(existing.model_name);
    let parameters = req.parameters.unwrap_or(existing.parameters);

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE ai_model SET
                name = ?1,
                provider = ?2,
                endpoint = ?3,
                model_name = ?4,
                parameters = ?5
             WHERE id = ?6",
            params![
                &name,
                &provider,
                &endpoint,
                &model_name,
                &parameters,
                &req.id
            ],
        )?;
    }

    get_ai_model(req.id)
}

#[tauri::command]
pub fn delete_ai_model(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM ai_model WHERE id = ?1", [&id])?;
    if let Ok(entry) = credential_entry(&id) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[tauri::command]
pub fn set_default_ai_model(id: String) -> Result<AiModel, AppError> {
    {
        let mut conn = db::get_db()?;
        let tx = conn.transaction()?;
        tx.execute("UPDATE ai_model SET is_default = 0", [])?;
        tx.execute("UPDATE ai_model SET is_default = 1 WHERE id = ?1", [&id])?;
        tx.commit()?;
    }
    get_ai_model(id)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn set_model_api_key(modelId: String, apiKey: String) -> Result<(), AppError> {
    let entry = credential_entry(&modelId)?;
    entry
        .set_password(&apiKey)
        .map_err(|e| AppError::Other(format!("保存 API Key 失败: {}", e)))?;

    let conn = db::get_db()?;
    conn.execute(
        "UPDATE ai_model SET api_key_ref = ?1 WHERE id = ?2",
        params![&modelId, &modelId],
    )?;
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn has_model_api_key(modelId: String) -> Result<bool, AppError> {
    let entry = credential_entry(&modelId)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::Other(format!("读取 API Key 失败: {}", e))),
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
}

/// Check whether Ollama is running on the default localhost endpoint and list installed models.
#[tauri::command]
pub async fn check_ollama_status() -> Result<OllamaStatus, AppError> {
    let client = reqwest::Client::new();
    match client
        .get("http://localhost:11434/api/tags")
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let json: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = json
                .get("models")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(OllamaStatus {
                available: true,
                models,
            })
        }
        _ => Ok(OllamaStatus {
            available: false,
            models: vec![],
        }),
    }
}

/// Return a reachable Ollama-backed ai_model if one exists, or None.
pub async fn find_reachable_ollama_model() -> Result<Option<AiModel>, AppError> {
    let status = check_ollama_status().await?;
    if !status.available {
        return Ok(None);
    }

    tokio::task::spawn_blocking(|| {
        let models = list_ai_models()?;
        let default = get_default_ai_model()?;
        if let Some(d) = default {
            if d.provider == "ollama" {
                return Ok(Some(d));
            }
        }
        Ok(models.into_iter().find(|m| m.provider == "ollama"))
    })
    .await?
}

#[tauri::command]
pub async fn test_ai_model_connection(id: String) -> Result<TestConnectionResult, AppError> {
    let model = tokio::task::spawn_blocking(|| get_ai_model(id)).await??;
    let client = reqwest::Client::new();
    let endpoint = effective_endpoint(&model.provider, &model.endpoint);

    match model.provider.as_str() {
        "ollama" => {
            let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
            match client.get(&url).send().await {
                Ok(resp) => Ok(TestConnectionResult {
                    ok: resp.status().is_success(),
                    error: None,
                }),
                Err(e) => Ok(TestConnectionResult {
                    ok: false,
                    error: Some(e.to_string()),
                }),
            }
        }
        _ => {
            let url = format!("{}/v1/models", endpoint.trim_end_matches('/'));
            let mut req = client.get(&url);
            if let Ok(entry) = credential_entry(&model.id) {
                if let Ok(key) = entry.get_password() {
                    req = req.header("Authorization", format!("Bearer {}", key));
                }
            }
            match req.send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        Ok(TestConnectionResult {
                            ok: true,
                            error: None,
                        })
                    } else {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        Ok(TestConnectionResult {
                            ok: false,
                            error: Some(format!("HTTP {}: {}", status, body)),
                        })
                    }
                }
                Err(e) => Ok(TestConnectionResult {
                    ok: false,
                    error: Some(e.to_string()),
                }),
            }
        }
    }
}

#[tauri::command]
pub async fn get_current_ai_model(state: State<'_, AppState>) -> Result<Option<AiModel>, AppError> {
    let model_id = state.get_current_model_id().await;
    if model_id.is_empty() {
        return Ok(None);
    }
    match tokio::task::spawn_blocking(move || get_ai_model(model_id)).await? {
        Ok(model) => Ok(Some(model)),
        Err(AppError::Database(rusqlite::Error::QueryReturnedNoRows)) => Ok(None),
        Err(AppError::NotFound(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn switch_generation_model(
    id: String,
    state: State<'_, AppState>,
) -> Result<AiModel, AppError> {
    state.switch_generation_provider(&id).await?;
    let model = tokio::task::spawn_blocking(move || get_ai_model(id)).await??;
    Ok(model)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecommendation {
    pub name: String,
    pub provider: String,
    #[serde(alias = "model")]
    pub model_name: String,
    #[serde(default)]
    pub endpoint: Option<String>,
    pub score: f64,
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub sample_output: Option<String>,
}

#[tauri::command]
pub fn list_model_recommendations() -> Result<Vec<ModelRecommendation>, AppError> {
    let conn = db::get_db()?;
    let json: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'extension_model_recommendations'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".to_string());
    let recommendations: Vec<ModelRecommendation> = serde_json::from_str(&json).unwrap_or_default();
    Ok(recommendations)
}
