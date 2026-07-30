use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

use crate::db;
use crate::error::AppError;

// ─────────────────────────────────────────────────────────────────────────────
// Extension package data model
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPackage {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub content_levels: Vec<String>,
    #[serde(default)]
    pub tags: Vec<ExtensionTag>,
    #[serde(default)]
    pub scene_templates: Vec<ExtensionSceneTemplate>,
    #[serde(default)]
    pub character_profile_schema: Vec<ProfileSchemaField>,
    #[serde(default)]
    pub slider_presets: Vec<ExtensionSliderPreset>,
    #[serde(default)]
    pub diagnostic_dimensions: Vec<DiagnosticDimension>,
    #[serde(default)]
    pub model_recommendations: Vec<ExtensionModelRecommendation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionTag {
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSceneTemplate {
    pub name: String,
    #[serde(default)]
    pub category: String,
    pub prompt_template: String,
    #[serde(default)]
    pub is_adult: bool,
    #[serde(default)]
    pub adult_prompt: String,
    #[serde(default)]
    pub beats: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSchemaField {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSliderPreset {
    pub name: String,
    #[serde(default)]
    pub category: String,
    pub sliders: String, // JSON array string
    pub mapping_template: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticDimension {
    pub key: String,
    pub name: String,
    pub prompt_template: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionModelRecommendation {
    pub name: String,
    pub provider: String,
    #[serde(alias = "model")]
    pub model_name: String,
    #[serde(default)]
    pub endpoint: Option<String>,
    pub score: f64,
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub sample_output: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Import command
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExtensionResult {
    pub name: String,
    pub version: String,
    pub content_levels_added: usize,
    pub tags_added: usize,
    pub scene_templates_added: usize,
    pub slider_presets_added: usize,
    pub schema_fields_added: usize,
    pub diagnostic_dimensions_added: usize,
    pub model_recommendations_added: usize,
}

#[tauri::command]
pub fn import_extension_package(file_path: String) -> Result<ImportExtensionResult, AppError> {
    let content = std::fs::read_to_string(&file_path)?;
    let package: ExtensionPackage = serde_json::from_str(&content)?;

    if package.name.trim().is_empty() || package.version.trim().is_empty() {
        return Err(AppError::Other("扩展包缺少 name 或 version".to_string()));
    }

    let now = Utc::now().to_rfc3339();

    let mut conn = db::get_db()?;
    let tx = conn.transaction()?;

    // Content levels become tags with category "content_level".
    let mut content_levels_added = 0;
    for level in &package.content_levels {
        let rows = tx.execute(
            "INSERT OR IGNORE INTO tag (id, name, category, color) VALUES (lower(hex(randomblob(16))), ?1, 'content_level', '#808080')",
            [level],
        )?;
        content_levels_added += rows;
    }

    // Generic tags.
    let mut tags_added = 0;
    for tag in &package.tags {
        let rows = tx.execute(
            "INSERT OR IGNORE INTO tag (id, name, category, color) VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3)",
            [&tag.name, &tag.category, &tag.color],
        )?;
        tags_added += rows;
    }

    // Scene templates.
    let mut scene_templates_added = 0;
    for template in &package.scene_templates {
        if template.prompt_template.trim().is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO scene_template (id, name, category, prompt_template, is_adult, adult_prompt, beats, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
            params![
                Uuid::new_v4().to_string(),
                &template.name,
                &template.category,
                &template.prompt_template,
                template.is_adult as i32,
                &template.adult_prompt,
                &template.beats,
                &now
            ],
        )?;
        scene_templates_added += 1;
    }

    // Slider presets.
    let mut slider_presets_added = 0;
    for preset in &package.slider_presets {
        tx.execute(
            "INSERT INTO slider_preset (id, name, sliders, mapping_template, category, is_builtin, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                &preset.name,
                &preset.sliders,
                &preset.mapping_template,
                &preset.category,
                &now,
                &now
            ],
        )?;
        slider_presets_added += 1;
    }

    tx.commit()?;

    // Merge character profile schema.
    let schema_fields_added = merge_app_config_json_array(
        "extension_character_profile_schema",
        &package.character_profile_schema,
        |a: &ProfileSchemaField, b: &ProfileSchemaField| a.key == b.key,
    )?;

    // Merge diagnostic dimensions.
    let diagnostic_dimensions_added = merge_app_config_json_array(
        "extension_diagnostic_dimensions",
        &package.diagnostic_dimensions,
        |a: &DiagnosticDimension, b: &DiagnosticDimension| a.key == b.key,
    )?;

    // Merge model recommendations.
    let model_recommendations_added = merge_app_config_json_array(
        "extension_model_recommendations",
        &package.model_recommendations,
        |a: &ExtensionModelRecommendation, b: &ExtensionModelRecommendation| {
            a.model_name == b.model_name && a.provider == b.provider
        },
    )?;

    // Record installed extension.
    let installed_json: String = db::get_db()?
        .query_row(
            "SELECT value FROM app_config WHERE key = 'installed_extensions'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".to_string());
    let mut installed: Vec<InstalledExtension> =
        serde_json::from_str(&installed_json).unwrap_or_default();
    installed.retain(|e| !(e.name == package.name && e.version == package.version));
    installed.push(InstalledExtension {
        name: package.name.clone(),
        version: package.version.clone(),
        imported_at: now.clone(),
    });
    let installed_json = serde_json::to_string(&installed)?;
    db::get_db()?.execute(
        "INSERT INTO app_config (key, value) VALUES ('installed_extensions', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&installed_json],
    )?;

    Ok(ImportExtensionResult {
        name: package.name,
        version: package.version,
        content_levels_added,
        tags_added,
        scene_templates_added,
        slider_presets_added,
        schema_fields_added,
        diagnostic_dimensions_added,
        model_recommendations_added,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    name: String,
    version: String,
    imported_at: String,
}

fn merge_app_config_json_array<T: serde::Serialize + serde::de::DeserializeOwned>(
    key: &str,
    incoming: &[T],
    eq: impl Fn(&T, &T) -> bool,
) -> Result<usize, AppError> {
    if incoming.is_empty() {
        return Ok(0);
    }
    let conn = db::get_db()?;
    let existing_json: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".to_string());
    let mut existing: Vec<T> = serde_json::from_str(&existing_json).unwrap_or_default();
    let mut added = 0;
    for item in incoming {
        if !existing.iter().any(|e| eq(e, item)) {
            existing.push(serde_json::from_str(&serde_json::to_string(item)?)?);
            added += 1;
        }
    }
    let updated_json = serde_json::to_string(&existing)?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, &updated_json],
    )?;
    Ok(added)
}

// ─────────────────────────────────────────────────────────────────────────────
// Query commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_installed_extensions() -> Result<Vec<InstalledExtension>, AppError> {
    let conn = db::get_db()?;
    let json: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'installed_extensions'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".to_string());
    let installed: Vec<InstalledExtension> = serde_json::from_str(&json).unwrap_or_default();
    Ok(installed)
}

#[tauri::command]
pub fn get_character_profile_schema() -> Result<Vec<ProfileSchemaField>, AppError> {
    let conn = db::get_db()?;
    let json: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'extension_character_profile_schema'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".to_string());
    let schema: Vec<ProfileSchemaField> = serde_json::from_str(&json).unwrap_or_default();
    Ok(schema)
}

#[tauri::command]
pub fn get_diagnostic_dimensions() -> Result<Vec<DiagnosticDimension>, AppError> {
    let conn = db::get_db()?;
    let json: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'extension_diagnostic_dimensions'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".to_string());
    let dimensions: Vec<DiagnosticDimension> = serde_json::from_str(&json).unwrap_or_default();
    Ok(dimensions)
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic command
// ─────────────────────────────────────────────────────────────────────────────

use crate::llm::GenerateRequest;
use crate::state::AppState;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnoseTextRequest {
    pub text: String,
    #[serde(default)]
    pub dimension_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticResult {
    pub key: String,
    pub name: String,
    pub suggestion: String,
}

#[tauri::command]
pub async fn diagnose_text(
    req: DiagnoseTextRequest,
    state: State<'_, AppState>,
) -> Result<Vec<DiagnosticResult>, AppError> {
    let dimensions = get_diagnostic_dimensions()?;
    let selected: Vec<DiagnosticDimension> = if req.dimension_keys.is_empty() {
        dimensions
    } else {
        let keys: HashSet<String> = req.dimension_keys.into_iter().collect();
        dimensions
            .into_iter()
            .filter(|d| keys.contains(&d.key))
            .collect()
    };

    if selected.is_empty() {
        return Err(AppError::Other("没有可用的诊断维度".to_string()));
    }

    let provider = state.generation_provider.read().await.clone();
    let mut results = Vec::new();

    for dimension in selected {
        let prompt = dimension
            .prompt_template
            .replace("{text}", &req.text)
            .replace("{dimension}", &dimension.name);
        let llm_result = provider
            .generate(GenerateRequest {
                request_type: "diagnose".to_string(),
                system_prompt:
                    "你是一位中文小说写作教练。请针对给定维度，用一句话给出具体、可执行的改进建议。"
                        .to_string(),
                user_prompt: prompt,
                max_tokens: Some(200),
                temperature: Some(0.5),
                top_p: None,
                top_k: None,
                repetition_penalty: None,
                frequency_penalty: None,
            })
            .await?;
        results.push(DiagnosticResult {
            key: dimension.key.clone(),
            name: dimension.name,
            suggestion: llm_result.text.trim().to_string(),
        });
    }

    Ok(results)
}
