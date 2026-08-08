use std::collections::HashMap;

use chrono::Utc;
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

const EMBED_BATCH_SIZE: usize = 32;

use crate::chunker::{chunk_text, ChunkConfig, TextChunk};
use crate::commands::style_profile::compute_material_style_fingerprint;
use crate::db;
use crate::error::AppError;
use crate::models::{Material, Tag};
use crate::parser::{parse_file, ParsedBook};
use crate::state::AppState;
use crate::vectordb::{SearchFilter, VectorRecord};

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportMaterialRequest {
    pub file_path: String,
    pub tag_ids: Vec<String>,
    pub auto_tag: bool,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub stage: String,
    pub total_chunks: usize,
    pub processed_chunks: usize,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMaterialRequest {
    pub id: String,
    pub content: Option<String>,
    pub source_name: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Import flow
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_material(
    req: ImportMaterialRequest,
    state: State<'_, AppState>,
) -> Result<Material, AppError> {
    let now = Utc::now().to_rfc3339();
    let material_id = Uuid::new_v4().to_string();

    let (parsed, full_text, chunks) = parse_and_chunk(&req.file_path).await?;

    insert_material_record(&material_id, &parsed, &full_text, &req.tag_ids, &now)?;

    if !chunks.is_empty() {
        embed_and_store_chunks(
            &material_id,
            &chunks,
            &req.tag_ids,
            "general",
            false,
            0.0,
            &now,
            state,
        )
        .await?;
    }

    get_material_by_id(material_id).await
}

async fn parse_and_chunk(
    file_path: &str,
) -> Result<(ParsedBook, String, Vec<TextChunk>), AppError> {
    let parsed = parse_file(file_path).await?;

    let full_text: String = parsed
        .chapters
        .iter()
        .map(|ch| format!("{}\n{}", ch.title, ch.content))
        .collect::<Vec<_>>()
        .join("\n\n");

    if full_text.trim().is_empty() {
        return Err(AppError::Other("导入文件内容为空".to_string()));
    }

    let config = ChunkConfig::default();
    let chunks = chunk_text(&full_text, &config);

    Ok((parsed, full_text, chunks))
}

fn insert_material_record(
    material_id: &str,
    parsed: &ParsedBook,
    full_text: &str,
    tag_ids: &[String],
    now: &str,
) -> Result<(), AppError> {
    let fingerprint_json = serde_json::to_string(&compute_material_style_fingerprint(full_text))?;

    let mut conn = db::get_db()?;
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO material (
            id, source_name, source_type, content, plain_text, content_level,
            rating, status, is_negative, style_fingerprint, hit_count, last_hit_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            material_id,
            &parsed.title,
            "imported",
            full_text,
            full_text.replace('\n', " ").replace("  ", " "),
            "general",
            0,
            "pending",
            0,
            fingerprint_json,
            0,
            Option::<&str>::None,
            now,
            now
        ],
    )?;

    for tag_id in tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO material_tag (material_id, tag_id) VALUES (?1, ?2)",
            params![material_id, tag_id],
        )?;
    }

    tx.commit()?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn embed_and_store_chunks(
    material_id: &str,
    chunks: &[TextChunk],
    tag_ids: &[String],
    content_level: &str,
    is_negative: bool,
    quality_score: f32,
    now: &str,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vector_store = state.vector_store().await?;
    let mut global_index: u32 = 0;

    for batch in chunks.chunks(EMBED_BATCH_SIZE) {
        let chunk_texts: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();
        let embeddings = state.embedding_provider.embed(&chunk_texts).await?;

        let records: Vec<VectorRecord> = batch
            .iter()
            .zip(embeddings.iter())
            .map(|(chunk, embedding)| {
                let record = VectorRecord {
                    material_id: material_id.to_string(),
                    chunk_index: global_index,
                    chunk_text: chunk.text.clone(),
                    embedding: embedding.clone(),
                    tag_ids: tag_ids.to_vec(),
                    content_level: content_level.to_string(),
                    is_negative,
                    quality_score,
                    created_at: now.to_string(),
                };
                global_index += 1;
                record
            })
            .collect();

        vector_store.upsert(&records).await?;
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Material CRUD
// ─────────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case)]
#[tauri::command]
pub async fn list_materials(
    statusFilter: Option<String>,
    tagFilter: Option<String>,
) -> Result<Vec<Material>, AppError> {
    let conn = db::get_db()?;

    let query = match (&statusFilter, &tagFilter) {
        (Some(_), Some(_)) => {
            "SELECT m.id, m.source_name, m.source_type, m.content, m.plain_text, m.content_level,
                    m.rating, m.status, m.is_negative, m.style_fingerprint, m.hit_count, m.last_hit_at, m.created_at, m.updated_at
             FROM material m
             JOIN material_tag mt ON m.id = mt.material_id
             WHERE m.status = ?1 AND mt.tag_id = ?2
             ORDER BY m.updated_at DESC"
        }
        (Some(_), None) => {
            "SELECT id, source_name, source_type, content, plain_text, content_level,
                    rating, status, is_negative, style_fingerprint, hit_count, last_hit_at, created_at, updated_at
             FROM material
             WHERE status = ?1
             ORDER BY updated_at DESC"
        }
        (None, Some(_)) => {
            "SELECT m.id, m.source_name, m.source_type, m.content, m.plain_text, m.content_level,
                    m.rating, m.status, m.is_negative, m.style_fingerprint, m.hit_count, m.last_hit_at, m.created_at, m.updated_at
             FROM material m
             JOIN material_tag mt ON m.id = mt.material_id
             WHERE mt.tag_id = ?1
             ORDER BY m.updated_at DESC"
        }
        (None, None) => {
            "SELECT id, source_name, source_type, content, plain_text, content_level,
                    rating, status, is_negative, style_fingerprint, hit_count, last_hit_at, created_at, updated_at
             FROM material
             ORDER BY updated_at DESC"
        }
    };

    let mut stmt = conn.prepare(query)?;

    let rows: Vec<Material> = match (&statusFilter, &tagFilter) {
        (Some(s), Some(t)) => stmt
            .query_map(params![s, t], row_to_material)?
            .collect::<Result<Vec<_>, _>>()?,
        (Some(s), None) => stmt
            .query_map([s], row_to_material)?
            .collect::<Result<Vec<_>, _>>()?,
        (None, Some(t)) => stmt
            .query_map([t], row_to_material)?
            .collect::<Result<Vec<_>, _>>()?,
        (None, None) => stmt
            .query_map([], row_to_material)?
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(rows)
}

fn row_to_material(row: &rusqlite::Row) -> Result<Material, rusqlite::Error> {
    Ok(Material {
        id: row.get(0)?,
        source_name: row.get(1)?,
        source_type: row.get(2)?,
        content: row.get(3)?,
        plain_text: row.get(4)?,
        content_level: row.get(5)?,
        rating: row.get(6)?,
        status: row.get(7)?,
        is_negative: row.get::<_, i32>(8)? != 0,
        style_fingerprint: row.get(9)?,
        hit_count: row.get(10)?,
        last_hit_at: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

#[tauri::command]
pub async fn get_material_by_id(id: String) -> Result<Material, AppError> {
    let conn = db::get_db()?;
    let material = conn.query_row(
        "SELECT id, source_name, source_type, content, plain_text, content_level,
                rating, status, is_negative, style_fingerprint, hit_count, last_hit_at, created_at, updated_at
         FROM material WHERE id = ?1",
        [&id],
        row_to_material,
    )?;

    Ok(material)
}

#[tauri::command]
pub async fn update_material(
    req: UpdateMaterialRequest,
    state: State<'_, AppState>,
) -> Result<Material, AppError> {
    let now = Utc::now().to_rfc3339();

    // If content is updated, we need to re-chunk and re-embed
    if let Some(content) = &req.content {
        let config = ChunkConfig::default();
        let chunks = chunk_text(content, &config);
        let fingerprint_json = serde_json::to_string(&compute_material_style_fingerprint(content))?;

        // Update material record
        {
            let mut conn = db::get_db()?;
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE material SET content = ?1, plain_text = ?2, style_fingerprint = ?3, updated_at = ?4 WHERE id = ?5",
                params![
                    content,
                    content.replace('\n', " ").replace("  ", " "),
                    fingerprint_json,
                    &now,
                    &req.id
                ],
            )?;
            if let Some(name) = &req.source_name {
                tx.execute(
                    "UPDATE material SET source_name = ?1 WHERE id = ?2",
                    params![name, &req.id],
                )?;
            }
            tx.commit()?;
        }

        // Re-embed
        if !chunks.is_empty() {
            let vector_store = state.vector_store().await?;
            vector_store.delete_by_material(&req.id).await?;

            let tag_ids = get_material_tag_ids(&req.id).await?;
            let existing = get_material_by_id(req.id.clone()).await?;
            embed_and_store_chunks(
                &req.id,
                &chunks,
                &tag_ids,
                &existing.content_level,
                existing.is_negative,
                existing.rating as f32,
                &now,
                state,
            )
            .await?;
        }
    } else if let Some(name) = req.source_name {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE material SET source_name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, &now, &req.id],
        )?;
    }

    get_material_by_id(req.id).await
}

#[tauri::command]
pub async fn update_material_content_level(
    id: String,
    content_level: String,
    state: State<'_, AppState>,
) -> Result<Material, AppError> {
    let now = Utc::now().to_rfc3339();

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE material SET content_level = ?1, updated_at = ?2 WHERE id = ?3",
            params![&content_level, &now, &id],
        )?;
    }

    // Re-embed with the new content level.
    let existing = get_material_by_id(id.clone()).await?;
    let config = ChunkConfig::default();
    let chunks = chunk_text(&existing.content, &config);
    if !chunks.is_empty() {
        let vector_store = state.vector_store().await?;
        vector_store.delete_by_material(&id).await?;
        let tag_ids = get_material_tag_ids(&id).await?;
        embed_and_store_chunks(
            &id,
            &chunks,
            &tag_ids,
            &content_level,
            existing.is_negative,
            existing.rating as f32,
            &now,
            state,
        )
        .await?;
    }

    get_material_by_id(id).await
}

async fn get_material_tag_ids(material_id: &str) -> Result<Vec<String>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare("SELECT tag_id FROM material_tag WHERE material_id = ?1")?;
    let rows = stmt.query_map([material_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub async fn update_material_status(
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Material, AppError> {
    let now = Utc::now().to_rfc3339();
    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE material SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![&status, &now, &id],
        )?;
    }

    // Status changes affect RAG filtering; update vector cache incrementally
    let vector_store = state.vector_store().await?;
    vector_store.update_cached_status(&id, &status).await;

    get_material_by_id(id).await
}

#[tauri::command]
pub async fn rate_material(
    id: String,
    rating: i32,
    state: State<'_, AppState>,
) -> Result<Material, AppError> {
    let now = Utc::now().to_rfc3339();
    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE material SET rating = ?1, updated_at = ?2 WHERE id = ?3",
            params![&rating, &now, &id],
        )?;
        conn.execute(
            "UPDATE vector_embedding SET quality_score = ?1 WHERE material_id = ?2",
            params![rating as f32, &id],
        )?;
    }

    let vector_store = state.vector_store().await?;
    vector_store
        .update_cached_rating(&id, rating, rating as f32)
        .await;

    get_material_by_id(id).await
}

