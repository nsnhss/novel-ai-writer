use tauri::State;

use crate::context::{assemble_context, render_context, ContextPayload, ContextRequest};
use crate::db;
use crate::error::AppError;
use crate::state::AppState;

const SYSTEM_PROMPT_TEMPLATE_KEY: &str = "system_prompt_template";
const FORBIDDEN_TOPICS_KEY: &str = "forbidden_topics";
const ADULT_MODE_KEY: &str = "adult_mode";

fn get_app_config(key: &str) -> Result<Option<String>, AppError> {
    let conn = db::get_db()?;
    match conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn set_app_config(key: &str, value: &str) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_system_prompt_template() -> Result<String, AppError> {
    Ok(get_app_config(SYSTEM_PROMPT_TEMPLATE_KEY)?.unwrap_or_default())
}

#[tauri::command]
pub fn set_system_prompt_template(template: String) -> Result<(), AppError> {
    set_app_config(SYSTEM_PROMPT_TEMPLATE_KEY, &template)
}

#[tauri::command]
pub fn get_forbidden_topics() -> Result<String, AppError> {
    Ok(get_app_config(FORBIDDEN_TOPICS_KEY)?.unwrap_or_default())
}

#[tauri::command]
pub fn set_forbidden_topics(topics: String) -> Result<(), AppError> {
    set_app_config(FORBIDDEN_TOPICS_KEY, &topics)
}

#[tauri::command]
pub fn get_adult_mode() -> Result<bool, AppError> {
    Ok(get_app_config(ADULT_MODE_KEY)?
        .map(|v| v == "1")
        .unwrap_or(false))
}

#[tauri::command]
pub fn set_adult_mode(enabled: bool) -> Result<(), AppError> {
    set_app_config(ADULT_MODE_KEY, if enabled { "1" } else { "0" })
}

#[tauri::command]
pub async fn get_writing_context(
    req: ContextRequest,
    state: State<'_, AppState>,
) -> Result<ContextPayload, AppError> {
    let vector_store = state.vector_store().await?;
    assemble_context(&req, &vector_store, state.embedding_provider.as_ref()).await
}

#[tauri::command]
pub async fn render_writing_context(
    req: ContextRequest,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let vector_store = state.vector_store().await?;
    let payload = assemble_context(&req, &vector_store, state.embedding_provider.as_ref()).await?;
    Ok(render_context(&payload))
}
