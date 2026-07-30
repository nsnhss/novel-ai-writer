use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::models::SceneTemplate;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateSceneTemplateRequest {
    pub name: String,
    pub category: String,
    pub prompt_template: String,
    #[serde(default)]
    pub is_adult: bool,
    #[serde(default)]
    pub adult_prompt: String,
    #[serde(default)]
    pub beats: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSceneTemplateRequest {
    pub id: String,
    pub name: Option<String>,
    pub category: Option<String>,
    pub prompt_template: Option<String>,
    pub is_adult: Option<bool>,
    pub adult_prompt: Option<String>,
    pub beats: Option<String>,
}

fn row_to_template(row: &rusqlite::Row) -> Result<SceneTemplate, rusqlite::Error> {
    Ok(SceneTemplate {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        prompt_template: row.get(3)?,
        is_adult: row.get::<_, i32>(4)? != 0,
        adult_prompt: row.get(5)?,
        beats: row.get(6)?,
        is_builtin: row.get::<_, i32>(7)? != 0,
        created_at: row.get(8)?,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn list_scene_templates(
    categoryFilter: Option<String>,
) -> Result<Vec<SceneTemplate>, AppError> {
    let conn = db::get_db()?;
    let (sql, params) = match categoryFilter {
        Some(cat) => (
            "SELECT id, name, category, prompt_template, is_adult, adult_prompt, beats, is_builtin, created_at FROM scene_template WHERE category = ?1 ORDER BY name",
            vec![cat],
        ),
        None => (
            "SELECT id, name, category, prompt_template, is_adult, adult_prompt, beats, is_builtin, created_at FROM scene_template ORDER BY name",
            vec![],
        ),
    };
    let mut stmt = conn.prepare(sql)?;
    let templates = stmt
        .query_map(rusqlite::params_from_iter(params), row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(templates)
}

#[tauri::command]
pub fn get_scene_template(id: String) -> Result<SceneTemplate, AppError> {
    let conn = db::get_db()?;
    let template = conn.query_row(
        "SELECT id, name, category, prompt_template, is_adult, adult_prompt, beats, is_builtin, created_at FROM scene_template WHERE id = ?1",
        [&id],
        row_to_template,
    )?;
    Ok(template)
}

#[tauri::command]
pub fn create_scene_template(req: CreateSceneTemplateRequest) -> Result<SceneTemplate, AppError> {
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO scene_template (id, name, category, prompt_template, is_adult, adult_prompt, beats, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
        params![&id, &req.name, &req.category, &req.prompt_template, req.is_adult as i32, &req.adult_prompt, &req.beats, &now],
    )?;
    Ok(SceneTemplate {
        id,
        name: req.name,
        category: req.category,
        prompt_template: req.prompt_template,
        is_adult: req.is_adult,
        adult_prompt: req.adult_prompt,
        beats: req.beats,
        is_builtin: false,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_scene_template(req: UpdateSceneTemplateRequest) -> Result<SceneTemplate, AppError> {
    let existing = get_scene_template(req.id.clone())?;
    let name = req.name.unwrap_or(existing.name);
    let category = req.category.unwrap_or(existing.category);
    let prompt_template = req.prompt_template.unwrap_or(existing.prompt_template);
    let is_adult = req.is_adult.unwrap_or(existing.is_adult);
    let adult_prompt = req.adult_prompt.unwrap_or(existing.adult_prompt);
    let beats = req.beats.unwrap_or(existing.beats);

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE scene_template SET name = ?1, category = ?2, prompt_template = ?3, is_adult = ?4, adult_prompt = ?5, beats = ?6 WHERE id = ?7",
            params![&name, &category, &prompt_template, is_adult as i32, &adult_prompt, &beats, &req.id],
        )?;
    }
    get_scene_template(req.id)
}

#[tauri::command]
pub fn delete_scene_template(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM scene_template WHERE id = ?1", [&id])?;
    Ok(())
}

#[tauri::command]
pub fn list_scene_template_categories() -> Result<Vec<String>, AppError> {
    let conn = db::get_db()?;
    let mut stmt =
        conn.prepare("SELECT DISTINCT category FROM scene_template ORDER BY category")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
