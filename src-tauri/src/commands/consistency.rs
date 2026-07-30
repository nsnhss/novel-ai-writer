use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::style_profile::StyleFeatures;
use crate::db;
use crate::error::AppError;
use crate::llm::GenerateRequest;
use crate::state::AppState;

// ─────────────────────────────────────────────────────────────────────────────
// F-29: Forgetfulness / consistency detection
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InconsistencyWarning {
    pub warning_type: String,
    pub description: String,
    pub quote: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectInconsistenciesRequest {
    pub chapter_id: String,
    pub text: String,
}

fn resolve_book_id(chapter_id: &str) -> Result<String, AppError> {
    let conn = db::get_db()?;
    let book_id: String = conn.query_row(
        "SELECT v.book_id FROM chapter c JOIN volume v ON c.volume_id = v.id WHERE c.id = ?1",
        [chapter_id],
        |row| row.get(0),
    )?;
    Ok(book_id)
}

fn load_active_anchors(book_id: &str) -> Result<Vec<String>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT content FROM anchor WHERE book_id = ?1 AND is_active = 1 ORDER BY created_at",
    )?;
    let rows = stmt
        .query_map([book_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_matching_character_facts(book_id: &str, text: &str) -> Result<Vec<String>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT name, aliases, description, background, traits, relationships, extended_profile, adult_profile
         FROM character_card WHERE book_id = ?1 LIMIT 50",
    )?;
    let rows = stmt.query_map([book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
        ))
    })?;

    let mut facts = Vec::new();
    for row in rows {
        let (name, aliases, description, background, traits, relationships, extended, adult) = row?;
        let names: Vec<&str> = aliases
            .split([',', '，', '/'])
            .chain(std::iter::once(name.as_str()))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if names.iter().any(|n| text.contains(n)) {
            facts.push(format!(
                "角色：{}\n简介：{}\n背景：{}\n性格：{}\n关系：{}\n扩展：{}\n身体档案：{}",
                name, description, background, traits, relationships, extended, adult
            ));
        }
    }
    Ok(facts)
}

