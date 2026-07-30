use crate::db;
use crate::error::AppError;

const GENERATION_PARAMS_KEY: &str = "generation_parameters";

pub fn default_generation_params() -> String {
    r#"{"temperature":0.7,"topP":0.9,"maxTokens":2000}"#.to_string()
}

#[tauri::command]
pub fn get_generation_params() -> Result<String, AppError> {
    let conn = db::get_db()?;
    match conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [GENERATION_PARAMS_KEY],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(default_generation_params()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn set_generation_params(params: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [GENERATION_PARAMS_KEY, &params],
    )?;
    Ok(())
}
