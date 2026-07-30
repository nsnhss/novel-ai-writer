use chrono::Utc;
use rusqlite::params;

use crate::db;
use crate::error::AppError;
use crate::models::GenerationHistory;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveGenerationHistoryRequest {
    pub chapter_id: String,
    pub request_type: String,
    pub instruction: Option<String>,
    pub content: String,
    pub rating: Option<i32>,
    pub accepted: Option<bool>,
    pub group_id: Option<String>,
    pub branch_index: Option<i32>,
    pub total_branches: Option<i32>,
}

#[tauri::command]
pub fn save_generation_history(req: SaveGenerationHistoryRequest) -> Result<String, AppError> {
    let conn = db::get_db()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let group_id = req.group_id.as_deref();
    let branch_index = req.branch_index.unwrap_or(0);
    let total_branches = req.total_branches.unwrap_or(1);
    conn.execute(
        "INSERT INTO generation_history (
            id, chapter_id, request_type, instruction, content, rating, accepted,
            group_id, branch_index, total_branches, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            &id,
            &req.chapter_id,
            &req.request_type,
            req.instruction.as_deref().unwrap_or(""),
            &req.content,
            req.rating.unwrap_or(0),
            if req.accepted.unwrap_or(false) { 1 } else { 0 },
            group_id,
            branch_index,
            total_branches,
            &now,
        ],
    )?;
    Ok(id)
}

#[tauri::command]
pub fn list_generation_history(chapter_id: String) -> Result<Vec<GenerationHistory>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, chapter_id, request_type, instruction, content, rating, accepted,
                group_id, branch_index, total_branches, created_at
         FROM generation_history
         WHERE chapter_id = ?1
         ORDER BY created_at DESC
         LIMIT 100",
    )?;
    let rows = stmt
        .query_map([chapter_id], |row| {
            Ok(GenerationHistory {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                request_type: row.get(2)?,
                instruction: row.get(3)?,
                content: row.get(4)?,
                rating: row.get(5)?,
                accepted: row.get(6)?,
                group_id: row.get(7)?,
                branch_index: row.get(8)?,
                total_branches: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn delete_generation_history(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM generation_history WHERE id = ?1", [&id])?;
    Ok(())
}
