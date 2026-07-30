use std::collections::HashSet;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

const GENERATION_PARAMS_KEY: &str = "generation_parameters";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SensoryWeights {
    #[serde(default)]
    visual: f32,
    #[serde(default)]
    tactile: f32,
    #[serde(default)]
    auditory: f32,
    #[serde(default)]
    olfactory: f32,
    #[serde(default)]
    mental: f32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Atmosphere {
    #[serde(default)]
    gentle_rough: f32,
    #[serde(default)]
    implicit_explicit: f32,
    #[serde(default)]
    romantic_primitive: f32,
    #[serde(default)]
    mental_action: f32,
    #[serde(default)]
    slow_fast: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerationParameters {
    #[serde(default)]
    sensory_weights: SensoryWeights,
    #[serde(default)]
    atmosphere: Atmosphere,
}

use crate::commands::privacy::{
    apply_privacy_filter_text, get_privacy_mode, list_privacy_filter_rules,
};
use crate::db;
use crate::embeddings::EmbeddingProvider;
use crate::error::AppError;
use crate::tokenizer::{count_tokens, truncate_from_end, truncate_from_start, truncate_to_tokens};
use crate::vectordb::{SearchFilter, VectorStore};

/// Token budget aligned with the requirements doc §3.6.
/// Total input context hard cap is 6000 tokens; 2000 reserved for generation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub system_prompt: usize,
    pub style_profile: usize,
    pub anchors: usize,
    pub character_scene_cards: usize,
    pub volume_summary: usize,
    pub chapter_summary: usize,
    pub rag_chunks: usize,
    pub cursor_prefix: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            // 风格画像合在系统指令里，与需求文档 §3.6 对齐
            system_prompt: 1200,
            style_profile: 0,
            anchors: 300,
            character_scene_cards: 600,
            volume_summary: 400,
            chapter_summary: 500,
            rag_chunks: 900,
            cursor_prefix: 2500,
        }
    }
}

