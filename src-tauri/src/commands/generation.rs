use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::commands::ai_model::find_reachable_ollama_model;
use crate::context::{assemble_context, render_context, Budget, ContextRequest};
use crate::error::AppError;
use crate::llm::{GenerateRequest, StreamEvent};
use crate::state::AppState;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContinueRequest {
    pub book_id: String,
    pub chapter_id: String,
    pub cursor_prefix: String,
    pub rag_query: String,
    pub request_type: String, // "continue" | "rewrite" | "outline"
    pub selected_text: Option<String>,
    pub instruction: Option<String>,
    pub budget: Option<Budget>,
    #[serde(default)]
    pub content_levels: Vec<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub repetition_penalty: Option<f32>,
    pub frequency_penalty: Option<f32>,
    pub max_tokens: Option<u32>,
    pub scene_template_id: Option<String>,
    pub synopsis: Option<String>,
}

#[tauri::command]
pub async fn stream_generate(
    req: ContinueRequest,
    state: State<'_, AppState>,
    channel: tauri::ipc::Channel<StreamEvent>,
) -> Result<String, AppError> {
    let start_time = std::time::Instant::now();

    let context_req = ContextRequest {
        book_id: req.book_id.clone(),
        chapter_id: req.chapter_id.clone(),
        cursor_prefix: req.cursor_prefix.clone(),
        rag_query: req.rag_query.clone(),
        budget: req.budget.unwrap_or_default(),
        max_rag_chunks: 3,
        content_levels: req.content_levels.clone(),
        scene_template_id: req.scene_template_id.clone(),
    };

    let vector_store = state.vector_store().await?;
    let context = assemble_context(
        &context_req,
        &vector_store,
        state.embedding_provider.as_ref(),
    )
    .await?;

    let system_prompt = context.system_prompt.clone();
    let user_prompt = build_user_prompt(&req, &context);

    let gen_request = GenerateRequest {
        request_type: req.request_type.clone(),
        system_prompt,
        user_prompt,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        top_p: req.top_p,
        top_k: req.top_k,
        repetition_penalty: req.repetition_penalty,
        frequency_penalty: req.frequency_penalty,
    };

    let cancel_token = CancellationToken::new();
    {
        let mut cancel_guard = state.generation_cancel.lock().await;
        cancel_guard.insert("single".to_string(), cancel_token.clone());
    }

    let provider = state.generation_provider.read().await.clone();

    let result = provider
        .generate_stream(gen_request.clone(), channel.clone(), cancel_token.clone())
        .await;

    // Fallback to a local Ollama model if the cloud provider failed and Ollama is reachable.
    let result = if result.is_err()
        && provider.config().provider == "openai_compatible"
        && !cancel_token.is_cancelled()
    {
        if let Some(fallback_model) = find_reachable_ollama_model().await? {
            state.switch_generation_provider(&fallback_model.id).await?;
            let provider = state.generation_provider.read().await.clone();
            provider
                .generate_stream(gen_request, channel, cancel_token.clone())
                .await
        } else {
            result
        }
    } else {
        result
    };

    {
        let mut cancel_guard = state.generation_cancel.lock().await;
        cancel_guard.remove("single");
    }

    // Log generation attempt (best-effort)
    let provider = state.generation_provider.read().await.clone();
    let latency_ms = start_time.elapsed().as_millis() as i64;
    let log_id = log_generation(
        &req,
        &context,
        &provider.config().provider,
        &provider.config().model,
        latency_ms,
    )
    .unwrap_or_default();

    result.map(|_| log_id)
}

#[tauri::command]
pub async fn abort_generation(state: State<'_, AppState>) -> Result<(), AppError> {
    let guard = state.generation_cancel.lock().await;
    if let Some(token) = guard.get("single") {
        token.cancel();
    }
    Ok(())
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchGenerateRequest {
    pub group_id: String,
    pub branch_index: usize,
    pub total_branches: usize,
    pub base: ContinueRequest,
}

fn branch_prompt_suffix(branch_index: usize) -> &'static str {
    match branch_index % 3 {
        0 => "\n\n【分支引导】请在续写中更侧重动作、冲突和外部事件推进，节奏偏快，场面感强。",
        1 => "\n\n【分支引导】请在续写中更侧重心理描写、人物情绪和内心独白，节奏偏缓，细腻含蓄。",
        2 => "\n\n【分支引导】请在续写中更侧重对话和人物互动，让语言自然生动，通过对话推动情节。",
        _ => "",
    }
}

