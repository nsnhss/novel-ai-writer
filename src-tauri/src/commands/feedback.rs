use chrono::Utc;
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

use crate::chunker::{chunk_text, ChunkConfig};
use crate::commands::style_profile::{
    compute_material_style_fingerprint, get_active_style_profile_id,
    get_auto_recalibrate_style_profile, recalibrate_active_style_profile,
    RecalibrateStyleProfileRequest,
};
use crate::db;
use crate::error::AppError;
use crate::models::Material;
use crate::state::AppState;
use crate::vectordb::VectorRecord;

/// Frontend payload for scoring and optionally accepting a generation.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmitFeedbackRequest {
    pub log_id: String,
    /// 1–5 star rating.
    pub rating: i32,
    /// Whether the user wants to keep the generated text as material.
    pub accepted: bool,
    /// Generated text to ingest when `accepted` is true.
    pub content: Option<String>,
    /// Display name for the ingested material.
    pub source_name: Option<String>,
    /// Content level for the ingested material.
    pub content_level: Option<String>,
    /// Optional free-text comment (reserved for future use).
    pub comment: Option<String>,
}

/// Records the user's rating, and ingests the generated text into the material
/// library when `accepted` is true.
#[tauri::command]
pub async fn submit_generation_feedback(
    req: SubmitFeedbackRequest,
    state: State<'_, AppState>,
) -> Result<Option<Material>, AppError> {
    let content = req.content.clone().unwrap_or_default();
    let should_ingest = req.accepted && !content.trim().is_empty();

    let material_id = Uuid::new_v4().to_string();
    let source_name = req
        .source_name
        .clone()
        .unwrap_or_else(|| "AI 生成".to_string());
    let content_level = req
        .content_level
        .clone()
        .unwrap_or_else(|| "general".to_string());
    let status = if req.rating >= 4 { "active" } else { "pending" };
    let now = Utc::now().to_rfc3339();
    let rating = req.rating;
    let active_profile_id = get_active_style_profile_id().ok().flatten();
    let auto_recalibrate = get_auto_recalibrate_style_profile().unwrap_or(false);
    let active_profile_id_for_closure = active_profile_id.clone();

    let inserted_id: Option<String> = tokio::task::spawn_blocking({
        let log_id = req.log_id.clone();
        let material_id = material_id.clone();
        let content = content.clone();
        let source_name = source_name.clone();
        let content_level = content_level.clone();
        let now = now.clone();
        move || -> Result<Option<String>, AppError> {
            let mut conn = db::get_db()?;
            let tx = conn.transaction()?;

            tx.execute(
                "UPDATE generation_log SET rating = ?1, accepted = ?2, style_profile_id = ?3 WHERE id = ?4",
                params![&rating, if should_ingest { 1 } else { 0 }, active_profile_id_for_closure.as_deref(), &log_id],
            )?;

            if should_ingest {
                let plain_text = content.replace('\n', " ").replace("  ", " ");
                let style_fingerprint =
                    serde_json::to_string(&compute_material_style_fingerprint(&plain_text))?;
                tx.execute(
                    "INSERT INTO material (
                        id, source_name, source_type, content, plain_text, content_level,
                        rating, status, style_fingerprint, hit_count, last_hit_at, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        &material_id,
                        &source_name,
                        "ai_generated",
                        &content,
                        plain_text,
                        &content_level,
                        &rating,
                        &status,
                        &style_fingerprint,
                        0,
                        Option::<&str>::None,
                        &now,
                        &now
                    ],
                )?;
            }

            tx.commit()?;
            Ok(if should_ingest { Some(material_id) } else { None })
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("提交反馈失败: {}", e)))??;

    if let Some(id) = inserted_id {
        // Chunk and embed accepted content so it can be retrieved in future RAG.
        let chunks = chunk_text(&content, &ChunkConfig::default());
        if !chunks.is_empty() {
            let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
            let embeddings = state.embedding_provider.embed(&texts).await?;
            let vector_store = state.vector_store().await?;
            let records: Vec<VectorRecord> = chunks
                .iter()
                .zip(embeddings.iter())
                .enumerate()
                .map(|(idx, (chunk, embedding))| VectorRecord {
                    material_id: id.clone(),
                    chunk_index: idx as u32,
                    chunk_text: chunk.text.clone(),
                    embedding: embedding.clone(),
                    tag_ids: Vec::new(),
                    content_level: content_level.clone(),
                    is_negative: false,
                    quality_score: rating as f32,
                    created_at: now.clone(),
                })
                .collect();
            vector_store.upsert(&records).await?;
            vector_store.refresh_cache().await?;
        }

        let material = crate::commands::material::get_material_by_id(id).await?;

        // Auto-recalibrate the active style profile when high-quality content is accepted.
        if auto_recalibrate && rating >= 4 {
            let _ = recalibrate_active_style_profile(
                RecalibrateStyleProfileRequest {
                    profile_id: active_profile_id.clone(),
                    window_days: None,
                    min_rating: None,
                },
                state,
            )
            .await;
        }

        Ok(Some(material))
    } else {
        Ok(None)
    }
}

/// Convenience command for rejecting a generation without ingesting material.
#[tauri::command]
pub fn reject_generation(id: String, rating: Option<i32>) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute(
        "UPDATE generation_log SET rating = ?1, accepted = 0 WHERE id = ?2",
        params![&rating.unwrap_or(1), &id],
    )?;
    Ok(())
}
