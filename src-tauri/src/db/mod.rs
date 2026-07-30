use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use once_cell::sync::OnceCell;
use rusqlite::backup::Backup;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

mod schema;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

const DB_KEYRING_SERVICE: &str = "novel-ai-writer-db-key";
const DB_KEYRING_USER: &str = "db-key";
const DB_FILE_NAME: &str = "novel_ai_writer.db";
const BACKUP_DIR_NAME: &str = "backups";

pub fn init_db(app_handle: &AppHandle) -> Result<(), crate::error::AppError> {
    let app_dir = app_data_dir(app_handle)?;
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join(DB_FILE_NAME);

    let (mut conn, is_encrypted) = open_working_connection(&db_path)?;

    run_migrations(&conn)?;

    let target_encrypted = get_app_config_bool(&conn, "db_encrypted").unwrap_or(false);

    if is_encrypted != target_encrypted {
        let passphrase = get_db_passphrase()?.ok_or_else(|| {
            crate::error::AppError::Other(
                "数据库加密配置与密钥不一致，请在设置中重新配置数据库加密".to_string(),
            )
        })?;
        // Close the current connection so we can replace the file.
        drop(conn);
        migrate_db_file(&db_path, is_encrypted, target_encrypted, &passphrase)?;

        conn = if target_encrypted {
            open_encrypted_connection(&db_path, &passphrase)?
        } else {
            Connection::open(&db_path).map_err(crate::error::AppError::from)?
        };
        run_migrations(&conn)?;
    }

    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    // 每日备份放到后台线程, 避免大库备份阻塞启动 (冷启动 ≤3s 要求)。
    spawn_daily_backup(&app_dir, &db_path);

    let health: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .unwrap_or_else(|_| "ok".to_string());
    if health != "ok" {
        return Err(crate::error::AppError::Other(format!(
            "数据库完整性检查失败: {}。请从备份恢复或删除数据库文件后重启。",
            health
        )));
    }

    DB.set(Mutex::new(conn))
        .map_err(|_| crate::error::AppError::Other("数据库已经初始化".to_string()))?;

    Ok(())
}

pub fn get_db() -> Result<std::sync::MutexGuard<'static, Connection>, crate::error::AppError> {
    DB.get()
        .ok_or_else(|| crate::error::AppError::Other("数据库未初始化".to_string()))?
        .lock()
        .map_err(|_| crate::error::AppError::Other("数据库锁被污染".to_string()))
}

pub fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, crate::error::AppError> {
    // Allow E2E tests to override the data directory to avoid polluting user data.
    if let Ok(test_dir) = std::env::var("NOVEL_WRITER_TEST_DATA_DIR") {
        if !test_dir.is_empty() {
            return Ok(PathBuf::from(test_dir));
        }
    }
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::Other(format!("无法获取应用数据目录: {}", e)))
}

pub fn database_path(app_handle: &AppHandle) -> Result<PathBuf, crate::error::AppError> {
    Ok(app_data_dir(app_handle)?.join(DB_FILE_NAME))
}

pub fn backup_dir(app_handle: &AppHandle) -> Result<PathBuf, crate::error::AppError> {
    Ok(app_data_dir(app_handle)?.join(BACKUP_DIR_NAME))
}

fn db_keyring_entry() -> Result<keyring::Entry, crate::error::AppError> {
    keyring::Entry::new(DB_KEYRING_SERVICE, DB_KEYRING_USER)
        .map_err(|e| crate::error::AppError::Other(format!("无法访问凭据管理器: {}", e)))
}

pub fn get_db_passphrase() -> Result<Option<String>, crate::error::AppError> {
    match db_keyring_entry()?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(crate::error::AppError::Other(format!(
            "读取数据库加密口令失败: {}",
            e
        ))),
    }
}

