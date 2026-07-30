use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::llm::GenerateRequest;
use crate::state::AppState;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyStateSnapshot {
    pub position: String,
    pub clothing: std::collections::HashMap<String, String>,
    pub contact: Vec<String>,
    pub happened: Vec<String>,
    pub ongoing: String,
}

const BODY_STATE_PROMPT: &str = r#"请从以下小说段落中提取当前的身体/动作状态，严格输出 JSON，不要任何解释。
JSON 格式：
{
  "position": "人物相对位置",
  "clothing": {"女性": "女性衣物状态", "男性": "男性衣物状态"},
  "contact": ["身体接触点1", "身体接触点2"],
  "happened": ["已经发生的亲密行为"],
  "ongoing": "当前正在进行中的动作"
}
如果段落中没有相关信息，请使用空字符串或空数组。

段落：
{text}
"#;

/// Extract and persist the latest body-state snapshot for a chapter.
#[tauri::command]
pub async fn extract_body_state(
    chapter_id: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }

    let snapshot = match llm_extract(text, state).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("身体状态提取失败: {}", e);
            return Ok(());
        }
    };

    let snapshot_json = serde_json::to_string(&snapshot)?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        let conn = crate::db::get_db()?;
        conn.execute(
            "INSERT INTO chapter_body_state (id, chapter_id, snapshot, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(chapter_id) DO UPDATE SET
                 snapshot = excluded.snapshot,
                 updated_at = excluded.updated_at",
            params![&id, &chapter_id, &snapshot_json, &now],
        )?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("保存身体状态失败: {}", e)))??;

    Ok(())
}

async fn llm_extract(
    text: &str,
    state: State<'_, AppState>,
) -> Result<BodyStateSnapshot, AppError> {
    let prompt = BODY_STATE_PROMPT.replace("{text}", text);
    let provider = state.generation_provider.read().await;
    let res = provider
        .generate(GenerateRequest {
            request_type: "body_state_extract".to_string(),
            system_prompt: "你是专注物理一致性的文学分析助手，只输出合法 JSON。".to_string(),
            user_prompt: prompt,
            max_tokens: Some(400),
            temperature: Some(0.3),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;

    let trimmed = res.text.trim();
    let json_text = if trimmed.starts_with("```") {
        trimmed
            .lines()
            .skip_while(|l| l.starts_with("```"))
            .take_while(|l| !l.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        trimmed.to_string()
    };

    serde_json::from_str(&json_text)
        .map_err(|e| AppError::Other(format!("解析身体状态失败: {} | {}", e, json_text)))
}

/// Return the persisted body-state snapshot for a chapter, if any.
#[tauri::command]
pub fn get_latest_body_state(chapter_id: String) -> Result<Option<String>, AppError> {
    let conn = crate::db::get_db()?;
    let snapshot: Option<String> = conn
        .query_row(
            "SELECT snapshot FROM chapter_body_state WHERE chapter_id = ?1",
            [&chapter_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(snapshot)
}