#[tauri::command]
pub async fn stream_generate_branch(
    req: BranchGenerateRequest,
    state: State<'_, AppState>,
    channel: tauri::ipc::Channel<StreamEvent>,
) -> Result<String, AppError> {
    let start_time = std::time::Instant::now();
    let base = &req.base;

    let context_req = ContextRequest {
        book_id: base.book_id.clone(),
        chapter_id: base.chapter_id.clone(),
        cursor_prefix: base.cursor_prefix.clone(),
        rag_query: base.rag_query.clone(),
        budget: base.budget.unwrap_or_default(),
        max_rag_chunks: 3,
        content_levels: base.content_levels.clone(),
        scene_template_id: base.scene_template_id.clone(),
    };

    let vector_store = state.vector_store().await?;
    let context = assemble_context(
        &context_req,
        &vector_store,
        state.embedding_provider.as_ref(),
    )
    .await?;

    let system_prompt = format!(
        "{}{}",
        context.system_prompt,
        branch_prompt_suffix(req.branch_index)
    );
    let user_prompt = build_user_prompt(base, &context);

    let gen_request = GenerateRequest {
        request_type: base.request_type.clone(),
        system_prompt,
        user_prompt,
        max_tokens: base.max_tokens,
        temperature: base.temperature,
        top_p: base.top_p,
        top_k: base.top_k,
        repetition_penalty: base.repetition_penalty,
        frequency_penalty: base.frequency_penalty,
    };

    let cancel_key = format!("{}:{}", req.group_id, req.branch_index);
    let cancel_token = CancellationToken::new();
    {
        let mut cancel_guard = state.generation_cancel.lock().await;
        cancel_guard.insert(cancel_key.clone(), cancel_token.clone());
    }

    let provider = state.generation_provider.read().await.clone();
    let model_name = provider.config().model.clone();

    let result = provider
        .generate_stream(gen_request, channel, cancel_token.clone())
        .await;

    {
        let mut cancel_guard = state.generation_cancel.lock().await;
        cancel_guard.remove(&cancel_key);
    }

    let latency_ms = start_time.elapsed().as_millis() as i64;
    let log_id = log_generation(
        base,
        &context,
        &provider.config().provider,
        &model_name,
        latency_ms,
    )
    .unwrap_or_default();

    result.map(|_| log_id)
}

#[tauri::command]
pub async fn abort_generation_branch(
    group_id: String,
    branch_index: usize,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let key = format!("{}:{}", group_id, branch_index);
    let guard = state.generation_cancel.lock().await;
    if let Some(token) = guard.get(&key) {
        token.cancel();
    }
    Ok(())
}

fn build_user_prompt(req: &ContinueRequest, context: &crate::context::ContextPayload) -> String {
    let rendered = render_context(context);

    match req.request_type.as_str() {
        "rewrite" => {
            let selected = req.selected_text.clone().unwrap_or_default();
            let instruction = req.instruction.clone().unwrap_or_default();
            format!(
                "{}\n\n请改写以下选中文本。要求：{}\n\n选中文本：{}\n\n改写结果：",
                rendered, instruction, selected
            )
        }
        "outline" => {
            let synopsis = req.synopsis.clone().unwrap_or_default();
            if synopsis.is_empty() {
                format!(
                    "{}\n\n请根据以上信息，生成后续章节大纲。每章包含标题和一句话摘要。",
                    rendered
                )
            } else {
                format!(
                    "{}\n\n请根据以下故事梗概生成章节大纲。每章包含标题和一句话摘要。\n\n故事梗概：{}\n\n章节大纲：",
                    rendered, synopsis
                )
            }
        }
        _ => format!("{}\n\n请接续上文继续写作：", rendered),
    }
}