#[tauri::command]
pub async fn update_material_negative(
    id: String,
    is_negative: bool,
    state: State<'_, AppState>,
) -> Result<Material, AppError> {
    let now = Utc::now().to_rfc3339();

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE material SET is_negative = ?1, updated_at = ?2 WHERE id = ?3",
            params![is_negative as i32, &now, &id],
        )?;
        conn.execute(
            "UPDATE vector_embedding SET is_negative = ?1 WHERE material_id = ?2",
            params![is_negative as i32, &id],
        )?;
    }

    let vector_store = state.vector_store().await?;
    vector_store.update_cached_negative(&id, is_negative).await;

    get_material_by_id(id).await
}

#[tauri::command]
pub async fn delete_material(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let vector_store = state.vector_store().await?;
    vector_store.delete_by_material(&id).await?;

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        let mut conn = db::get_db()?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM material_tag WHERE material_id = ?1", [&id])?;
        tx.execute("DELETE FROM material WHERE id = ?1", [&id])?;
        tx.commit()?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("删除素材失败: {}", e)))??;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case)]
#[tauri::command]
pub async fn search_materials(
    query: String,
    limit: Option<usize>,
    tagFilter: Option<String>,
    contentLevels: Option<Vec<String>>,
    statusFilter: Option<String>,
    decayLambda: Option<f64>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::vectordb::SearchResult>, AppError> {
    let query_embedding = state.embedding_provider.embed(&[query]).await?;
    let query_vector = query_embedding
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Other("查询向量生成失败".to_string()))?;

    let filter = SearchFilter {
        tag_filter: tagFilter,
        content_levels: contentLevels,
        status: statusFilter,
        min_rating: None,
        max_rating: None,
        is_negative: None,
    };

    let vector_store = state.vector_store().await?;
    let results = vector_store
        .search(
            &query_vector,
            limit.unwrap_or(10),
            filter,
            decayLambda.unwrap_or(0.001),
        )
        .await?;

    Ok(results)
}