fn load_matching_scene_facts(book_id: &str, text: &str) -> Result<Vec<String>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT name, description, location, time_period, atmosphere FROM scene_card WHERE book_id = ?1 LIMIT 50",
    )?;
    let rows = stmt.query_map([book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;

    let mut facts = Vec::new();
    for row in rows {
        let (name, description, location, time_period, atmosphere) = row?;
        if text.contains(&name)
            || text.contains(&location)
            || text.contains(&time_period)
            || text.contains(&atmosphere)
        {
            facts.push(format!(
                "场景：{}\n描述：{}\n地点：{}\n时间：{}\n氛围：{}",
                name, description, location, time_period, atmosphere
            ));
        }
    }
    Ok(facts)
}

fn load_body_state_snapshot(chapter_id: &str) -> Result<Option<String>, AppError> {
    let conn = db::get_db()?;
    let snapshot: Option<String> = conn
        .query_row(
            "SELECT snapshot FROM chapter_body_state WHERE chapter_id = ?1 ORDER BY updated_at DESC LIMIT 1",
            [chapter_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(snapshot.filter(|s| !s.trim().is_empty() && s != "{}"))
}

fn extract_json_array(text: &str) -> Option<serde_json::Value> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

#[tauri::command]
pub async fn detect_generation_inconsistencies(
    req: DetectInconsistenciesRequest,
    state: State<'_, AppState>,
) -> Result<Vec<InconsistencyWarning>, AppError> {
    if req.text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let book_id = resolve_book_id(&req.chapter_id)?;
    let anchors = load_active_anchors(&book_id)?;
    let characters = load_matching_character_facts(&book_id, &req.text)?;
    let scenes = load_matching_scene_facts(&book_id, &req.text)?;
    let body_state = load_body_state_snapshot(&req.chapter_id)?;

    if anchors.is_empty() && characters.is_empty() && scenes.is_empty() && body_state.is_none() {
        return Ok(Vec::new());
    }

    let mut facts = String::new();
    if !anchors.is_empty() {
        facts.push_str("# 锚点信息\n");
        for a in &anchors {
            facts.push_str(&format!("- {}\n", a));
        }
    }
    if !characters.is_empty() {
        facts.push_str("\n# 角色设定\n");
        for c in &characters {
            facts.push_str(&format!("{}\n---\n", c));
        }
    }
    if !scenes.is_empty() {
        facts.push_str("\n# 场景设定\n");
        for s in &scenes {
            facts.push_str(&format!("{}\n---\n", s));
        }
    }
    if let Some(body) = body_state {
        facts.push_str("\n# 当前身体状态快照\n");
        facts.push_str(&body);
    }

    let prompt = format!(
        "你是一位小说一致性审查员。请检查下面的生成文本是否与作品设定存在矛盾、遗忘或冲突。\n\n{}\n\n# 生成文本\n{}\n\n请只输出 JSON 数组，不要任何解释。每个元素包含：\n- warningType: \"anchor\"|\"character\"|\"scene\"|\"body\"\n- description: 中文问题描述\n- quote: 生成文本中涉及的原句片段（没有则空字符串）\n\n如果没有问题，请输出空数组 []。",
        facts,
        req.text
    );

    let provider = state.generation_provider.read().await.clone();
    let result = provider
        .generate(GenerateRequest {
            request_type: "consistency_check".to_string(),
            system_prompt: "你专门发现小说生成文本与设定之间的矛盾。只输出 JSON 数组。".to_string(),
            user_prompt: prompt,
            max_tokens: Some(600),
            temperature: Some(0.2),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;

    let warnings: Vec<InconsistencyWarning> = match extract_json_array(&result.text) {
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| {
                Some(InconsistencyWarning {
                    warning_type: v.get("warningType")?.as_str()?.to_string(),
                    description: v.get("description")?.as_str()?.to_string(),
                    quote: v.get("quote")?.as_str().unwrap_or("").to_string(),
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    Ok(warnings)
}

// ─────────────────────────────────────────────────────────────────────────────
// F-17: System prompt auto-tuning
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TuningRecommendation {
    pub dimension: String,
    pub finding: String,
    pub suggested_action: String,
}

fn aggregate_features(fingerprints: &[String]) -> Option<StyleFeatures> {
    let parsed: Vec<StyleFeatures> = fingerprints
        .iter()
        .filter_map(|s| serde_json::from_str(s).ok())
        .collect();
    if parsed.is_empty() {
        return None;
    }
    let count = parsed.len() as f64;
    let avg = |f: fn(&StyleFeatures) -> f64| parsed.iter().map(f).sum::<f64>() / count;
    Some(StyleFeatures {
        sentence_length_avg: avg(|x| x.sentence_length_avg),
        sentence_length_std: avg(|x| x.sentence_length_std),
        description_ratio: avg(|x| x.description_ratio),
        dialogue_ratio: avg(|x| x.dialogue_ratio),
        top_keywords: Vec::new(),
        description: None,
        sex_style_fingerprint: None,
    })
}

#[tauri::command]
pub fn recommend_system_prompt_tuning() -> Result<Vec<TuningRecommendation>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT rating, style_fingerprint FROM material
         WHERE source_type = 'ai_generated' AND status = 'active'
           AND rating > 0
           AND created_at >= date('now', '-90 days')",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    if rows.len() < 10 {
        return Ok(Vec::new());
    }

    let high: Vec<String> = rows
        .iter()
        .filter(|(r, _)| *r >= 4)
        .map(|(_, fp)| fp.clone())
        .collect();
    let low: Vec<String> = rows
        .iter()
        .filter(|(r, _)| *r <= 2)
        .map(|(_, fp)| fp.clone())
        .collect();

    if high.len() < 3 || low.len() < 3 {
        return Ok(Vec::new());
    }

    let high_f = aggregate_features(&high).unwrap();
    let low_f = aggregate_features(&low).unwrap();

    let mut recommendations = Vec::new();

    let desc_diff = high_f.description_ratio - low_f.description_ratio;
    if desc_diff.abs() > 0.03 {
        if desc_diff > 0.0 {
            recommendations.push(TuningRecommendation {
                dimension: "描写密度".to_string(),
                finding: format!(
                    "高分生成描写占比 {:.1}%，低分生成 {:.1}%",
                    high_f.description_ratio * 100.0,
                    low_f.description_ratio * 100.0
                ),
                suggested_action:
                    "在 System Prompt 中强调感官细节、环境氛围与动作描写，要求 AI 增加非对话篇幅。"
                        .to_string(),
            });
        } else {
            recommendations.push(TuningRecommendation {
                dimension: "描写密度".to_string(),
                finding: format!(
                    "低分生成描写占比 {:.1}%，高于高分生成 {:.1}%",
                    low_f.description_ratio * 100.0,
                    high_f.description_ratio * 100.0
                ),
                suggested_action: "在 System Prompt 中要求 AI 减少冗余描写，加快叙事节奏，把笔墨集中在情节推进上。".to_string(),
            });
        }
    }

    let dialogue_diff = high_f.dialogue_ratio - low_f.dialogue_ratio;
    if dialogue_diff.abs() > 0.03 {
        if dialogue_diff > 0.0 {
            recommendations.push(TuningRecommendation {
                dimension: "对话比例".to_string(),
                finding: format!(
                    "高分生成对话占比 {:.1}%，低分生成 {:.1}%",
                    high_f.dialogue_ratio * 100.0,
                    low_f.dialogue_ratio * 100.0
                ),
                suggested_action:
                    "当前高分内容对话较多，可在 System Prompt 中鼓励通过对话推动情节、刻画人物。"
                        .to_string(),
            });
        } else {
            recommendations.push(TuningRecommendation {
                dimension: "对话比例".to_string(),
                finding: format!(
                    "低分生成对话占比 {:.1}%，高于高分生成 {:.1}%",
                    low_f.dialogue_ratio * 100.0,
                    high_f.dialogue_ratio * 100.0
                ),
                suggested_action: "近期低分内容对话过多，请在 System Prompt 中要求 AI 控制对话密度，增加叙述与描写。".to_string(),
            });
        }
    }

    let sentence_diff = high_f.sentence_length_avg - low_f.sentence_length_avg;
    if sentence_diff.abs() > 3.0 {
        if sentence_diff > 0.0 {
            recommendations.push(TuningRecommendation {
                dimension: "句长节奏".to_string(),
                finding: format!(
                    "高分生成平均句长 {:.1} 字，低分生成 {:.1} 字",
                    high_f.sentence_length_avg, low_f.sentence_length_avg
                ),
                suggested_action:
                    "在 System Prompt 中鼓励使用更绵长、复合的句式，营造细腻或凝重的节奏。"
                        .to_string(),
            });
        } else {
            recommendations.push(TuningRecommendation {
                dimension: "句长节奏".to_string(),
                finding: format!(
                    "低分生成平均句长 {:.1} 字，高于高分生成 {:.1} 字",
                    low_f.sentence_length_avg, high_f.sentence_length_avg
                ),
                suggested_action:
                    "近期低分内容句子偏长，请在 System Prompt 中要求 AI 多用短句、加快节奏。"
                        .to_string(),
            });
        }
    }

    // Compare high-rated corpus to the active style profile.
    // 注意：此处复用已有的 conn 查询激活画像 id，不能调用 get_active_style_profile_id()，
    // 否则会重复获取同一把 std Mutex（不可重入）导致自死锁。
    let active_profile_id: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'active_style_profile_id'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(profile_id) = active_profile_id {
        let profile_json: String = conn.query_row(
            "SELECT features FROM style_profile WHERE id = ?1",
            [&profile_id],
            |row| row.get(0),
        )?;
        if let Ok(profile) = serde_json::from_str::<StyleFeatures>(&profile_json) {
            if (high_f.sentence_length_avg - profile.sentence_length_avg).abs() > 5.0 {
                recommendations.push(TuningRecommendation {
                    dimension: "风格画像偏移".to_string(),
                    finding: format!(
                        "近期高分生成平均句长 {:.1} 字，风格画像为 {:.1} 字",
                        high_f.sentence_length_avg, profile.sentence_length_avg
                    ),
                    suggested_action: "高分生成与当前风格画像出现句长偏移，建议重新校准风格画像或在 System Prompt 中明确指定句式偏好。".to_string(),
                });
            }
            if (high_f.description_ratio - profile.description_ratio).abs() > 0.05 {
                recommendations.push(TuningRecommendation {
                    dimension: "风格画像偏移".to_string(),
                    finding: format!(
                        "近期高分生成描写占比 {:.1}%，风格画像为 {:.1}%",
                        high_f.description_ratio * 100.0,
                        profile.description_ratio * 100.0
                    ),
                    suggested_action: "高分生成与风格画像的描写密度不一致，建议重新校准风格画像或调整 System Prompt 中的描写权重。".to_string(),
                });
            }
        }
    }

    Ok(recommendations)
}

#[tauri::command]
pub fn apply_system_prompt_tuning(recommendations: Vec<String>) -> Result<(), AppError> {
    if recommendations.is_empty() {
        return Ok(());
    }

    let template = crate::commands::context::get_system_prompt_template()?;
    let base = if let Some(idx) = template.find("\n\n# 自动优化建议") {
        &template[..idx]
    } else {
        &template
    };

    let block = recommendations
        .iter()
        .map(|r| format!("- {}", r))
        .collect::<Vec<_>>()
        .join("\n");
    let new_template = format!("{}\n\n# 自动优化建议\n{}\n", base, block);

    crate::commands::context::set_system_prompt_template(new_template)
}
