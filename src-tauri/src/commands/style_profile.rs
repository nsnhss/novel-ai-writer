use std::collections::HashMap;

use chrono::Utc;
use jieba_rs::Jieba;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::llm::GenerateRequest;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleFeatures {
    pub sentence_length_avg: f64,
    pub sentence_length_std: f64,
    pub description_ratio: f64,
    pub dialogue_ratio: f64,
    pub top_keywords: Vec<String>,
    pub description: Option<String>,
    pub sex_style_fingerprint: Option<crate::sex_fingerprint::SexStyleFingerprint>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleProfileRequest {
    pub name: String,
    pub material_ids: Vec<String>,
}

/// Extract style profile from a list of materials.
#[tauri::command]
pub async fn extract_style_profile(
    req: StyleProfileRequest,
    state: State<'_, AppState>,
) -> Result<crate::models::StyleProfile, AppError> {
    let materials: Vec<(String, String, i32, String)> = tokio::task::spawn_blocking({
        let material_ids = req.material_ids.clone();
        move || -> Result<Vec<(String, String, i32, String)>, AppError> {
            let conn = crate::db::get_db()?;
            let placeholders = material_ids
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT id, plain_text, rating, style_fingerprint FROM material WHERE id IN ({}) AND status = 'active'",
                placeholders
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(material_ids.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("加载素材失败: {}", e)))??;

    if materials.is_empty() {
        return Err(AppError::Other("没有可用的高分素材".to_string()));
    }

    let combined_text: String = materials
        .iter()
        .map(|(_, text, _, _)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let mut features = aggregate_features(&materials);

    // Use LLM to extract a qualitative style description.
    let prompt = format!(
        "请根据以下参考文本，用一段话总结作者的写作风格（语言特点、叙事节奏、氛围营造方式）。\n\n参考文本：\n{}\n\n风格描述：",
        truncate_for_style(&combined_text, 3000)
    );

    let llm_result = state
        .generation_provider
        .read()
        .await
        .generate(GenerateRequest {
            request_type: "style_profile".to_string(),
            system_prompt: "你是一位文学评论家，擅长总结网文作者的写作风格。".to_string(),
            user_prompt: prompt,
            max_tokens: Some(300),
            temperature: Some(0.5),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;

    features.description = Some(llm_result.text.trim().to_string());

    let features_json = serde_json::to_string(&features)?;
    let source_ids: Vec<String> = materials.iter().map(|(id, _, _, _)| id.clone()).collect();
    let source_ids_json = serde_json::to_string(&source_ids)?;
    let top_keywords_json = serde_json::to_string(&features.top_keywords)?;
    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let profile = crate::models::StyleProfile {
        id: id.clone(),
        name: req.name.clone(),
        source_material_ids: source_ids_json,
        features: features_json,
        sentence_length_avg: Some(features.sentence_length_avg),
        sentence_length_std: Some(features.sentence_length_std),
        description_ratio: Some(features.description_ratio),
        dialogue_ratio: Some(features.dialogue_ratio),
        top_keywords: top_keywords_json,
        updated_at: now.clone(),
    };

    tokio::task::spawn_blocking({
        let profile = profile.clone();
        move || -> Result<(), AppError> {
            let conn = crate::db::get_db()?;
            conn.execute(
                "INSERT INTO style_profile (
                    id, name, source_material_ids, features,
                    sentence_length_avg, sentence_length_std, description_ratio, dialogue_ratio,
                    top_keywords, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    source_material_ids = excluded.source_material_ids,
                    features = excluded.features,
                    sentence_length_avg = excluded.sentence_length_avg,
                    sentence_length_std = excluded.sentence_length_std,
                    description_ratio = excluded.description_ratio,
                    dialogue_ratio = excluded.dialogue_ratio,
                    top_keywords = excluded.top_keywords,
                    updated_at = excluded.updated_at",
                params![
                    &profile.id,
                    &profile.name,
                    &profile.source_material_ids,
                    &profile.features,
                    profile.sentence_length_avg,
                    profile.sentence_length_std,
                    profile.description_ratio,
                    profile.dialogue_ratio,
                    &profile.top_keywords,
                    &profile.updated_at,
                ],
            )?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("保存风格画像失败: {}", e)))??;

    Ok(profile)
}

fn compute_features(text: &str) -> StyleFeatures {
    let sentences = split_sentences(text);
    let sentence_lengths: Vec<usize> = sentences.iter().map(|s| s.chars().count()).collect();

    let (avg, std) = if sentence_lengths.is_empty() {
        (0.0, 0.0)
    } else {
        let avg = sentence_lengths.iter().sum::<usize>() as f64 / sentence_lengths.len() as f64;
        let variance = sentence_lengths
            .iter()
            .map(|&x| {
                let diff = x as f64 - avg;
                diff * diff
            })
            .sum::<f64>()
            / sentence_lengths.len() as f64;
        (avg, variance.sqrt())
    };

    let dialogue_chars = count_dialogue_chars(text);
    let total_chars = text.chars().count();
    let dialogue_ratio = if total_chars == 0 {
        0.0
    } else {
        dialogue_chars as f64 / total_chars as f64
    };

    // Description ratio: non-dialogue, non-punctuation text / total
    let description_chars = total_chars
        .saturating_sub(dialogue_chars)
        .saturating_sub(count_punctuation_chars(text));
    let description_ratio = if total_chars == 0 {
        0.0
    } else {
        description_chars as f64 / total_chars as f64
    };

    let top_keywords = extract_keywords(text, 20);
    let sex_fp = crate::sex_fingerprint::compute_sex_fingerprint(text);

    StyleFeatures {
        sentence_length_avg: avg,
        sentence_length_std: std,
        description_ratio,
        dialogue_ratio,
        top_keywords,
        description: None,
        sex_style_fingerprint: if sex_fp.female_part_terms.is_empty()
            && sex_fp.male_part_terms.is_empty()
            && sex_fp.dirty_word_usage == 0.0
        {
            None
        } else {
            Some(sex_fp)
        },
    }
}

/// Compute a complete style fingerprint for a single material without LLM description.
pub fn compute_material_style_fingerprint(text: &str) -> StyleFeatures {
    compute_features(text)
}

/// Aggregate numeric features from cached fingerprints, weighted by rating.
/// Keyword/sex fingerprint are recomputed from the combined text for simplicity.
fn aggregate_features(materials: &[(String, String, i32, String)]) -> StyleFeatures {
    let combined_text: String = materials
        .iter()
        .map(|(_, text, _, _)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let mut total_weight = 0.0f64;
    let mut acc_avg = 0.0f64;
    let mut acc_std = 0.0f64;
    let mut acc_desc = 0.0f64;
    let mut acc_dialogue = 0.0f64;
    for (_, text, rating, fingerprint_json) in materials {
        let weight = (*rating).max(1) as f64;
        let fp: Option<StyleFeatures> = serde_json::from_str(fingerprint_json).ok();
        let fp = fp.unwrap_or_else(|| compute_features(text));
        acc_avg += fp.sentence_length_avg * weight;
        acc_std += fp.sentence_length_std * weight;
        acc_desc += fp.description_ratio * weight;
        acc_dialogue += fp.dialogue_ratio * weight;
        total_weight += weight;
    }

    let mut features = compute_features(&combined_text);
    if total_weight > 0.0 {
        features.sentence_length_avg = acc_avg / total_weight;
        features.sentence_length_std = acc_std / total_weight;
        features.description_ratio = acc_desc / total_weight;
        features.dialogue_ratio = acc_dialogue / total_weight;
    }
    features.top_keywords = extract_keywords(&combined_text, 20);
    features
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';') {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                sentences.push(trimmed.to_string());
            }
            current.clear();
        }
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        sentences.push(trimmed.to_string());
    }

    sentences
}

fn count_dialogue_chars(text: &str) -> usize {
    let mut count = 0;
    let mut in_dialogue = false;

    for ch in text.chars() {
        match ch {
            '"' | '“' | '‘' => {
                in_dialogue = !in_dialogue;
            }
            _ if in_dialogue => count += 1,
            _ => {}
        }
    }

    count
}

fn count_punctuation_chars(text: &str) -> usize {
    text.chars()
        .filter(|c| {
            matches!(
                c,
                '。' | '，'
                    | '！'
                    | '？'
                    | '；'
                    | '：'
                    | '、'
                    | '.'
                    | ','
                    | '!'
                    | '?'
                    | ';'
                    | ':'
                    | '"'
                    | '“'
                    | '”'
                    | '‘'
                    | '’'
            )
        })
        .count()
}

fn extract_keywords(text: &str, top_n: usize) -> Vec<String> {
    let jieba = Jieba::new();
    let words = jieba.cut(text, true);

    let mut freq: HashMap<String, usize> = HashMap::new();
    for word in words {
        let word = word.trim();
        if word.len() < 2 || is_stop_word(word) {
            continue;
        }
        *freq.entry(word.to_string()).or_insert(0) += 1;
    }

    let mut entries: Vec<(String, usize)> = freq.into_iter().collect();
    entries.sort_by_key(|b| std::cmp::Reverse(b.1));

    entries
        .into_iter()
        .take(top_n)
        .map(|(word, _)| word)
        .collect()
}

fn is_stop_word(word: &str) -> bool {
    const STOP_WORDS: &[&str] = &[
        "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也",
        "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那",
        "之", "与", "及", "等", "或",
    ];
    STOP_WORDS.contains(&word)
}

fn truncate_for_style(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        text.chars().take(max_chars).collect::<String>() + "…"
    }
}

#[tauri::command]
pub fn list_style_profiles() -> Result<Vec<crate::models::StyleProfile>, AppError> {
    let conn = crate::db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, source_material_ids, features, sentence_length_avg, sentence_length_std, description_ratio, dialogue_ratio, top_keywords, updated_at FROM style_profile ORDER BY updated_at DESC",
    )?;
    let profiles = stmt
        .query_map([], |row| {
            Ok(crate::models::StyleProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                source_material_ids: row.get(2)?,
                features: row.get(3)?,
                sentence_length_avg: row.get(4).ok(),
                sentence_length_std: row.get(5).ok(),
                description_ratio: row.get(6).ok(),
                dialogue_ratio: row.get(7).ok(),
                top_keywords: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(profiles)
}

#[tauri::command]
pub fn get_style_profile(id: String) -> Result<crate::models::StyleProfile, AppError> {
    let conn = crate::db::get_db()?;
    let profile = conn.query_row(
        "SELECT id, name, source_material_ids, features, sentence_length_avg, sentence_length_std, description_ratio, dialogue_ratio, top_keywords, updated_at FROM style_profile WHERE id = ?1",
        [&id],
        |row| {
            Ok(crate::models::StyleProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                source_material_ids: row.get(2)?,
                features: row.get(3)?,
                sentence_length_avg: row.get(4).ok(),
                sentence_length_std: row.get(5).ok(),
                description_ratio: row.get(6).ok(),
                dialogue_ratio: row.get(7).ok(),
                top_keywords: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    )?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_style_profile(id: String) -> Result<(), AppError> {
    let conn = crate::db::get_db()?;
    conn.execute("DELETE FROM style_profile WHERE id = ?1", [&id])?;
    Ok(())
}

const ACTIVE_STYLE_PROFILE_KEY: &str = "active_style_profile_id";

#[tauri::command]
pub fn get_active_style_profile_id() -> Result<Option<String>, AppError> {
    let conn = crate::db::get_db()?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            [ACTIVE_STYLE_PROFILE_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value)
}

#[tauri::command]
pub fn set_active_style_profile_id(id: Option<String>) -> Result<(), AppError> {
    let conn = crate::db::get_db()?;
    match id {
        Some(value) => conn.execute(
            "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [ACTIVE_STYLE_PROFILE_KEY, &value],
        )?,
        None => conn.execute(
            "DELETE FROM app_config WHERE key = ?1",
            [ACTIVE_STYLE_PROFILE_KEY],
        )?,
    };
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Style profile recalibration & drift detection
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalibrateStyleProfileRequest {
    pub profile_id: Option<String>,
    pub window_days: Option<i64>,
    pub min_rating: Option<i32>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleFeatureSnapshot {
    pub sentence_length_avg: f64,
    pub sentence_length_std: f64,
    pub description_ratio: f64,
    pub dialogue_ratio: f64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalibrateStyleProfileResult {
    pub profile_id: String,
    pub sample_count: usize,
    pub avg_rating: f64,
    pub previous: StyleFeatureSnapshot,
    pub current: StyleFeatureSnapshot,
}

impl From<&StyleFeatures> for StyleFeatureSnapshot {
    fn from(f: &StyleFeatures) -> Self {
        Self {
            sentence_length_avg: f.sentence_length_avg,
            sentence_length_std: f.sentence_length_std,
            description_ratio: f.description_ratio,
            dialogue_ratio: f.dialogue_ratio,
        }
    }
}

#[tauri::command]
pub async fn recalibrate_active_style_profile(
    req: RecalibrateStyleProfileRequest,
    state: State<'_, AppState>,
) -> Result<RecalibrateStyleProfileResult, AppError> {
    let profile_id = match req.profile_id {
        Some(id) => id,
        None => get_active_style_profile_id()?
            .ok_or_else(|| AppError::Other("未设置激活的风格画像".to_string()))?,
    };
    let window_days = req.window_days.unwrap_or(90);
    let min_rating = req.min_rating.unwrap_or(4);

    let (name, source_ids_json, current_features_json): (String, String, String) =
        tokio::task::spawn_blocking({
            let profile_id = profile_id.clone();
            move || -> Result<(String, String, String), AppError> {
                let conn = crate::db::get_db()?;
                conn.query_row(
                    "SELECT name, source_material_ids, features FROM style_profile WHERE id = ?1",
                    [&profile_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .map_err(|e| e.into())
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("加载风格画像失败: {}", e)))??;

    let previous_features: StyleFeatures = serde_json::from_str(&current_features_json)?;
    let previous_source_ids: Vec<String> =
        serde_json::from_str(&source_ids_json).unwrap_or_default();

    let materials: Vec<(String, String, i32, String)> = tokio::task::spawn_blocking({
        let previous_source_ids = previous_source_ids.clone();
        move || -> Result<Vec<(String, String, i32, String)>, AppError> {
            let conn = crate::db::get_db()?;
            let mut candidate_ids: Vec<String> = previous_source_ids;

            let window_sql = format!(
                "SELECT id FROM material WHERE status = 'active' AND rating >= ?1 AND rating > 0 AND updated_at >= date('now', '-{} days')",
                window_days
            );
            let mut stmt = conn.prepare(&window_sql)?;
            let rows = stmt
                .query_map([min_rating], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            candidate_ids.extend(rows);

            let ai_window_sql = format!(
                "SELECT id FROM material WHERE source_type = 'ai_generated' AND status = 'active' AND rating >= ?1 AND created_at >= date('now', '-{} days')",
                window_days
            );
            let mut stmt = conn.prepare(&ai_window_sql)?;
            let rows = stmt
                .query_map([min_rating], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            candidate_ids.extend(rows);

            let ids: std::collections::HashSet<String> = candidate_ids.into_iter().collect();
            if ids.is_empty() {
                return Ok(Vec::new());
            }

            let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT id, plain_text, rating, style_fingerprint FROM material WHERE id IN ({})",
                placeholders
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("收集校准素材失败: {}", e)))??;

    if materials.is_empty() {
        return Err(AppError::Other("近期没有可校准的高分素材".to_string()));
    }

    let sample_count = materials.len();
    let avg_rating =
        materials.iter().map(|(_, _, r, _)| *r as f64).sum::<f64>() / sample_count as f64;

    let mut features = aggregate_features(&materials);

    // Refresh qualitative description from the recalibrated corpus.
    let combined_text: String = materials
        .iter()
        .map(|(_, text, _, _)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        "请根据以下参考文本，用一段话总结作者的写作风格（语言特点、叙事节奏、氛围营造方式）。\n\n参考文本：\n{}\n\n风格描述：",
        truncate_for_style(&combined_text, 3000)
    );
    let llm_result = state
        .generation_provider
        .read()
        .await
        .generate(GenerateRequest {
            request_type: "style_profile".to_string(),
            system_prompt: "你是一位文学评论家，擅长总结网文作者的写作风格。".to_string(),
            user_prompt: prompt,
            max_tokens: Some(300),
            temperature: Some(0.5),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;
    features.description = Some(llm_result.text.trim().to_string());

    let features_json = serde_json::to_string(&features)?;
    let source_ids: Vec<String> = materials.iter().map(|(id, _, _, _)| id.clone()).collect();
    let source_ids_json = serde_json::to_string(&source_ids)?;
    let top_keywords_json = serde_json::to_string(&features.top_keywords)?;
    let now = Utc::now().to_rfc3339();

    tokio::task::spawn_blocking({
        let profile_id = profile_id.clone();
        let name = name.clone();
        move || -> Result<(), AppError> {
            let conn = crate::db::get_db()?;
            conn.execute(
                "INSERT INTO style_profile (
                    id, name, source_material_ids, features,
                    sentence_length_avg, sentence_length_std, description_ratio, dialogue_ratio,
                    top_keywords, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    source_material_ids = excluded.source_material_ids,
                    features = excluded.features,
                    sentence_length_avg = excluded.sentence_length_avg,
                    sentence_length_std = excluded.sentence_length_std,
                    description_ratio = excluded.description_ratio,
                    dialogue_ratio = excluded.dialogue_ratio,
                    top_keywords = excluded.top_keywords,
                    updated_at = excluded.updated_at",
                params![
                    &profile_id,
                    &name,
                    &source_ids_json,
                    &features_json,
                    features.sentence_length_avg,
                    features.sentence_length_std,
                    features.description_ratio,
                    features.dialogue_ratio,
                    &top_keywords_json,
                    &now,
                ],
            )?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("保存校准后的画像失败: {}", e)))??;

    Ok(RecalibrateStyleProfileResult {
        profile_id,
        sample_count,
        avg_rating,
        previous: StyleFeatureSnapshot::from(&previous_features),
        current: StyleFeatureSnapshot::from(&features),
    })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateStyleDriftRequest {
    pub text: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateStyleDriftResult {
    pub drift_score: f32,
    pub interpretation: String,
}

#[tauri::command]
pub async fn evaluate_style_drift(
    req: EvaluateStyleDriftRequest,
    state: State<'_, AppState>,
) -> Result<EvaluateStyleDriftResult, AppError> {
    let profile_id = get_active_style_profile_id()?
        .ok_or_else(|| AppError::Other("未设置激活的风格画像".to_string()))?;

    let source_material_ids: Vec<String> = tokio::task::spawn_blocking({
        let profile_id = profile_id.clone();
        move || -> Result<Vec<String>, AppError> {
            let conn = crate::db::get_db()?;
            let json: String = conn.query_row(
                "SELECT source_material_ids FROM style_profile WHERE id = ?1",
                [&profile_id],
                |row| row.get(0),
            )?;
            Ok(serde_json::from_str(&json).unwrap_or_default())
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("加载画像素材失败: {}", e)))??;

    if source_material_ids.is_empty() {
        return Ok(EvaluateStyleDriftResult {
            drift_score: 0.0,
            interpretation: "当前画像没有源素材，无法评估漂移。".to_string(),
        });
    }

    let query_embeddings = state.embedding_provider.embed(&[req.text]).await?;
    let query_vector = query_embeddings
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Other("嵌入失败".to_string()))?;

    let embeddings: Vec<Vec<f32>> = tokio::task::spawn_blocking({
        let source_material_ids = source_material_ids.clone();
        move || -> Result<Vec<Vec<f32>>, AppError> {
            let conn = crate::db::get_db()?;
            let placeholders = source_material_ids
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT embedding FROM vector_embedding WHERE material_id IN ({})",
                placeholders
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(
                    rusqlite::params_from_iter(source_material_ids.iter()),
                    |row| {
                        let json: String = row.get(0)?;
                        let vec: Vec<f32> = serde_json::from_str(&json)
                            .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
                        Ok(vec)
                    },
                )?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("加载源素材向量失败: {}", e)))??;

    if embeddings.is_empty() {
        return Ok(EvaluateStyleDriftResult {
            drift_score: 0.0,
            interpretation: "源素材尚未向量化，无法评估漂移。".to_string(),
        });
    }

    let total_similarity: f32 = embeddings
        .iter()
        .map(|v| cosine_similarity(&query_vector, v))
        .sum();
    let avg_similarity = total_similarity / embeddings.len() as f32;
    let drift_score = avg_similarity.clamp(0.0, 1.0);

    let interpretation = if drift_score >= 0.85 {
        "生成文本与当前风格画像高度一致。".to_string()
    } else if drift_score >= 0.7 {
        "整体风格接近画像，存在轻微偏差。".to_string()
    } else if drift_score >= 0.55 {
        "漂移较明显，建议检查生成内容或重新校准画像。".to_string()
    } else {
        "漂移严重，当前生成与画像风格差异较大。".to_string()
    };

    Ok(EvaluateStyleDriftResult {
        drift_score,
        interpretation,
    })
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    (dot / (norm_a.sqrt() * norm_b.sqrt())).clamp(-1.0, 1.0)
}

const AUTO_RECALIBRATE_KEY: &str = "auto_recalibrate_style_profile";

#[tauri::command]
pub fn get_auto_recalibrate_style_profile() -> Result<bool, AppError> {
    let conn = crate::db::get_db()?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            [AUTO_RECALIBRATE_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value
        .and_then(|v| v.parse::<i32>().ok())
        .map(|v| v != 0)
        .unwrap_or(false))
}

#[tauri::command]
pub fn set_auto_recalibrate_style_profile(enabled: bool) -> Result<(), AppError> {
    let conn = crate::db::get_db()?;
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [AUTO_RECALIBRATE_KEY, if enabled { "1" } else { "0" }],
    )?;
    Ok(())
}