fn log_generation(
    req: &ContinueRequest,
    context: &crate::context::ContextPayload,
    provider_name: &str,
    model_name: &str,
    latency_ms: i64,
) -> Result<String, AppError> {
    // 注意：必须在获取 db 锁之前调用 get_active_style_profile_id，
    // 该函数内部也会获取同一把 std Mutex（不可重入），否则自死锁。
    let style_profile_id = crate::commands::style_profile::get_active_style_profile_id()
        .ok()
        .flatten();
    let conn = crate::db::get_db()?;
    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    // generation_log.model_id 引用 ai_model(id)，必须存 ai_model 主键而非模型名，
    // 否则违反外键约束导致写入失败（找不到时退化为 NULL）。
    let model_id: Option<String> = conn
        .query_row(
            "SELECT id FROM ai_model WHERE provider = ?1 AND model_name = ?2 LIMIT 1",
            params![provider_name, model_name],
            |row| row.get(0),
        )
        .optional()?;

    conn.execute(
        "INSERT INTO generation_log (
            id, model_id, chapter_id, request_type,
            input_tokens, output_tokens, latency_ms,
            rating, accepted, style_profile_id, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            &id,
            model_id.as_deref(),
            &req.chapter_id,
            &req.request_type,
            context.token_counts.total as i64,
            0,
            latency_ms,
            0,
            0,
            style_profile_id.as_deref(),
            &now
        ],
    )?;

    Ok(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Beat execution engine
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize, Clone)]
struct Beat {
    #[allow(dead_code)]
    id: String,
    name: String,
    goal: String,
    #[serde(default)]
    length: String,
    #[serde(default)]
    focus: String,
}

fn load_beats(template_id: &str) -> Result<Vec<Beat>, AppError> {
    let conn = crate::db::get_db()?;
    let beats_json: String = conn.query_row(
        "SELECT beats FROM scene_template WHERE id = ?1",
        [template_id],
        |row| row.get(0),
    )?;
    if beats_json.trim().is_empty() {
        return Ok(Vec::new());
    }
    let beats: Vec<Beat> = serde_json::from_str(&beats_json)?;
    Ok(beats)
}

#[tauri::command]
pub async fn stream_generate_beats(
    req: ContinueRequest,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let template_id = req
        .scene_template_id
        .as_deref()
        .ok_or_else(|| AppError::Other("必须选择场景模板".to_string()))?;
    let beats = load_beats(template_id)?;
    if beats.is_empty() {
        return Err(AppError::Other("场景模板没有定义节拍".to_string()));
    }

    let context_req = ContextRequest {
        book_id: req.book_id.clone(),
        chapter_id: req.chapter_id.clone(),
        cursor_prefix: req.cursor_prefix.clone(),
        rag_query: req.rag_query.clone(),
        budget: req.budget.unwrap_or_default(),
        max_rag_chunks: 3,
        content_levels: req.content_levels.clone(),
        scene_template_id: Some(template_id.to_string()),
    };

    let vector_store = state.vector_store().await?;
    let context = assemble_context(
        &context_req,
        &vector_store,
        state.embedding_provider.as_ref(),
    )
    .await?;

    let base_system_prompt = context.system_prompt.clone();
    let base_user_prompt = build_user_prompt(&req, &context);

    let provider = state.generation_provider.read().await.clone();
    let mut accumulated = String::new();

    for beat in &beats {
        let beat_system_prompt = format!(
            "{}\n\n# 当前节拍：{}\n目标：{}\n重点：{}\n字数建议：{}",
            base_system_prompt, beat.name, beat.goal, beat.focus, beat.length
        );
        let continuation_hint = if accumulated.is_empty() {
            String::new()
        } else {
            format!(
                "\n\n已生成的本节内容：\n{}\n请接着完成当前节拍，不要重复已写内容。",
                accumulated
            )
        };
        let beat_user_prompt = format!(
            "{}\n\n【当前节拍：{}】{}\n只写当前节拍，不要提前写后续节拍。",
            base_user_prompt, beat.name, continuation_hint
        );

        let gen_request = GenerateRequest {
            request_type: "beat".to_string(),
            system_prompt: beat_system_prompt,
            user_prompt: beat_user_prompt,
            max_tokens: req.max_tokens,
            temperature: req.temperature,
            top_p: req.top_p,
            top_k: req.top_k,
            repetition_penalty: req.repetition_penalty,
            frequency_penalty: req.frequency_penalty,
        };

        let result = provider.generate(gen_request).await?;
        if !accumulated.is_empty() && !result.text.trim().is_empty() {
            accumulated.push('\n');
        }
        accumulated.push_str(&result.text);
    }

    Ok(accumulated)
}