pub fn set_db_passphrase(passphrase: &str) -> Result<(), crate::error::AppError> {
    db_keyring_entry()?
        .set_password(passphrase)
        .map_err(|e| crate::error::AppError::Other(format!("保存数据库加密口令失败: {}", e)))
}

pub fn delete_db_passphrase() -> Result<(), crate::error::AppError> {
    let _ = db_keyring_entry()?.delete_credential();
    Ok(())
}

fn open_connection_with_key(
    path: &Path,
    passphrase: Option<&str>,
) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    if let Some(key) = passphrase {
        conn.pragma_update(None, "key", key)?;
    }
    // Probe whether the database is readable with the given key.
    conn.query_row("SELECT 1 FROM sqlite_master LIMIT 1", [], |_| Ok(()))?;
    Ok(conn)
}

fn is_new_or_empty_db(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.len() == 0,
        Err(_) => true,
    }
}

fn open_working_connection(path: &Path) -> Result<(Connection, bool), crate::error::AppError> {
    // Treat missing or zero-byte files as brand-new databases so migrations
    // can create the schema. A zero-byte file cannot be opened by SQLite and
    // would otherwise leave the app in a broken state after a failed init.
    if is_new_or_empty_db(path) {
        return Connection::open(path)
            .map(|conn| (conn, false))
            .map_err(crate::error::AppError::from);
    }

    if let Ok(conn) = open_connection_with_key(path, None) {
        return Ok((conn, false));
    }
    if let Some(pass) = get_db_passphrase()? {
        if let Ok(conn) = open_connection_with_key(path, Some(&pass)) {
            return Ok((conn, true));
        }
    }
    Err(crate::error::AppError::Other(
        "无法打开数据库：文件可能损坏，或数据库加密口令不正确".to_string(),
    ))
}

fn open_encrypted_connection(
    path: &Path,
    passphrase: &str,
) -> Result<Connection, crate::error::AppError> {
    open_connection_with_key(path, Some(passphrase)).map_err(crate::error::AppError::from)
}

fn migrate_db_file(
    db_path: &Path,
    from_encrypted: bool,
    to_encrypted: bool,
    passphrase: &str,
) -> Result<(), crate::error::AppError> {
    if from_encrypted == to_encrypted {
        return Ok(());
    }

    let temp_path = db_path.with_extension("tmp");
    let backup_original = db_path.with_extension("bak");

    if to_encrypted {
        // Plain -> encrypted using sqlcipher_export.
        let src = Connection::open(db_path)?;
        src.execute(
            "ATTACH DATABASE ? AS encrypted KEY ?",
            [temp_path.to_str().unwrap_or(""), passphrase],
        )?;
        src.execute("SELECT sqlcipher_export('encrypted')", [])?;
        src.execute("DETACH DATABASE encrypted", [])?;
        drop(src);
    } else {
        // Encrypted -> plain using sqlcipher_export with empty key.
        let src = open_encrypted_connection(db_path, passphrase)?;
        src.execute(
            "ATTACH DATABASE ? AS plaintext KEY ''",
            [temp_path.to_str().unwrap_or("")],
        )?;
        src.execute("SELECT sqlcipher_export('plaintext')", [])?;
        src.execute("DETACH DATABASE plaintext", [])?;
        drop(src);
    }

    std::fs::rename(db_path, &backup_original)?;
    std::fs::rename(&temp_path, db_path)?;
    let _ = std::fs::remove_file(&backup_original);

    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<(), crate::error::AppError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )",
        [],
    )?;

    for migration in schema::MIGRATIONS {
        let applied: bool = conn
            .query_row(
                "SELECT 1 FROM _migrations WHERE id = ?",
                [migration.version],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !applied {
            conn.execute_batch(migration.sql)?;
            conn.execute(
                "INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, datetime('now'))",
                rusqlite::params![&migration.version, migration.name],
            )?;
        }
    }

    Ok(())
}

