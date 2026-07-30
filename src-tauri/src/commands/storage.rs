use serde::Serialize;
use tauri::State;

use crate::db;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbEncryptionStatus {
    pub enabled: bool,
    pub has_key: bool,
    pub cipher_version: Option<String>,
}

#[tauri::command]
pub fn get_db_encryption_status() -> Result<DbEncryptionStatus, AppError> {
    let conn = db::get_db()?;
    let enabled = db::get_app_config_bool(&conn, "db_encrypted").unwrap_or(false);
    let has_key = db::get_db_passphrase()?.is_some();
    let mut cipher_version: Option<String> = None;
    let _ = conn.pragma_query(None, "cipher_version", |row| {
        cipher_version = row.get::<_, String>(0).ok();
        Ok(())
    });
    Ok(DbEncryptionStatus {
        enabled,
        has_key,
        cipher_version,
    })
}

#[tauri::command]
pub fn enable_db_encryption(passphrase: String) -> Result<(), AppError> {
    if passphrase.len() < 6 {
        return Err(AppError::Other("加密口令长度至少 6 位".to_string()));
    }
    db::set_db_passphrase(&passphrase)?;
    let conn = db::get_db()?;
    db::set_app_config(&conn, "db_encrypted", "1")?;
    Ok(())
}

#[tauri::command]
pub fn disable_db_encryption(passphrase: String) -> Result<(), AppError> {
    let current = db::get_db_passphrase()?;
    if current.as_deref() != Some(&passphrase) {
        return Err(AppError::Other("加密口令不正确".to_string()));
    }
    let conn = db::get_db()?;
    db::set_app_config(&conn, "db_encrypted", "0")?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub enabled: bool,
    pub retention_days: i32,
    pub last_backup_date: Option<String>,
    pub backups: Vec<BackupInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub date: String,
    pub path: String,
    pub size: u64,
}

#[tauri::command]
pub fn get_backup_status(state: State<'_, AppState>) -> Result<BackupStatus, AppError> {
    let conn = db::get_db()?;
    let enabled = db::get_app_config_bool(&conn, "backup_enabled").unwrap_or(true);
    let retention_days = db::get_app_config_i32(&conn, "backup_retention_days").unwrap_or(7);
    let last_backup_date = db::get_app_config(&conn, "last_backup_date").ok().flatten();

    let backup_dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&backup_dir)?;
    let mut backups = Vec::new();
    for entry in std::fs::read_dir(&backup_dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(date) = name
            .strip_prefix("novel_ai_writer_")
            .and_then(|s| s.strip_suffix(".db"))
        {
            backups.push(BackupInfo {
                date: date.to_string(),
                path: entry.path().to_string_lossy().to_string(),
                size: meta.len(),
            });
        }
    }
    backups.sort_by(|a, b| b.date.cmp(&a.date));

    Ok(BackupStatus {
        enabled,
        retention_days,
        last_backup_date,
        backups,
    })
}

#[tauri::command]
pub fn set_backup_enabled(enabled: bool) -> Result<(), AppError> {
    let conn = db::get_db()?;
    db::set_app_config(&conn, "backup_enabled", if enabled { "1" } else { "0" })?;
    Ok(())
}

#[tauri::command]
pub fn set_backup_retention_days(days: i32) -> Result<(), AppError> {
    let conn = db::get_db()?;
    db::set_app_config(&conn, "backup_retention_days", &days.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn manual_backup_now(state: State<'_, AppState>) -> Result<String, AppError> {
    use chrono::Utc;
    use rusqlite::backup::Backup;
    use std::time::Duration;

    let conn = db::get_db()?;
    let backup_dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&backup_dir)?;
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let backup_path = backup_dir.join(format!("novel_ai_writer_{}.db", today));
    let mut dst = rusqlite::Connection::open(&backup_path)?;
    let backup = Backup::new(&conn, &mut dst)?;
    backup.run_to_completion(4096, Duration::from_millis(5), None)?;
    db::set_app_config(&conn, "last_backup_date", &today)?;
    Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_log_directory(state: State<'_, AppState>) -> Result<String, AppError> {
    let log_dir = state.data_dir.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    Ok(log_dir.to_string_lossy().to_string())
}