#[tauri::command]
pub async fn search_materials_fts(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<crate::vectordb::SearchResult>, AppError> {
    let conn = db::get_db()?;

    let sql = r#"
        SELECT m.id, m.source_name, m.plain_text
        FROM material m
        JOIN material_fts fts ON m.rowid = fts.rowid
        WHERE material_fts MATCH ?1
        ORDER BY rank
        LIMIT ?2
    "#;

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![&query, limit.unwrap_or(20) as i64], |row| {
            Ok(crate::vectordb::SearchResult {
                material_id: row.get(0)?,
                chunk_index: 0,
                chunk_text: row.get(2)?,
                distance: 0.0,
                is_negative: false,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_tag(name: String, category: String, color: Option<String>) -> Result<Tag, AppError> {
    let id = Uuid::new_v4().to_string();
    let color = color.unwrap_or_else(|| "#808080".to_string());

    let conn = db::get_db()?;
    conn.execute(
        "INSERT INTO tag (id, name, category, color) VALUES (?1, ?2, ?3, ?4)",
        params![&id, &name, &category, &color],
    )?;

    Ok(Tag {
        id,
        name,
        category,
        color,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn list_tags(categoryFilter: Option<String>) -> Result<Vec<Tag>, AppError> {
    let conn = db::get_db()?;

    let query = if categoryFilter.is_some() {
        "SELECT id, name, category, color FROM tag WHERE category = ?1 ORDER BY category, name"
    } else {
        "SELECT id, name, category, color FROM tag ORDER BY category, name"
    };

    let mut stmt = conn.prepare(query)?;

    let rows: Vec<Tag> = if let Some(category) = categoryFilter {
        stmt.query_map([category], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                color: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                color: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    };

    Ok(rows)
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportMaterialsRequest {
    pub format: String, // "json" | "txt"
    pub status_filter: Option<String>,
    pub min_rating: Option<i32>,
    pub max_rating: Option<i32>,
    pub source_type_filter: Option<String>,
    pub tag_filter: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMaterialsResult {
    pub content: String,
    pub file_name: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub material_id: String,
    pub source_name: String,
    pub max_similarity: f32,
    pub matched_chunks: usize,
}

fn fetch_materials_for_export(req: &ExportMaterialsRequest) -> Result<Vec<Material>, AppError> {
    let conn = db::get_db()?;

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();

    if let Some(s) = &req.status_filter {
        conditions.push("m.status = ?".to_string());
        params.push(s);
    }
    if let Some(s) = &req.source_type_filter {
        conditions.push("m.source_type = ?".to_string());
        params.push(s);
    }
    if let Some(r) = &req.min_rating {
        conditions.push("m.rating >= ?".to_string());
        params.push(r);
    }
    if let Some(r) = &req.max_rating {
        conditions.push("m.rating <= ?".to_string());
        params.push(r);
    }

    let tag_join = if let Some(tag_id) = &req.tag_filter {
        conditions.push("mt.tag_id = ?".to_string());
        params.push(tag_id);
        "JOIN material_tag mt ON m.id = mt.material_id"
    } else {
        ""
    };

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT m.id, m.source_name, m.source_type, m.content, m.plain_text, m.content_level,
                m.rating, m.status, m.is_negative, m.style_fingerprint, m.hit_count, m.last_hit_at, m.created_at, m.updated_at
         FROM material m
         {}
         {}
         ORDER BY m.updated_at DESC",
        tag_join, where_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), row_to_material)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Preview which existing active materials would be considered duplicates of the file at `file_path`.
#[tauri::command]
pub async fn preview_import_duplicates(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DuplicateCandidate>, AppError> {
    let (_, _, chunks) = parse_and_chunk(&file_path).await?;
    if chunks.is_empty() {
        return Ok(vec![]);
    }

    let chunk_texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let embeddings = state.embedding_provider.embed(&chunk_texts).await?;
    let vector_store = state.vector_store().await?;

    let filter = SearchFilter {
        tag_filter: None,
        content_levels: None,
        status: Some("active".to_string()),
        min_rating: None,
        max_rating: None,
        is_negative: None,
    };

    let threshold = 0.85f32;
    let mut hits: HashMap<String, (f32, usize)> = HashMap::new();

    for embedding in embeddings {
        let results = vector_store
            .search(&embedding, 3, filter.clone(), 0.0)
            .await?;
        for result in results {
            let similarity = 1.0 - result.distance;
            if similarity >= threshold {
                let entry = hits.entry(result.material_id).or_insert((0.0, 0));
                entry.0 = entry.0.max(similarity);
                entry.1 += 1;
            }
        }
    }

    let mut candidates = Vec::new();
    for (material_id, (max_similarity, matched_chunks)) in hits {
        if let Ok(material) = get_material_by_id(material_id.clone()).await {
            candidates.push(DuplicateCandidate {
                material_id,
                source_name: material.source_name,
                max_similarity,
                matched_chunks,
            });
        }
    }

    candidates.sort_by(|a, b| {
        b.max_similarity
            .partial_cmp(&a.max_similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(candidates)
}

#[tauri::command]
pub fn export_materials(req: ExportMaterialsRequest) -> Result<ExportMaterialsResult, AppError> {
    let materials = fetch_materials_for_export(&req)?;
    let content = if req.format == "txt" {
        materials
            .iter()
            .map(|m| format!("--- {}\n{}", m.source_name, m.plain_text))
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        serde_json::to_string_pretty(&materials)?
    };

    let extension = if req.format == "txt" { "txt" } else { "json" };
    let file_name = format!(
        "materials_export_{}.{}",
        Utc::now().format("%Y%m%d_%H%M%S"),
        extension
    );

    Ok(ExportMaterialsResult { content, file_name })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBinaryResult {
    pub data: Vec<u8>,
    pub file_name: String,
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 导出素材为 EPUB 电子书（需求文档 F-24）。
#[tauri::command]
pub fn export_materials_epub(req: ExportMaterialsRequest) -> Result<ExportBinaryResult, AppError> {
    use epub_builder::{EpubBuilder, EpubContent, ReferenceType, ZipLibrary};

    let materials = fetch_materials_for_export(&req)?;
    if materials.is_empty() {
        return Err(AppError::Other("没有可导出的素材".to_string()));
    }

    let to_err = |e: epub_builder::Error| AppError::Other(format!("生成 EPUB 失败: {}", e));

    let zip = ZipLibrary::new().map_err(to_err)?;
    let mut builder = EpubBuilder::new(zip).map_err(to_err)?;
    builder
        .metadata("title", "素材导出")
        .map_err(to_err)?
        .metadata("author", "novel-ai-writer")
        .map_err(to_err)?
        .metadata("lang", "zh-CN")
        .map_err(to_err)?;

    for (i, m) in materials.iter().enumerate() {
        let paragraphs = m
            .plain_text
            .lines()
            .map(|line| format!("<p>{}</p>", escape_xml(line)))
            .collect::<String>();
        let xhtml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <html xmlns=\"http://www.w3.org/1999/xhtml\">\
             <head><title>{}</title></head><body>{}</body></html>",
            escape_xml(&m.source_name),
            paragraphs
        );
        builder
            .add_content(
                EpubContent::new(format!("material_{}.xhtml", i), xhtml.as_bytes())
                    .title(m.source_name.as_str())
                    .reftype(ReferenceType::Text),
            )
            .map_err(to_err)?;
    }

    let mut buf: Vec<u8> = Vec::new();
    builder.generate(&mut buf).map_err(to_err)?;

    Ok(ExportBinaryResult {
        data: buf,
        file_name: format!(
            "materials_export_{}.epub",
            Utc::now().format("%Y%m%d_%H%M%S")
        ),
    })
}

#[tauri::command]
pub fn delete_tag(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM tag WHERE id = ?1", [&id])?;
    Ok(())
}

#[tauri::command]
pub fn list_tag_categories() -> Result<Vec<String>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare("SELECT DISTINCT category FROM tag ORDER BY category")?;
    let rows = stmt
        .query_map([], |row| {
            let category: String = row.get(0)?;
            Ok(category)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiered storage & cleanup suggestions
// ─────────────────────────────────────────────────────────────────────────────

const HOT_LIMIT: i64 = 50_000;
const COLD_DAYS: i64 = 90;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierMigrationResult {
    pub removed_archived: usize,
    pub removed_cold: usize,
    pub removed_hot_overflow: usize,
}

#[tauri::command]
pub async fn apply_storage_tier_migration(
    state: State<'_, AppState>,
) -> Result<TierMigrationResult, AppError> {
    let result = tokio::task::spawn_blocking(move || -> Result<TierMigrationResult, AppError> {
        let mut conn = db::get_db()?;
        let tx = conn.transaction()?;

        // Remove embeddings for archived materials; they should not participate in retrieval.
        let removed_archived = tx.execute(
            "DELETE FROM vector_embedding WHERE material_id IN (SELECT id FROM material WHERE status = 'archived')",
            [],
        )?;

        // Remove embeddings for active materials not hit recently.
        let cold_sql = format!(
            "DELETE FROM vector_embedding WHERE material_id IN (
                SELECT id FROM material WHERE status = 'active' AND (
                    (last_hit_at IS NOT NULL AND last_hit_at < date('now', '-{} days'))
                    OR (last_hit_at IS NULL AND created_at < date('now', '-{} days'))
                )
            )",
            COLD_DAYS, COLD_DAYS
        );
        let removed_cold = tx.execute(&cold_sql, [])?;

        tx.commit()?;

        // Enforce hot-data ceiling: delete oldest excess vector rows.
        let mut removed_hot_overflow = 0usize;
        loop {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM vector_embedding", [], |row| {
                row.get(0)
            })?;
            if count <= HOT_LIMIT {
                break;
            }
            let excess = count - HOT_LIMIT;
            removed_hot_overflow += conn.execute(
                "DELETE FROM vector_embedding WHERE id IN (
                    SELECT ve.id FROM vector_embedding ve
                    JOIN material m ON m.id = ve.material_id
                    ORDER BY m.rating ASC, ve.created_at ASC LIMIT ?1
                )",
                [excess],
            )?;
        }

        Ok(TierMigrationResult {
            removed_archived,
            removed_cold,
            removed_hot_overflow,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("存储分层整理失败: {}", e)))??;

    let vector_store = state.vector_store().await?;
    vector_store.refresh_cache().await?;

    Ok(result)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSuggestion {
    pub material_id: String,
    pub source_name: String,
    pub reason: String,
}

#[tauri::command]
pub fn get_cleanup_suggestions() -> Result<Vec<CleanupSuggestion>, AppError> {
    let conn = db::get_db()?;
    let mut suggestions = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT id, source_name FROM material
         WHERE rating > 0 AND rating < 3 AND updated_at < date('now', '-6 months')",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, source_name) in rows {
        suggestions.push(CleanupSuggestion {
            material_id: id,
            source_name,
            reason: "评分低于3分且超过6个月未更新".to_string(),
        });
    }

    let mut stmt = conn.prepare(
        "SELECT id, source_name FROM material
         WHERE hit_count = 0 AND created_at < date('now', '-3 months')",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, source_name) in rows {
        suggestions.push(CleanupSuggestion {
            material_id: id,
            source_name,
            reason: "超过3个月零命中".to_string(),
        });
    }

    Ok(suggestions)
}

#[tauri::command]
pub async fn batch_delete_materials(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    {
        let mut conn = db::get_db()?;
        let tx = conn.transaction()?;
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        tx.execute(
            &format!(
                "DELETE FROM vector_embedding WHERE material_id IN ({})",
                placeholders
            ),
            rusqlite::params_from_iter(&ids),
        )?;
        tx.execute(
            &format!("DELETE FROM material WHERE id IN ({})", placeholders),
            rusqlite::params_from_iter(&ids),
        )?;
        tx.commit()?;
    }

    let vector_store = state.vector_store().await?;
    for id in &ids {
        vector_store.remove_from_cache_by_material(id).await;
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 插入一条素材，返回 material_id。
    fn setup_material() -> String {
        crate::db::init_test_db().unwrap();
        let id = Uuid::new_v4().to_string();
        let conn = db::get_db().unwrap();
        conn.execute(
            "INSERT INTO material (
                id, source_name, source_type, content, plain_text, content_level,
                rating, status, is_negative, style_fingerprint, hit_count, last_hit_at, created_at, updated_at
            ) VALUES (?1, ?2, 'imported', ?3, ?3, 'general', 4, 'active', 0, '{}', 0, NULL,
                      '2020-01-01T00:00:00+00:00', '2020-01-01T00:00:00+00:00')",
            params![&id, "测试素材", "第一行\n第二行 <tag> & \"引号\""],
        )
        .unwrap();
        id
    }

    fn empty_request(format: &str) -> ExportMaterialsRequest {
        ExportMaterialsRequest {
            format: format.to_string(),
            status_filter: None,
            min_rating: None,
            max_rating: None,
            source_type_filter: None,
            tag_filter: None,
        }
    }

    #[test]
    fn export_materials_txt() {
        setup_material();
        let result = export_materials(empty_request("txt")).unwrap();
        assert!(result.file_name.ends_with(".txt"));
        assert!(result.content.contains("测试素材"));
        assert!(result.content.contains("第一行"));
    }

    #[test]
    fn export_materials_epub_produces_zip() {
        setup_material();
        let result = export_materials_epub(empty_request("epub")).unwrap();
        assert!(result.file_name.ends_with(".epub"));
        // EPUB 即 ZIP 包，魔数 PK\x03\x04
        assert!(result.data.len() > 100);
        assert_eq!(&result.data[..2], b"PK");
        let text = String::from_utf8_lossy(&result.data).into_owned();
        // ZIP 中央目录包含素材 xhtml 条目
        assert!(text.contains("material_0.xhtml"));
    }

    #[test]
    fn export_materials_epub_rejects_empty() {
        crate::db::init_test_db().unwrap();
        let err = export_materials_epub(empty_request("epub")).unwrap_err();
        assert!(matches!(err, AppError::Other(_)));
    }
}
