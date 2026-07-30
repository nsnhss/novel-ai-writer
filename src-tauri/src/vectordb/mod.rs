use chrono::{DateTime, Utc};
use rayon::prelude::*;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, RwLock};

use crate::db;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorRecord {
    pub material_id: String,
    pub chunk_index: u32,
    pub chunk_text: String,
    pub embedding: Vec<f32>,
    pub tag_ids: Vec<String>,
    pub content_level: String,
    pub is_negative: bool,
    pub quality_score: f32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub material_id: String,
    pub chunk_index: u32,
    pub chunk_text: String,
    pub distance: f32,
    pub is_negative: bool,
}

pub struct VectorStore {
    dimensions: usize,
    cache: RwLock<Vec<CachedVector>>,
    initialized: AtomicBool,
    init_lock: Mutex<()>,
}

#[derive(Debug, Clone)]
struct CachedVector {
    material_id: String,
    chunk_index: u32,
    chunk_text: String,
    // 半精度存储: 50K x 1024 维缓存内存占用减半 (~205MB → ~103MB),
    // 对余弦相似度排序影响可忽略。
    embedding: Vec<half::f16>,
    content_level: String,
    tag_ids: Vec<String>,
    status: String,
    rating: i32,
    is_negative: bool,
    quality_score: f32,
    created_at: String,
}