impl Budget {
    pub fn total_input(&self) -> usize {
        self.system_prompt
            + self.style_profile
            + self.anchors
            + self.character_scene_cards
            + self.volume_summary
            + self.chapter_summary
            + self.rag_chunks
            + self.cursor_prefix
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRequest {
    pub book_id: String,
    pub chapter_id: String,
    pub cursor_prefix: String,
    pub rag_query: String,
    #[serde(default)]
    pub budget: Budget,
    #[serde(default)]
    pub max_rag_chunks: usize,
    #[serde(default)]
    pub content_levels: Vec<String>,
    pub scene_template_id: Option<String>,
}

impl Default for ContextRequest {
    fn default() -> Self {
        Self {
            book_id: String::new(),
            chapter_id: String::new(),
            cursor_prefix: String::new(),
            rag_query: String::new(),
            budget: Budget::default(),
            max_rag_chunks: 3,
            content_levels: vec!["general".to_string()],
            scene_template_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPayload {
    pub system_prompt: String,
    pub style_profile: Option<String>,
    pub anchors: Vec<String>,
    pub characters: Vec<String>,
    pub scenes: Vec<String>,
    pub volume_summary: Option<String>,
    pub previous_chapter_summaries: Vec<String>,
    pub current_chapter_summary: Option<String>,
    pub rag_chunks: Vec<ContextRagChunk>,
    pub cursor_prefix: String,
    pub token_counts: ContextTokenCounts,
    #[serde(default)]
    pub truncation_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRagChunk {
    pub material_id: String,
    pub chunk_index: u32,
    pub text: String,
    pub distance: f32,
    #[serde(default)]
    pub is_negative: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTokenCounts {
    pub system_prompt: usize,
    pub style_profile: usize,
    pub anchors: usize,
    pub characters: usize,
    pub scenes: usize,
    pub volume_summary: usize,
    pub chapter_summaries: usize,
    pub rag_chunks: usize,
    pub cursor_prefix: usize,
    pub total: usize,
}

/// Assembles a writing context according to the token budget.
pub async fn assemble_context(
    req: &ContextRequest,
    vector_store: &VectorStore,
    embedding_provider: &dyn EmbeddingProvider,
) -> Result<ContextPayload, AppError> {
    // Load all synchronous DB data first, then release the connection before any await.
    let adult_mode = crate::commands::context::get_adult_mode().unwrap_or(false);
    let privacy_enabled = get_privacy_mode().unwrap_or(false);
    let privacy_rules: Vec<crate::commands::privacy::PrivacyFilterRule> = if privacy_enabled {
        list_privacy_filter_rules()?
            .into_iter()
            .filter(|r| r.is_active)
            .collect()
    } else {
        Vec::new()
    };
    let raw = tokio::task::spawn_blocking({
        let chapter_id = req.chapter_id.clone();
        let book_id = req.book_id.clone();
        let cursor_prefix = req.cursor_prefix.clone();
        move || load_context_raw(&book_id, &chapter_id, &cursor_prefix, adult_mode)
    })
    .await
    .map_err(|e| AppError::Other(format!("加载上下文数据失败: {}", e)))??;

    // Apply privacy filter to sensitive user content before it reaches the LLM.
    let mut raw = raw;
    if privacy_enabled && !privacy_rules.is_empty() {
        if let Some(ref mut summary) = raw.volume_summary {
            *summary = apply_privacy_filter_text(summary, &privacy_rules);
        }
        if let Some(ref mut summary) = raw.current_chapter_summary {
            *summary = apply_privacy_filter_text(summary, &privacy_rules);
        }
        raw.previous_chapters = raw
            .previous_chapters
            .into_iter()
            .map(|(id, title, summary)| {
                (
                    id,
                    title,
                    apply_privacy_filter_text(&summary, &privacy_rules),
                )
            })
            .collect();
    }

    if raw.book_id != req.book_id {
        return Err(AppError::Other(format!(
            "章节 {} 不属于作品 {}",
            req.chapter_id, req.book_id
        )));
    }

    // RAG retrieval (async)
    let mut rag_chunks = retrieve_rag_chunks(
        vector_store,
        embedding_provider,
        &req.rag_query,
        req.max_rag_chunks,
        &req.content_levels,
    )
    .await?;

    if privacy_enabled && !privacy_rules.is_empty() {
        for chunk in &mut rag_chunks {
            chunk.text = apply_privacy_filter_text(&chunk.text, &privacy_rules);
        }
    }

    // Load optional scene template and merge into system prompt.
    let scene_template_prompts = match req.scene_template_id.as_ref() {
        Some(id) => load_scene_template_prompts(id)?,
        None => None,
    };
    let system_prompt = match scene_template_prompts {
        Some((prompt, adult_prompt, beats)) => {
            let mut merged = format!("{}\n\n# 场景模板\n{}", raw.system_prompt, prompt);
            if adult_mode && !adult_prompt.trim().is_empty() {
                merged.push_str(&format!("\n\n# 场景模板（成人向追加）\n{}", adult_prompt));
            }
            if adult_mode && !beats.trim().is_empty() {
                let beats_text = format_beats(&beats);
                if !beats_text.is_empty() {
                    merged.push_str(&format!(
                        "\n\n# 场景节拍表\n请按以下节拍结构推进本章场景，当前应优先完成第 1 个节拍：\n{}",
                        beats_text
                    ));
                }
            }
            merged
        }
        None => raw.system_prompt,
    };

    let system_prompt = append_sensory_weights(&system_prompt);
    let system_prompt = append_atmosphere(&system_prompt);
    let system_prompt = if adult_mode {
        append_sex_fingerprint_summary(&system_prompt, raw.style_profile_features.as_deref())
    } else {
        system_prompt
    };
    let system_prompt = if adult_mode {
        append_body_state_snapshot(&system_prompt, raw.body_state_snapshot.as_deref())
    } else {
        system_prompt
    };

    // Build raw payload
    let mut payload = ContextPayload {
        system_prompt,
        style_profile: raw.style_profile,
        anchors: raw.anchors,
        characters: raw.characters,
        scenes: raw.scenes,
        volume_summary: raw.volume_summary,
        previous_chapter_summaries: raw
            .previous_chapters
            .iter()
            .map(|(_, title, summary)| format!("{}: {}", title, summary))
            .collect(),
        current_chapter_summary: raw.current_chapter_summary,
        rag_chunks,
        cursor_prefix: if privacy_enabled && !privacy_rules.is_empty() {
            apply_privacy_filter_text(&req.cursor_prefix, &privacy_rules)
        } else {
            req.cursor_prefix.clone()
        },
        truncation_warnings: Vec::new(),
        token_counts: ContextTokenCounts {
            system_prompt: 0,
            style_profile: 0,
            anchors: 0,
            characters: 0,
            scenes: 0,
            volume_summary: 0,
            chapter_summaries: 0,
            rag_chunks: 0,
            cursor_prefix: 0,
            total: 0,
        },
    };

    // Apply token budget / truncation
    apply_budget(&mut payload, req.budget)?;

    Ok(payload)
}

const DEFAULT_SYSTEM_PROMPT_TEMPLATE: &str = "你是一位专业中文网络小说写作助手。请根据提供的作品设定、前文上下文、参考素材和当前光标位置，续写后续内容。要求：保持人物设定一致、语言风格统一、情节连贯、节奏紧凑。{forbidden_topics}";

fn load_scene_template_prompts(id: &str) -> Result<Option<(String, String, String)>, AppError> {
    let conn = db::get_db()?;
    match conn.query_row(
        "SELECT prompt_template, adult_prompt, beats FROM scene_template WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn load_generation_parameters() -> Result<GenerationParameters, AppError> {
    let conn = db::get_db()?;
    let json: String = match conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        [GENERATION_PARAMS_KEY],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(GenerationParameters::default()),
        Err(e) => return Err(e.into()),
    };
    let params: GenerationParameters = serde_json::from_str(&json).unwrap_or_default();
    Ok(params)
}

fn append_sensory_weights(system_prompt: &str) -> String {
    let weights = match load_generation_parameters() {
        Ok(params) => params.sensory_weights,
        Err(_) => return system_prompt.to_string(),
    };

    let total =
        weights.visual + weights.tactile + weights.auditory + weights.olfactory + weights.mental;
    if total <= 0.0 {
        return system_prompt.to_string();
    }

    let visual = (weights.visual / total * 100.0).round() as i32;
    let tactile = (weights.tactile / total * 100.0).round() as i32;
    let auditory = (weights.auditory / total * 100.0).round() as i32;
    let olfactory = (weights.olfactory / total * 100.0).round() as i32;
    let mental = 100 - visual - tactile - auditory - olfactory;

    format!(
        "{}\n\n# 感官权重\n请在描写中按以下比例分配笔墨：视觉 {}% / 触觉 {}% / 听觉 {}% / 嗅觉 {}% / 心理感受 {}%。",
        system_prompt, visual, tactile, auditory, olfactory, mental
    )
}

fn append_atmosphere(system_prompt: &str) -> String {
    let atmosphere = match load_generation_parameters() {
        Ok(params) => params.atmosphere,
        Err(_) => return system_prompt.to_string(),
    };

    let dims = [
        ("轻柔", "粗暴", atmosphere.gentle_rough),
        ("含蓄", "直白", atmosphere.implicit_explicit),
        ("浪漫", "原始", atmosphere.romantic_primitive),
        ("心理", "动作", atmosphere.mental_action),
        ("慢", "快", atmosphere.slow_fast),
    ];

    let parts: Vec<String> = dims
        .iter()
        .filter(|(_, _, v)| v.abs() >= 1.0)
        .map(|(left, right, v)| {
            let bias = v.clamp(-50.0, 50.0);
            let left_pct = (50.0 - bias) as i32;
            let right_pct = (50.0 + bias) as i32;
            format!("{} {}% / {} {}%", left, left_pct, right, right_pct)
        })
        .collect();

    if parts.is_empty() {
        return system_prompt.to_string();
    }

    format!(
        "{}\n\n# 氛围调色板\n请让描写整体偏向：{}。",
        system_prompt,
        parts.join("；")
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StyleFeaturesJson {
    sex_style_fingerprint: Option<crate::sex_fingerprint::SexStyleFingerprint>,
}

fn append_sex_fingerprint_summary(system_prompt: &str, features_json: Option<&str>) -> String {
    let features_json = match features_json {
        Some(s) if !s.trim().is_empty() => s,
        _ => return system_prompt.to_string(),
    };
    let features: StyleFeaturesJson = match serde_json::from_str(features_json) {
        Ok(f) => f,
        Err(_) => return system_prompt.to_string(),
    };
    let fingerprint = match features.sex_style_fingerprint {
        Some(fp) => fp,
        None => return system_prompt.to_string(),
    };
    let summary = crate::sex_fingerprint::render_fingerprint_summary(&fingerprint);
    if summary.is_empty() {
        return system_prompt.to_string();
    }
    format!(
        "{}\n\n# 作者性爱写作指纹摘要\n{}。请在成人场景中参考这些倾向。",
        system_prompt, summary
    )
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BodyStateSnapshot {
    position: String,
    clothing: std::collections::HashMap<String, String>,
    contact: Vec<String>,
    happened: Vec<String>,
    ongoing: String,
}

impl BodyStateSnapshot {
    fn render(&self) -> String {
        let clothing = if self.clothing.is_empty() {
            String::from("未提及")
        } else {
            self.clothing
                .iter()
                .map(|(k, v)| format!("{}：{}", k, v))
                .collect::<Vec<_>>()
                .join("；")
        };
        let contact = if self.contact.is_empty() {
            String::from("无")
        } else {
            self.contact.join("、")
        };
        let happened = if self.happened.is_empty() {
            String::from("无")
        } else {
            self.happened.join("、")
        };
        format!(
            "相对位置：{}\n衣物状态：{}\n身体接触点：{}\n已发生行为：{}\n当前动作：{}",
            self.position, clothing, contact, happened, self.ongoing
        )
    }
}

fn load_body_state_snapshot(
    conn: &rusqlite::Connection,
    chapter_id: &str,
    adult_mode: bool,
) -> Result<Option<String>, AppError> {
    if !adult_mode {
        return Ok(None);
    }
    let snapshot: Option<String> = conn
        .query_row(
            "SELECT snapshot FROM chapter_body_state WHERE chapter_id = ?1",
            [chapter_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(snapshot)
}

fn append_body_state_snapshot(system_prompt: &str, snapshot: Option<&str>) -> String {
    let snapshot = match snapshot {
        Some(s) if !s.trim().is_empty() && s != "{}" => s,
        _ => return system_prompt.to_string(),
    };
    let rendered = match serde_json::from_str::<BodyStateSnapshot>(snapshot) {
        Ok(s) => s.render(),
        Err(_) => snapshot.to_string(),
    };
    format!(
        "{}\n\n# 身体状态快照\n以下状态必须被下一段续写遵守，不得出现物理矛盾：\n{}",
        system_prompt, rendered
    )
}

#[derive(Debug, Deserialize)]
struct SceneBeat {
    id: u32,
    name: String,
    goal: String,
    length: String,
    pov: String,
    focus: String,
}

fn format_beats(beats_json: &str) -> String {
    let beats: Vec<SceneBeat> = match serde_json::from_str(beats_json) {
        Ok(b) => b,
        Err(_) => return String::new(),
    };
    beats
        .iter()
        .map(|b| {
            format!(
                "{}. {}：{}（{}，POV：{}，焦点：{}）",
                b.id, b.name, b.goal, b.length, b.pov, b.focus
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_system_prompt(conn: &rusqlite::Connection) -> Result<String, AppError> {
    let template: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'system_prompt_template'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| DEFAULT_SYSTEM_PROMPT_TEMPLATE.to_string());

    let forbidden_topics: String = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'forbidden_topics'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let forbidden_section = if forbidden_topics.trim().is_empty() {
        String::new()
    } else {
        format!("\n\n以下内容禁止出现：{}", forbidden_topics)
    };

    Ok(template.replace("{forbidden_topics}", &forbidden_section))
}

#[derive(Debug)]
struct RawContextData {
    book_id: String,
    system_prompt: String,
    volume_summary: Option<String>,
    current_chapter_summary: Option<String>,
    previous_chapters: Vec<(String, String, String)>, // id, title, summary
    style_profile: Option<String>,
    style_profile_features: Option<String>,
    anchors: Vec<String>,
    characters: Vec<String>,
    scenes: Vec<String>,
    body_state_snapshot: Option<String>,
}

fn load_context_raw(
    book_id: &str,
    chapter_id: &str,
    cursor_prefix: &str,
    adult_mode: bool,
) -> Result<RawContextData, AppError> {
    let conn = db::get_db()?;

    let (fetched_book_id, volume_id, _volume_number, chapter_number): (String, String, i32, i32) =
        conn.query_row(
            "SELECT v.book_id, v.id, v.number, c.number
             FROM chapter c
             JOIN volume v ON c.volume_id = v.id
             WHERE c.id = ?1",
            [chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;

    if fetched_book_id != book_id {
        return Ok(RawContextData {
            book_id: fetched_book_id,
            system_prompt: build_system_prompt(&conn)?,
            volume_summary: None,
            current_chapter_summary: None,
            previous_chapters: Vec::new(),
            style_profile: None,
            style_profile_features: None,
            anchors: Vec::new(),
            characters: Vec::new(),
            scenes: Vec::new(),
            body_state_snapshot: None,
        });
    }

    let volume_summary: Option<String> = conn
        .query_row(
            "SELECT summary FROM volume WHERE id = ?1",
            [&volume_id],
            |row| row.get(0),
        )
        .ok();

    let current_chapter_summary: Option<String> = conn
        .query_row(
            "SELECT summary FROM chapter WHERE id = ?1",
            [chapter_id],
            |row| row.get(0),
        )
        .ok();

    let mut prev_chapters_stmt = conn.prepare(
        "SELECT id, title, summary FROM chapter
         WHERE volume_id = ?1 AND number < ?2
         ORDER BY number DESC
         LIMIT 10",
    )?;
    let previous_chapters: Vec<(String, String, String)> = prev_chapters_stmt
        .query_map(params![&volume_id, chapter_number], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get::<_, String>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let active_profile_id: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'active_style_profile_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    let (style_profile, style_profile_features): (Option<String>, Option<String>) =
        match active_profile_id {
            Some(id) => conn
                .query_row(
                    "SELECT name, features FROM style_profile WHERE id = ?1",
                    [&id],
                    |row| Ok((row.get::<_, String>(0).ok(), row.get::<_, String>(1).ok())),
                )
                .optional()?
                .unwrap_or((None, None)),
            None => conn
                .query_row(
                    "SELECT name, features FROM style_profile ORDER BY updated_at DESC LIMIT 1",
                    [],
                    |row| Ok((row.get::<_, String>(0).ok(), row.get::<_, String>(1).ok())),
                )
                .optional()?
                .unwrap_or((None, None)),
        };
    let style_profile = style_profile.and_then(|name| {
        style_profile_features
            .as_ref()
            .map(|features| format!("{}\n{}", name, features))
    });

    let mut anchor_stmt = conn.prepare(
        "SELECT content FROM anchor
         WHERE book_id = ?1 AND is_active = 1
         ORDER BY category, created_at",
    )?;
    let anchors: Vec<String> = anchor_stmt
        .query_map([book_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let characters = load_matching_characters(&conn, book_id, cursor_prefix, adult_mode)?;
    let scenes = load_matching_scenes(&conn, book_id, cursor_prefix)?;
    let system_prompt = build_system_prompt(&conn)?;

    Ok(RawContextData {
        book_id: fetched_book_id,
        system_prompt,
        volume_summary,
        current_chapter_summary,
        previous_chapters,
        style_profile,
        style_profile_features,
        anchors,
        characters,
        scenes,
        body_state_snapshot: load_body_state_snapshot(&conn, chapter_id, adult_mode)
            .ok()
            .flatten(),
    })
}

fn load_matching_characters(
    conn: &rusqlite::Connection,
    book_id: &str,
    cursor_text: &str,
    adult_mode: bool,
) -> Result<Vec<String>, AppError> {
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

    let mut matched = Vec::new();
    for row in rows {
        let (
            name,
            aliases,
            description,
            background,
            traits,
            relationships,
            extended_profile,
            adult_profile,
        ) = row?;
        let names: Vec<&str> = aliases
            .split([',', '，', '/'])
            .chain(std::iter::once(name.as_str()))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        if names.iter().any(|n| cursor_text.contains(n)) {
            let extended = if extended_profile.trim().is_empty() || extended_profile == "{}" {
                String::new()
            } else {
                format!("\n扩展：{}", extended_profile)
            };
            let adult = if adult_mode && !adult_profile.trim().is_empty() {
                format!("\n身体档案：{}", adult_profile)
            } else {
                String::new()
            };
            let text = format!(
                "角色：{}\n简介：{}\n背景：{}\n性格：{}\n关系：{}{}{}",
                name, description, background, traits, relationships, extended, adult
            );
            matched.push(text);
        }
    }

    Ok(matched)
}

fn load_matching_scenes(
    conn: &rusqlite::Connection,
    book_id: &str,
    cursor_text: &str,
) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT name, description, location, time_period, atmosphere
         FROM scene_card WHERE book_id = ?1 LIMIT 50",
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

    let mut matched = Vec::new();
    let mut fallback: Option<(String, usize)> = None;
    for row in rows {
        let (name, description, location, time_period, atmosphere) = row?;
        let text = format!(
            "场景：{}\n描述：{}\n地点：{}\n时间：{}\n氛围：{}",
            name, description, location, time_period, atmosphere
        );

        let is_explicit = cursor_text.contains(&name)
            || cursor_text.contains(&location)
            || cursor_text.contains(&time_period)
            || cursor_text.contains(&atmosphere);

        if is_explicit {
            matched.push(text);
            continue;
        }

        // Track the most recently mentioned scene by name as a fallback.
        if let Some(pos) = cursor_text.rfind(&name) {
            if fallback
                .as_ref()
                .is_none_or(|(_, last_pos)| pos > *last_pos)
            {
                fallback = Some((text, pos));
            }
        }
    }

    if matched.is_empty() {
        if let Some((text, _)) = fallback {
            matched.push(text);
        }
    }

    Ok(matched)
}

async fn retrieve_rag_chunks(
    vector_store: &VectorStore,
    embedding_provider: &dyn EmbeddingProvider,
    query: &str,
    max_chunks: usize,
    content_levels: &[String],
) -> Result<Vec<ContextRagChunk>, AppError> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let embeddings = embedding_provider.embed(&[query.to_string()]).await?;
    let query_vector = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Other("嵌入查询失败".to_string()))?;

    let content_levels = if content_levels.is_empty() {
        None
    } else {
        Some(content_levels.to_vec())
    };

    let positive_limit = max_chunks.saturating_sub(1).max(1);
    let negative_limit = if max_chunks >= 2 { 1 } else { 0 };

    let positive_filter = SearchFilter {
        tag_filter: None,
        content_levels: content_levels.clone(),
        status: Some("active".to_string()),
        min_rating: None,
        max_rating: None,
        is_negative: Some(false),
    };
    let negative_filter = SearchFilter {
        tag_filter: None,
        content_levels,
        status: Some("active".to_string()),
        min_rating: None,
        max_rating: None,
        is_negative: Some(true),
    };

    let mut chunks = Vec::new();

    let positive_results = vector_store
        .search(&query_vector, positive_limit, positive_filter, 0.001)
        .await?;
    for result in positive_results {
        chunks.push(ContextRagChunk {
            material_id: result.material_id,
            chunk_index: result.chunk_index,
            text: result.chunk_text,
            distance: result.distance,
            is_negative: result.is_negative,
        });
    }

    if negative_limit > 0 {
        let negative_results = vector_store
            .search(&query_vector, negative_limit, negative_filter, 0.001)
            .await?;
        for result in negative_results {
            chunks.push(ContextRagChunk {
                material_id: result.material_id,
                chunk_index: result.chunk_index,
                text: result.chunk_text,
                distance: result.distance,
                is_negative: result.is_negative,
            });
        }
    }

    // Track hits for tiered storage decisions.
    let material_ids: Vec<String> = chunks
        .iter()
        .map(|c| c.material_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !material_ids.is_empty() {
        let now = Utc::now().to_rfc3339();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            let conn = db::get_db()?;
            for id in material_ids {
                conn.execute(
                    "UPDATE material SET hit_count = hit_count + 1, last_hit_at = ?1 WHERE id = ?2",
                    params![&now, &id],
                )?;
            }
            Ok(())
        })
        .await
        .map_err(|e| AppError::Other(format!("更新素材命中统计失败: {}", e)))??;
    }

    Ok(chunks)
}

/// Apply token budget. Truncation priority (first to cut → last to cut).
/// Matches the requirement doc §3.6: rightmost items are most protected.
/// 1. RAG chunks
/// 2. Scene cards
/// 3. Character cards
/// 4. Previous chapter summaries
/// 5. Current chapter summary
/// 6. Volume summary
/// 7. Anchors
/// 8. Cursor prefix
/// 9. System prompt (last resort)
fn apply_budget(payload: &mut ContextPayload, budget: Budget) -> Result<(), AppError> {
    let mut warnings: Vec<String> = Vec::new();

    // Merge style profile into system prompt (requirement doc treats style as part of system prompt)
    if let Some(style) = payload.style_profile.take() {
        if !style.trim().is_empty() {
            payload.system_prompt = format!("{}\n\n# 风格画像\n{}", payload.system_prompt, style);
        }
    }

    // First, truncate individual sections to their own budgets
    let sys_orig = count_tokens(&payload.system_prompt)?;
    payload.system_prompt = truncate_from_end(&payload.system_prompt, budget.system_prompt)?;
    if sys_orig > budget.system_prompt {
        warnings.push(format!(
            "系统指令已从 {} tokens 截断至 {} tokens",
            sys_orig, budget.system_prompt
        ));
    }

    payload.anchors =
        truncate_vec_with_warning(&payload.anchors, budget.anchors, "锚点", &mut warnings)?;
    payload.characters = truncate_vec_with_warning(
        &payload.characters,
        budget.character_scene_cards,
        "角色卡",
        &mut warnings,
    )?;
    payload.scenes = truncate_vec_with_warning(
        &payload.scenes,
        budget.character_scene_cards,
        "场景卡",
        &mut warnings,
    )?;

    if let Some(summary) = &mut payload.volume_summary {
        let orig = count_tokens(summary)?;
        *summary = truncate_from_end(summary, budget.volume_summary)?;
        if orig > budget.volume_summary {
            warnings.push(format!(
                "卷摘要已从 {} tokens 截断至 {} tokens",
                orig, budget.volume_summary
            ));
        }
    }

    payload.previous_chapter_summaries = truncate_vec_with_warning(
        &payload.previous_chapter_summaries,
        budget.chapter_summary,
        "前文章节摘要",
        &mut warnings,
    )?;

    if let Some(summary) = &mut payload.current_chapter_summary {
        let orig = count_tokens(summary)?;
        *summary = truncate_from_end(summary, budget.chapter_summary)?;
        if orig > budget.chapter_summary {
            warnings.push(format!(
                "本章摘要已从 {} tokens 截断至 {} tokens",
                orig, budget.chapter_summary
            ));
        }
    }

    // RAG chunks: truncate each chunk to a per-chunk budget
    let per_chunk_budget = budget.rag_chunks / payload.rag_chunks.len().max(1);
    let mut rag_truncated = false;
    for chunk in &mut payload.rag_chunks {
        let orig = count_tokens(&chunk.text)?;
        chunk.text = truncate_from_end(&chunk.text, per_chunk_budget)?;
        if orig > per_chunk_budget {
            rag_truncated = true;
        }
    }
    if rag_truncated {
        warnings.push(format!(
            "RAG 素材片段已按 {} tokens/段 截断",
            per_chunk_budget
        ));
    }

    // Cursor prefix: keep the tail (most recent context)
    let cursor_orig = count_tokens(&payload.cursor_prefix)?;
    payload.cursor_prefix = truncate_from_start(&payload.cursor_prefix, budget.cursor_prefix)?;
    if cursor_orig > budget.cursor_prefix {
        warnings.push(format!(
            "前文内容已从 {} tokens 截断至 {} tokens",
            cursor_orig, budget.cursor_prefix
        ));
    }

    // Now enforce the hard cap by iteratively cutting from lowest priority
    let orig_rag_count = payload.rag_chunks.len();
    let orig_scene_count = payload.scenes.len();
    let orig_char_count = payload.characters.len();
    let orig_prev_summary_count = payload.previous_chapter_summaries.len();
    let orig_anchor_count = payload.anchors.len();

    loop {
        let total = count_total_tokens(payload)?;
        if total <= budget.total_input() {
            break;
        }

        // 1. Drop the lowest-priority RAG chunk first
        if !payload.rag_chunks.is_empty() {
            payload.rag_chunks.pop();
            continue;
        }

        // 2. Drop scene cards
        if !payload.scenes.is_empty() {
            payload.scenes.pop();
            continue;
        }

        // 3. Drop character cards
        if !payload.characters.is_empty() {
            payload.characters.pop();
            continue;
        }

        // 4. Drop previous chapter summaries
        if !payload.previous_chapter_summaries.is_empty() {
            payload.previous_chapter_summaries.pop();
            continue;
        }

        // 5. Drop / truncate current chapter summary
        if let Some(summary) = &mut payload.current_chapter_summary {
            let tokens = count_tokens(summary)?;
            if tokens > 50 {
                *summary = truncate_to_tokens(summary, tokens * 9 / 10, true)?;
                continue;
            } else {
                payload.current_chapter_summary = None;
                warnings.push("本章摘要因超出总 Token 预算被移除".to_string());
                continue;
            }
        }

        // 6. Truncate volume summary
        if let Some(summary) = &mut payload.volume_summary {
            let tokens = count_tokens(summary)?;
            if tokens > 50 {
                *summary = truncate_to_tokens(summary, tokens * 9 / 10, true)?;
                continue;
            } else {
                payload.volume_summary = None;
                warnings.push("卷摘要因超出总 Token 预算被移除".to_string());
                continue;
            }
        }

        // 7. Drop anchors
        if !payload.anchors.is_empty() {
            payload.anchors.pop();
            continue;
        }

        // 8. Truncate cursor prefix from the start (less protected than system prompt)
        let cursor_tokens = count_tokens(&payload.cursor_prefix)?;
        if cursor_tokens > 100 {
            let target = cursor_tokens * 9 / 10;
            payload.cursor_prefix = truncate_to_tokens(&payload.cursor_prefix, target, false)?;
            warnings.push(format!(
                "前文内容因超出总 Token 预算进一步截断至 {} tokens",
                target
            ));
            continue;
        }

        // 9. Last resort: truncate system prompt (style is already merged here)
        let sys_tokens = count_tokens(&payload.system_prompt)?;
        if sys_tokens > 100 {
            let target = sys_tokens * 9 / 10;
            payload.system_prompt = truncate_to_tokens(&payload.system_prompt, target, true)?;
            warnings.push(format!(
                "系统指令因超出总 Token 预算进一步截断至 {} tokens",
                target
            ));
            continue;
        }

        // Cannot reduce further
        break;
    }

    if payload.rag_chunks.len() < orig_rag_count {
        warnings.push(format!(
            "RAG 素材从 {} 段缩减至 {} 段",
            orig_rag_count,
            payload.rag_chunks.len()
        ));
    }
    if payload.scenes.len() < orig_scene_count {
        warnings.push(format!(
            "场景卡从 {} 张丢弃至 {} 张",
            orig_scene_count,
            payload.scenes.len()
        ));
    }
    if payload.characters.len() < orig_char_count {
        warnings.push(format!(
            "角色卡从 {} 张丢弃至 {} 张",
            orig_char_count,
            payload.characters.len()
        ));
    }
    if payload.previous_chapter_summaries.len() < orig_prev_summary_count {
        warnings.push(format!(
            "前文章节摘要从 {} 条丢弃至 {} 条",
            orig_prev_summary_count,
            payload.previous_chapter_summaries.len()
        ));
    }
    if payload.anchors.len() < orig_anchor_count {
        warnings.push(format!(
            "锚点从 {} 条丢弃至 {} 条",
            orig_anchor_count,
            payload.anchors.len()
        ));
    }

    // Fill token counts
    payload.token_counts = ContextTokenCounts {
        system_prompt: count_tokens(&payload.system_prompt)?,
        style_profile: 0,
        anchors: count_joined(&payload.anchors)?,
        characters: count_joined(&payload.characters)?,
        scenes: count_joined(&payload.scenes)?,
        volume_summary: payload
            .volume_summary
            .as_ref()
            .map(|s| count_tokens(s).unwrap_or(0))
            .unwrap_or(0),
        chapter_summaries: count_joined(&payload.previous_chapter_summaries)?
            + payload
                .current_chapter_summary
                .as_ref()
                .map(|s| count_tokens(s).unwrap_or(0))
                .unwrap_or(0),
        rag_chunks: payload
            .rag_chunks
            .iter()
            .map(|c| count_tokens(&c.text).unwrap_or(0))
            .sum(),
        cursor_prefix: count_tokens(&payload.cursor_prefix)?,
        total: 0,
    };

    payload.token_counts.total = count_total_tokens(payload)?;
    payload.truncation_warnings = warnings;

    Ok(())
}

fn count_joined(items: &[String]) -> Result<usize, AppError> {
    if items.is_empty() {
        return Ok(0);
    }
    count_tokens(&items.join("\n"))
}

fn count_total_tokens(payload: &ContextPayload) -> Result<usize, AppError> {
    let mut total = count_tokens(&payload.system_prompt)?;
    if let Some(s) = &payload.style_profile {
        total += count_tokens(s)?;
    }
    total += count_joined(&payload.anchors)?;
    total += count_joined(&payload.characters)?;
    total += count_joined(&payload.scenes)?;
    if let Some(s) = &payload.volume_summary {
        total += count_tokens(s)?;
    }
    total += count_joined(&payload.previous_chapter_summaries)?;
    if let Some(s) = &payload.current_chapter_summary {
        total += count_tokens(s)?;
    }
    for chunk in &payload.rag_chunks {
        total += count_tokens(&chunk.text)?;
    }
    total += count_tokens(&payload.cursor_prefix)?;
    Ok(total)
}

/// Truncate a list of text items to fit within a token budget.
/// Items are dropped from the end until the remaining fit.
fn truncate_vec(items: &[String], max_tokens: usize) -> Result<Vec<String>, AppError> {
    let mut result = items.to_vec();
    loop {
        let tokens = count_joined(&result)?;
        if tokens <= max_tokens || result.is_empty() {
            break;
        }
        result.pop();
    }
    Ok(result)
}

fn truncate_vec_with_warning(
    items: &[String],
    max_tokens: usize,
    label: &str,
    warnings: &mut Vec<String>,
) -> Result<Vec<String>, AppError> {
    let orig_tokens = count_joined(items)?;
    let result = truncate_vec(items, max_tokens)?;
    if orig_tokens > max_tokens && result.len() < items.len() {
        warnings.push(format!(
            "{}已从 {} tokens/{} 条截断至 {} 条",
            label,
            orig_tokens,
            items.len(),
            result.len()
        ));
    } else if orig_tokens > max_tokens {
        warnings.push(format!(
            "{}已从 {} tokens 截断至 {} tokens",
            label, orig_tokens, max_tokens
        ));
    }
    Ok(result)
}

/// Render the assembled context into a single prompt string for LLM usage.
pub fn render_context(payload: &ContextPayload) -> String {
    let mut parts = Vec::new();
    parts.push(format!("# 系统指令\n{}", payload.system_prompt));

    if let Some(style) = &payload.style_profile {
        parts.push(format!("# 风格画像\n{}", style));
    }

    if !payload.anchors.is_empty() {
        parts.push(format!("# 锚点信息\n{}", payload.anchors.join("\n")));
    }

    if !payload.characters.is_empty() {
        parts.push(format!("# 角色卡\n{}", payload.characters.join("\n\n")));
    }

    if !payload.scenes.is_empty() {
        parts.push(format!("# 场景卡\n{}", payload.scenes.join("\n\n")));
    }

    if let Some(summary) = &payload.volume_summary {
        parts.push(format!("# 当前卷摘要\n{}", summary));
    }

    if !payload.previous_chapter_summaries.is_empty() {
        parts.push(format!(
            "# 已完成章摘要\n{}",
            payload.previous_chapter_summaries.join("\n")
        ));
    }

    if let Some(summary) = &payload.current_chapter_summary {
        parts.push(format!("# 本章摘要\n{}", summary));
    }

    let positive_chunks: Vec<_> = payload
        .rag_chunks
        .iter()
        .filter(|c| !c.is_negative)
        .collect();
    let negative_chunks: Vec<_> = payload
        .rag_chunks
        .iter()
        .filter(|c| c.is_negative)
        .collect();

    if !positive_chunks.is_empty() {
        let rag_text = positive_chunks
            .iter()
            .map(|c| format!("[参考片段]\n{}", c.text))
            .collect::<Vec<_>>()
            .join("\n\n");
        parts.push(format!("# 参考素材（请模仿）\n{}", rag_text));
    }

    if !negative_chunks.is_empty() {
        let rag_text = negative_chunks
            .iter()
            .map(|c| format!("[参考片段]\n{}", c.text))
            .collect::<Vec<_>>()
            .join("\n\n");
        parts.push(format!("# 参考素材（请避免）\n{}", rag_text));
    }

    parts.push(format!("# 前文\n{}\n\n请续写：", payload.cursor_prefix));

    parts.join("\n\n")
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_budget_total_input() {
        let budget = Budget::default();
        let expected = budget.system_prompt
            + budget.style_profile
            + budget.anchors
            + budget.character_scene_cards
            + budget.volume_summary
            + budget.chapter_summary
            + budget.rag_chunks
            + budget.cursor_prefix;
        assert_eq!(budget.total_input(), expected);
    }

    #[test]
    fn test_context_request_default_content_levels() {
        let req = ContextRequest::default();
        assert_eq!(req.content_levels, vec!["general"]);
        assert_eq!(req.max_rag_chunks, 3);
    }
}
