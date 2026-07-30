use crate::db;
use crate::error::AppError;

const KEYBOARD_SHORTCUTS_KEY: &str = "keyboard_shortcuts";

pub fn default_keyboard_shortcuts() -> String {
    r#"{
        "save": "Ctrl+S",
        "continue": "Ctrl+Enter",
        "rewrite": "Ctrl+Shift+Enter",
        "undo": "Ctrl+Z",
        "redo": "Ctrl+Y",
        "search": "Ctrl+F",
        "close_panel": "Escape"
    }"#
    .to_string()
}

#[tauri::command]
pub fn get_keyboard_shortcuts() -> Result<String, AppError> {
    let conn = db::get_db()?;
    match conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [KEYBOARD_SHORTCUTS_KEY],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(default_keyboard_shortcuts()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn set_keyboard_shortcuts(shortcuts: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [KEYBOARD_SHORTCUTS_KEY, &shortcuts],
    )?;
    Ok(())
}