/// f32 向量与原始字节互转 (little-endian), 用于 BLOB 存储。
fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for v in embedding {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

fn embedding_from_bytes(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Some(out)
}

fn to_f16(v: &[f32]) -> Vec<half::f16> {
    v.iter().map(|x| half::f16::from_f32(*x)).collect()
}

/// Search filters for vector retrieval.
#[derive(Debug, Clone, Default)]
pub struct SearchFilter {
    pub tag_filter: Option<String>,
    pub content_levels: Option<Vec<String>>,
    pub status: Option<String>,
    pub min_rating: Option<i32>,
    pub max_rating: Option<i32>,
    pub is_negative: Option<bool>,
}

impl VectorStore {
    pub async fn open(_data_dir: &std::path::Path, dimensions: usize) -> Result<Self, AppError> {
        Ok(Self {
            dimensions,
            cache: RwLock::new(Vec::new()),
            initialized: AtomicBool::new(false),
            init_lock: Mutex::new(()),
        })
    }

    pub async fn ensure_loaded(&self) -> Result<(), AppError> {
        if self.initialized.load(Ordering::SeqCst) {
            return Ok(());
        }
        let _guard = self.init_lock.lock().await;
        if self.initialized.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.refresh_cache().await?;
        Ok(())
    }

    pub async fn refresh_cache(&self) -> Result<(), AppError> {
        let vectors: Vec<CachedVector> = tokio::task::spawn_blocking({
            let load = || -> Result<Vec<CachedVector>, AppError> {
                let conn = db::get_db()?;
                let mut stmt = conn.prepare(
                    "SELECT ve.material_id, ve.chunk_index, ve.chunk_text, ve.embedding,
                            ve.content_level, ve.tag_ids, ve.created_at,
                            COALESCE(m.status, 'pending') as status,
                            COALESCE(m.rating, 0) as rating,
                            COALESCE(ve.is_negative, 0) as is_negative,
                            COALESCE(ve.quality_score, 0) as quality_score,
                            ve.embedding_blob
                     FROM vector_embedding ve
                     LEFT JOIN material m ON ve.material_id = m.id",
                )?;

                let rows = stmt
                    .query_map([], |row| {
                        // 优先读 BLOB (新格式), 兼容老的 JSON 文本格式
                        let embedding_blob: Option<Vec<u8>> = row.get(11)?;
                        let embedding: Vec<f32> = match embedding_blob
                            .as_deref()
                            .and_then(embedding_from_bytes)
                        {
                            Some(v) => v,
                            None => {
                                let embedding_json: String = row.get(3)?;
                                serde_json::from_str(&embedding_json).map_err(|e| {
                                    rusqlite::Error::InvalidParameterName(e.to_string())
                                })?
                            }
                        };

                        let tag_ids_json: String = row.get(5)?;
                        let tag_ids: Vec<String> = serde_json::from_str(&tag_ids_json)
                            .unwrap_or_else(|_| {
                                tag_ids_json.split(',').map(|s| s.to_string()).collect()
                            });

                        Ok(CachedVector {
                            material_id: row.get(0)?,
                            chunk_index: row.get(1)?,
                            chunk_text: row.get(2)?,
                            embedding: to_f16(&embedding),
                            content_level: row.get(4)?,
                            tag_ids,
                            created_at: row.get(6)?,
                            status: row.get(7)?,
                            rating: row.get(8)?,
                            is_negative: row.get::<_, i32>(9)? != 0,
                            quality_score: row.get(10)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;

                Ok(rows)
            };
            move || load()
        })
        .await
        .map_err(|e| AppError::Other(format!("刷新向量缓存失败: {}", e)))??;

        let mut cache = self.cache.write().await;
        *cache = vectors;
        self.initialized.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub async fn upsert(&self, records: &[VectorRecord]) -> Result<(), AppError> {
        if records.is_empty() {
            return Ok(());
        }

        let records = records.to_vec();
        let cached = tokio::task::spawn_blocking(move || -> Result<Vec<CachedVector>, AppError> {
            let mut conn = db::get_db()?;
            let tx = conn.transaction()?;

            for record in &records {
                let embedding_bytes = embedding_to_bytes(&record.embedding);
                let tag_ids_json = serde_json::to_string(&record.tag_ids)?;

                // embedding 文本列写入空数组占位 (NOT NULL 约束), 实际数据存 BLOB 列
                tx.execute(
                    "INSERT INTO vector_embedding (
                        id, material_id, chunk_index, chunk_text, embedding, embedding_blob, tag_ids,
                        content_level, is_negative, quality_score, created_at
                    ) VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?7, ?8, ?9, ?10)
                    ON CONFLICT(material_id, chunk_index) DO UPDATE SET
                        chunk_text = excluded.chunk_text,
                        embedding = excluded.embedding,
                        embedding_blob = excluded.embedding_blob,
                        tag_ids = excluded.tag_ids,
                        content_level = excluded.content_level,
                        is_negative = excluded.is_negative,
                        quality_score = excluded.quality_score,
                        created_at = excluded.created_at",
                    params![
                        format!("{}-{}", record.material_id, record.chunk_index),
                        &record.material_id,
                        record.chunk_index,
                        &record.chunk_text,
                        &embedding_bytes,
                        &tag_ids_json,
                        &record.content_level,
                        record.is_negative as i32,
                        record.quality_score,
                        &record.created_at,
                    ],
                )?;
            }

            tx.commit()?;

            // Build cached rows with the latest material status/rating for incremental update.
            let mut material_meta: std::collections::HashMap<String, (String, i32)> =
                std::collections::HashMap::new();
            let mut cached = Vec::with_capacity(records.len());
            for record in records {
                let material_id = record.material_id.clone();
                let (status, rating) = material_meta.get(&material_id).cloned().unwrap_or_else(|| {
                    let meta = conn
                        .query_row(
                            "SELECT status, rating FROM material WHERE id = ?1",
                            [&material_id],
                            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?)),
                        )
                        .unwrap_or_else(|_| ("pending".to_string(), 0));
                    material_meta.insert(material_id, meta.clone());
                    meta
                });
                cached.push(CachedVector {
                    material_id: record.material_id,
                    chunk_index: record.chunk_index,
                    chunk_text: record.chunk_text,
                    embedding: to_f16(&record.embedding),
                    content_level: record.content_level,
                    tag_ids: record.tag_ids,
                    status,
                    rating,
                    is_negative: record.is_negative,
                    quality_score: record.quality_score,
                    created_at: record.created_at,
                });
            }
            Ok(cached)
        })
        .await
        .map_err(|e| AppError::Other(format!("写入向量记录失败: {}", e)))??;

        self.apply_upsert_to_cache(cached).await;
        Ok(())
    }

    async fn apply_upsert_to_cache(&self, rows: Vec<CachedVector>) {
        if !self.initialized.load(Ordering::SeqCst) {
            return;
        }
        let mut cache = self.cache.write().await;
        for row in rows {
            if let Some(existing) = cache.iter_mut().find(|c| {
                c.material_id == row.material_id && c.chunk_index == row.chunk_index
            }) {
                *existing = row;
            } else {
                cache.push(row);
            }
        }
    }

    pub async fn update_cached_status(&self, material_id: &str, status: &str) {
        if !self.initialized.load(Ordering::SeqCst) {
            return;
        }
        let mut cache = self.cache.write().await;
        for c in cache.iter_mut().filter(|c| c.material_id == material_id) {
            c.status = status.to_string();
        }
    }

    pub async fn update_cached_rating(&self, material_id: &str, rating: i32, quality_score: f32) {
        if !self.initialized.load(Ordering::SeqCst) {
            return;
        }
        let mut cache = self.cache.write().await;
        for c in cache.iter_mut().filter(|c| c.material_id == material_id) {
            c.rating = rating;
            c.quality_score = quality_score;
        }
    }

    pub async fn update_cached_negative(&self, material_id: &str, is_negative: bool) {
        if !self.initialized.load(Ordering::SeqCst) {
            return;
        }
        let mut cache = self.cache.write().await;
        for c in cache.iter_mut().filter(|c| c.material_id == material_id) {
            c.is_negative = is_negative;
        }
    }

    pub async fn search(
        &self,
        query_vector: &[f32],
        limit: usize,
        filter: SearchFilter,
        decay_lambda: f64,
    ) -> Result<Vec<SearchResult>, AppError> {
        self.ensure_loaded().await?;
        if query_vector.len() != self.dimensions {
            return Err(AppError::Other(format!(
                "查询向量维度不匹配: 期望 {}, 实际 {}",
                self.dimensions,
                query_vector.len()
            )));
        }

        let query_vector = query_vector.to_vec();
        let now = Utc::now();

        // Acquire read lock and compute similarities in-place without cloning cache
        let cache = self.cache.read().await;
        let mut scored: Vec<(f32, &CachedVector)> = cache
            .par_iter()
            .filter(|v| {
                if let Some(ref tag) = filter.tag_filter {
                    if !v.tag_ids.iter().any(|t| t == tag) && v.content_level != *tag {
                        return false;
                    }
                }
                if let Some(ref levels) = filter.content_levels {
                    if !levels.contains(&v.content_level) {
                        return false;
                    }
                }
                if let Some(ref status) = filter.status {
                    if v.status != *status {
                        return false;
                    }
                }
                if let Some(min) = filter.min_rating {
                    if v.rating < min {
                        return false;
                    }
                }
                if let Some(max) = filter.max_rating {
                    if v.rating > max {
                        return false;
                    }
                }
                if let Some(is_negative) = filter.is_negative {
                    if v.is_negative != is_negative {
                        return false;
                    }
                }
                true
            })
            .map(|v| {
                let similarity = cosine_similarity(&query_vector, &v.embedding);
                let quality_boost = 1.0 + 0.04 * v.quality_score;
                let weighted = apply_time_decay(similarity * quality_boost, &v.created_at, &now, decay_lambda);
                (weighted, v)
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        let results = scored
            .into_iter()
            .map(|(score, v)| SearchResult {
                material_id: v.material_id.clone(),
                chunk_index: v.chunk_index,
                chunk_text: v.chunk_text.clone(),
                distance: 1.0 - score,
                is_negative: v.is_negative,
            })
            .collect();

        drop(cache);
        Ok(results)
    }

    pub async fn delete_by_material(&self, material_id: &str) -> Result<(), AppError> {
        let material_id = material_id.to_string();
        let material_id_for_cache = material_id.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            let conn = db::get_db()?;
            conn.execute(
                "DELETE FROM vector_embedding WHERE material_id = ?1",
                [material_id],
            )?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Other(format!("删除向量记录失败: {}", e)))??;

        self.remove_from_cache_by_material(material_id_for_cache.as_str()).await;
        Ok(())
    }

    pub async fn remove_from_cache_by_material(&self, material_id: &str) {
        if !self.initialized.load(Ordering::SeqCst) {
            return;
        }
        let mut cache = self.cache.write().await;
        cache.retain(|c| c.material_id != material_id);
    }
}

fn apply_time_decay(similarity: f32, created_at: &str, now: &DateTime<Utc>, lambda: f64) -> f32 {
    let days = if let Ok(dt) = DateTime::parse_from_rfc3339(created_at) {
        let dt_utc = dt.with_timezone(&Utc);
        (*now - dt_utc).num_seconds() as f64 / 86400.0
    } else {
        0.0
    };
    let decay = (-lambda * days).exp();
    similarity * decay as f32
}

fn cosine_similarity(a: &[f32], b: &[half::f16]) -> f32 {
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for (x, y) in a.iter().zip(b.iter()) {
        let y = y.to_f32();
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a.sqrt() * norm_b.sqrt())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedding_bytes_roundtrip() {
        let v = vec![0.0f32, -1.5, 3.14, f32::MIN, f32::MAX, 1e-8];
        let bytes = embedding_to_bytes(&v);
        assert_eq!(bytes.len(), v.len() * 4);
        let back = embedding_from_bytes(&bytes).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn embedding_from_bytes_rejects_invalid() {
        assert!(embedding_from_bytes(&[]).is_none());
        assert!(embedding_from_bytes(&[1, 2, 3]).is_none());
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use std::time::Instant;

    fn rand_vec(dim: usize, seed: &mut u64) -> Vec<f32> {
        let mut v = Vec::with_capacity(dim);
        for _ in 0..dim {
            *seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
            let x = ((*seed >> 16) & 0x7fff) as f32 / 32768.0;
            v.push(x);
        }
        v
    }

    fn normalize(v: &mut [f32]) {
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in v.iter_mut() {
                *x /= norm;
            }
        }
    }

    #[test]
    #[ignore = "手动运行：cargo test -- --ignored vector_bench"]
    fn vector_brute_force_50k_bench() {
        const DIM: usize = 1024;
        const N: usize = 50_000;
        let mut seed = 42u64;

        let query = {
            let mut q = rand_vec(DIM, &mut seed);
            normalize(&mut q);
            q
        };

        let now = Utc::now();
        let cache: Vec<CachedVector> = (0..N)
            .map(|i| {
                let mut emb = rand_vec(DIM, &mut seed);
                normalize(&mut emb);
                CachedVector {
                    material_id: format!("m{}", i),
                    chunk_index: 0,
                    chunk_text: String::new(),
                    embedding: to_f16(&emb),
                    content_level: "general".to_string(),
                    tag_ids: vec![],
                    status: "active".to_string(),
                    rating: 3,
                    is_negative: false,
                    quality_score: 3.0,
                    created_at: now.to_rfc3339(),
                }
            })
            .collect();

        const RUNS: usize = 5;
        let mut total_ms = 0u128;
        for _ in 0..RUNS {
            let start = Instant::now();
            let mut scored: Vec<(f32, &CachedVector)> = cache
                .iter()
                .map(|v| {
                    let similarity = cosine_similarity(&query, &v.embedding);
                    let quality_boost = 1.0 + 0.04 * v.quality_score;
                    let weighted = apply_time_decay(similarity * quality_boost, &v.created_at, &now, 0.001);
                    (weighted, v)
                })
                .collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(3);
            let elapsed = start.elapsed().as_millis();
            total_ms += elapsed;
        }

        let avg_ms = total_ms / RUNS as u128;
        println!("Brute-force search over {} x {} dims: avg {} ms", N, DIM, avg_ms);
        let threshold_ms = if cfg!(debug_assertions) { 1000 } else { 200 };
        assert!(
            avg_ms <= threshold_ms,
            "50K brute-force search should be <= {}ms, was {}ms. Consider migrating to LanceDB.",
            threshold_ms,
            avg_ms
        );
    }
}