/// 在后台线程执行每日备份。使用独立连接, 不占用全局 DB 锁, 不阻塞启动。
fn spawn_daily_backup(app_dir: &Path, db_path: &Path) {
    let app_dir = app_dir.to_path_buf();
    let db_path = db_path.to_path_buf();
    std::thread::spawn(move || {
        if let Err(e) = run_daily_backup_background(&app_dir, &db_path) {
            tracing::warn!("每日自动备份失败: {}", e);
        }
    });
}

/// 打开用于备份的源连接。加密库需要用密钥环中的口令打开。
fn open_backup_connection(db_path: &Path) -> Result<Connection, crate::error::AppError> {
    let conn = Connection::open(db_path).map_err(crate::error::AppError::from)?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    // 探测是否可读: 加密库用普通连接查询会报 "file is not a database"
    match conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => Ok(conn),
        Err(_) => {
            drop(conn);
            let passphrase = get_db_passphrase()?.ok_or_else(|| {
                crate::error::AppError::Other("数据库已加密但密钥环中未找到口令".to_string())
            })?;
            let conn = open_encrypted_connection(db_path, &passphrase)?;
            conn.pragma_update(None, "busy_timeout", 5000)?;
            Ok(conn)
        }
    }
}

fn run_daily_backup_background(app_dir: &Path, db_path: &Path) -> Result<(), crate::error::AppError> {
    let conn = open_backup_connection(db_path)?;

    let backup_enabled = get_app_config_bool(&conn, "backup_enabled").unwrap_or(true);
    if !backup_enabled {
        return Ok(());
    }

    let backup_dir = app_dir.join(BACKUP_DIR_NAME);
    std::fs::create_dir_all(&backup_dir)?;

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let last_backup = get_app_config(&conn, "last_backup_date").unwrap_or_default();
    if last_backup.as_deref() == Some(&today) {
        return Ok(());
    }

    // 先写入临时文件, 成功后重命名, 避免应用中途退出留下损坏的“完整”备份。
    let final_path = backup_dir.join(format!("novel_ai_writer_{}.db", today));
    let tmp_path = backup_dir.join(format!("novel_ai_writer_{}.db.tmp", today));
    let _ = std::fs::remove_file(&tmp_path);

    backup_database(&conn, &tmp_path)?;
    std::fs::rename(&tmp_path, &final_path)?;

    set_app_config(&conn, "last_backup_date", &today)?;

    let retention_days = get_app_config_i32(&conn, "backup_retention_days").unwrap_or(7);
    prune_old_backups(&backup_dir, retention_days)?;

    tracing::info!("每日自动备份完成: {}", final_path.display());
    Ok(())
}

fn backup_database(src: &Connection, dst_path: &Path) -> Result<(), crate::error::AppError> {
    let mut dst = Connection::open(dst_path)?;
    let backup = Backup::new(src, &mut dst)?;
    // 每步 4096 页 + 5ms 停顿: 接近全速复制, 同时让出少量 IO。
    // (原参数 100 页/250ms 会导致 400MB 库备份耗时 4 分钟以上)
    backup.run_to_completion(4096, Duration::from_millis(5), None)?;
    Ok(())
}

fn prune_old_backups(backup_dir: &Path, retention_days: i32) -> Result<(), crate::error::AppError> {
    if retention_days <= 0 {
        return Ok(());
    }
    let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);
    for entry in std::fs::read_dir(backup_dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified()?;
        let modified = chrono::DateTime::<Utc>::from(modified);
        if modified < cutoff {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

pub fn get_app_config(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    match conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set_app_config(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn get_app_config_bool(conn: &Connection, key: &str) -> Option<bool> {
    get_app_config(conn, key)
        .ok()
        .flatten()
        .map(|v| v == "1" || v.to_lowercase() == "true")
}

pub fn get_app_config_i32(conn: &Connection, key: &str) -> Option<i32> {
    get_app_config(conn, key).ok().flatten().and_then(|v| v.parse().ok())
}
