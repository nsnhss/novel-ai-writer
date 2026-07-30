use chrono::Utc;
use rusqlite::params;

use crate::db;
use crate::error::AppError;
use crate::models::Anchor;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnchorRequest {
    pub book_id: String,
    pub content: String,
    pub category: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAnchorRequest {
    pub id: String,
    pub content: Option<String>,
    pub category: Option<String>,
    pub is_active: Option<bool>,
}

#[tauri::command]
pub fn list_anchors(book_id: String) -> Result<Vec<Anchor>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, book_id, content, category, is_active, created_at
         FROM anchor
         WHERE book_id = ?1
         ORDER BY is_active DESC, created_at DESC",
    )?;
    let rows = stmt
        .query_map([book_id], |row| {
            Ok(Anchor {
                id: row.get(0)?,
                book_id: row.get(1)?,
                content: row.get(2)?,
                category: row.get(3)?,
                is_active: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_anchor(req: CreateAnchorRequest) -> Result<Anchor, AppError> {
    let conn = db::get_db()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let category = req.category.unwrap_or_else(|| "general".to_string());
    conn.execute(
        "INSERT INTO anchor (id, book_id, content, category, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![&id, &req.book_id, &req.content, &category, &now],
    )?;
    Ok(Anchor {
        id,
        book_id: req.book_id,
        content: req.content,
        category,
        is_active: true,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_anchor(req: UpdateAnchorRequest) -> Result<Anchor, AppError> {
    let conn = db::get_db()?;
    let existing = conn.query_row(
        "SELECT id, book_id, content, category, is_active, created_at
         FROM anchor WHERE id = ?1",
        [&req.id],
        |row| {
            Ok(Anchor {
                id: row.get(0)?,
                book_id: row.get(1)?,
                content: row.get(2)?,
                category: row.get(3)?,
                is_active: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        },
    )?;

    let content = req.content.unwrap_or(existing.content);
    let category = req.category.unwrap_or(existing.category);
    let is_active = req.is_active.unwrap_or(existing.is_active);

    conn.execute(
        "UPDATE anchor SET content = ?1, category = ?2, is_active = ?3 WHERE id = ?4",
        params![&content, &category, if is_active { 1 } else { 0 }, &req.id],
    )?;

    Ok(Anchor {
        id: req.id,
        book_id: existing.book_id,
        content,
        category,
        is_active,
        created_at: existing.created_at,
    })
}

#[tauri::command]
pub fn delete_anchor(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM anchor WHERE id = ?1", [&id])?;
    Ok(())
}
