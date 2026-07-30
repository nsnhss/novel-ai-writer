use chrono::Utc;
use regex::Regex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db;
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyFilterRule {
    pub id: String,
    pub name: String,
    pub pattern: String,
    pub replacement: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrivacyFilterRuleRequest {
    pub name: String,
    pub pattern: String,
    pub replacement: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePrivacyFilterRuleRequest {
    pub id: String,
    pub name: Option<String>,
    pub pattern: Option<String>,
    pub replacement: Option<String>,
    pub is_active: Option<bool>,
}

fn row_to_rule(row: &rusqlite::Row) -> Result<PrivacyFilterRule, rusqlite::Error> {
    Ok(PrivacyFilterRule {
        id: row.get(0)?,
        name: row.get(1)?,
        pattern: row.get(2)?,
        replacement: row.get(3)?,
        is_active: row.get::<_, i32>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn list_privacy_filter_rules() -> Result<Vec<PrivacyFilterRule>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, pattern, replacement, is_active, created_at, updated_at
         FROM privacy_filter_rule ORDER BY created_at",
    )?;
    let rows = stmt
        .query_map([], row_to_rule)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_privacy_filter_rule(
    req: CreatePrivacyFilterRuleRequest,
) -> Result<PrivacyFilterRule, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    {
        let conn = db::get_db()?;
        conn.execute(
            "INSERT INTO privacy_filter_rule (id, name, pattern, replacement, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
            params![&id, &req.name, &req.pattern, &req.replacement, &now, &now],
        )?;
    }
    get_privacy_filter_rule(id)
}

#[tauri::command]
pub fn get_privacy_filter_rule(id: String) -> Result<PrivacyFilterRule, AppError> {
    let conn = db::get_db()?;
    let rule = conn.query_row(
        "SELECT id, name, pattern, replacement, is_active, created_at, updated_at
         FROM privacy_filter_rule WHERE id = ?1",
        [&id],
        row_to_rule,
    )?;
    Ok(rule)
}

#[tauri::command]
pub fn update_privacy_filter_rule(
    req: UpdatePrivacyFilterRuleRequest,
) -> Result<PrivacyFilterRule, AppError> {
    let existing = get_privacy_filter_rule(req.id.clone())?;
    let name = req.name.unwrap_or(existing.name);
    let pattern = req.pattern.unwrap_or(existing.pattern);
    let replacement = req.replacement.unwrap_or(existing.replacement);
    let is_active = req.is_active.unwrap_or(existing.is_active);
    let now = Utc::now().to_rfc3339();

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE privacy_filter_rule SET name = ?1, pattern = ?2, replacement = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?6",
            params![&name, &pattern, &replacement, is_active as i32, &now, &req.id],
        )?;
    }
    get_privacy_filter_rule(req.id)
}

#[tauri::command]
pub fn delete_privacy_filter_rule(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM privacy_filter_rule WHERE id = ?1", [&id])?;
    Ok(())
}

const PRIVACY_MODE_KEY: &str = "privacy_mode_enabled";

#[tauri::command]
pub fn get_privacy_mode() -> Result<bool, AppError> {
    let conn = db::get_db()?;
    let value: Result<String, _> = conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [PRIVACY_MODE_KEY],
        |row| row.get(0),
    );
    match value {
        Ok(v) => Ok(v == "1"),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn set_privacy_mode(enabled: bool) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![PRIVACY_MODE_KEY, if enabled { "1" } else { "0" }],
    )?;
    Ok(())
}

pub fn apply_privacy_filter_text(text: &str, rules: &[PrivacyFilterRule]) -> String {
    if rules.is_empty() {
        return text.to_string();
    }
    let mut result = text.to_string();
    for rule in rules {
        if rule.pattern.is_empty() || !rule.is_active {
            continue;
        }
        match Regex::new(&rule.pattern) {
            Ok(re) => {
                result = re
                    .replace_all(&result, rule.replacement.as_str())
                    .to_string();
            }
            Err(_) => continue,
        }
    }
    result
}

/// Apply active privacy filter rules to text. Returns masked text.
#[tauri::command]
pub fn apply_privacy_filter(text: String) -> Result<String, AppError> {
    let rules = list_privacy_filter_rules()?
        .into_iter()
        .filter(|r| r.is_active)
        .collect::<Vec<_>>();
    Ok(apply_privacy_filter_text(&text, &rules))
}
