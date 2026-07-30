# -*- coding: utf-8 -*-
"""
生成性能测试数据：10 本书 + 50K 素材(含 1024 维向量) + 1 个 30 万字章节。

用法:
    python scripts/seed-perf-data.py [输出目录]

默认输出到 <项目根>/test-data-perf/novel_ai_writer.db
直接构建最终 schema 并在 _migrations 中标记全部迁移已应用,
应用启动时会跳过迁移。向量 JSON 格式与 src-tauri 的存储格式一致。
"""
import json
import os
import random
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone

NUM_BOOKS = 10
NUM_MATERIALS = 50_000
EMB_DIM = 1024
BIG_CHAPTER_CHARS = 300_000

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PROJECT_ROOT, "test-data-perf")
DB_PATH = os.path.join(OUT_DIR, "novel_ai_writer.db")

MIGRATION_VERSIONS = [
    (2026062701, "init_core_schema"),
    (2026062702, "add_slider_presets"),
    (2026062703, "add_vector_embeddings"),
    (2026062704, "migrate_doc_node_to_markdown"),
    (2026062705, "rename_content_markdown_to_content"),
    (2026062706, "add_book_ai_description"),
    (2026062707, "add_privacy_filter_rules"),
    (2026062708, "add_scene_template_adult_fields"),
    (2026062709, "add_material_is_negative"),
    (2026062710, "add_generation_history_branch_columns"),
    (2026062711, "add_scene_template_beats"),
    (2026062712, "add_chapter_body_state"),
    (2026062713, "add_generation_log_style_profile"),
]

SCHEMA = """
CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE book (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT DEFAULT '',
    description TEXT DEFAULT '', cover_path TEXT, word_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ai_description TEXT DEFAULT ''
);
CREATE TABLE volume (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT NOT NULL, number INTEGER NOT NULL,
    summary TEXT DEFAULT '', created_at TEXT NOT NULL, UNIQUE(book_id, number)
);
CREATE TABLE chapter (
    id TEXT PRIMARY KEY, volume_id TEXT NOT NULL, title TEXT NOT NULL, number INTEGER NOT NULL,
    summary TEXT DEFAULT '', status TEXT DEFAULT 'draft', word_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(volume_id, number)
);
CREATE TABLE doc_node (
    id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, content TEXT NOT NULL, plain_text TEXT NOT NULL,
    word_count INTEGER DEFAULT 0, version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE doc_version (
    id TEXT PRIMARY KEY, doc_node_id TEXT NOT NULL, content TEXT NOT NULL,
    version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE character_card (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT DEFAULT '',
    description TEXT DEFAULT '', background TEXT DEFAULT '', traits TEXT DEFAULT '{}',
    relationships TEXT DEFAULT '{}', extended_profile TEXT DEFAULT '{}', adult_profile TEXT DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE scene_card (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '',
    location TEXT DEFAULT '', time_period TEXT DEFAULT '', atmosphere TEXT DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE tag (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, color TEXT DEFAULT '#808080');
CREATE TABLE material (
    id TEXT PRIMARY KEY, source_name TEXT DEFAULT '', source_type TEXT NOT NULL,
    content TEXT NOT NULL, plain_text TEXT NOT NULL, content_level TEXT DEFAULT 'general',
    rating INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', style_fingerprint TEXT DEFAULT '',
    hit_count INTEGER DEFAULT 0, last_hit_at TEXT, is_negative INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE material_tag (material_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (material_id, tag_id));
CREATE TABLE scene_template (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
    prompt_template TEXT NOT NULL, is_builtin INTEGER DEFAULT 0, created_at TEXT NOT NULL,
    is_adult INTEGER DEFAULT 0, adult_prompt TEXT DEFAULT '', beats TEXT DEFAULT ''
);
CREATE TABLE ai_model (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, endpoint TEXT DEFAULT '',
    api_key_ref TEXT DEFAULT '', model_name TEXT NOT NULL, parameters TEXT DEFAULT '{}',
    recommended_for TEXT DEFAULT '', is_default INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE generation_log (
    id TEXT PRIMARY KEY, model_id TEXT, chapter_id TEXT, request_type TEXT NOT NULL,
    input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER,
    rating INTEGER DEFAULT 0, accepted INTEGER DEFAULT 0, created_at TEXT NOT NULL,
    style_profile_id TEXT
);
CREATE INDEX idx_generation_log_profile ON generation_log(style_profile_id);
CREATE TABLE generation_history (
    id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, request_type TEXT NOT NULL,
    instruction TEXT, content TEXT NOT NULL, rating INTEGER DEFAULT 0, accepted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, group_id TEXT, branch_index INTEGER DEFAULT 0, total_branches INTEGER DEFAULT 1
);
CREATE INDEX idx_generation_history_chapter ON generation_history(chapter_id);
CREATE TABLE anchor (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, content TEXT NOT NULL,
    category TEXT DEFAULT 'general', is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE style_profile (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, source_material_ids TEXT DEFAULT '[]',
    features TEXT DEFAULT '{}', sentence_length_avg REAL, sentence_length_std REAL,
    description_ratio REAL, dialogue_ratio REAL, top_keywords TEXT DEFAULT '[]', updated_at TEXT NOT NULL
);
CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE material_fts USING fts5(plain_text, source_name, content='material', content_rowid='rowid');
CREATE TABLE slider_preset (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sliders TEXT NOT NULL, mapping_template TEXT NOT NULL,
    category TEXT DEFAULT 'general', is_builtin INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE vector_embedding (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL, embedding TEXT NOT NULL, tag_ids TEXT DEFAULT '',
    content_level TEXT DEFAULT 'general', quality_score REAL DEFAULT 0, created_at TEXT NOT NULL,
    is_negative INTEGER DEFAULT 0, UNIQUE(material_id, chunk_index)
);
CREATE INDEX idx_vector_material ON vector_embedding(material_id);
CREATE INDEX idx_vector_content_level ON vector_embedding(content_level);
CREATE TABLE privacy_filter_rule (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, pattern TEXT NOT NULL,
    replacement TEXT NOT NULL DEFAULT '***', is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE chapter_body_state (
    id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL UNIQUE,
    snapshot TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
);
"""

WORDS = list("天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏云腾致雨露结为霜剑光寒影江湖夜雨十年灯")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rand_text(n):
    return "".join(random.choice(WORDS) for _ in range(n))


def rand_embedding_json(rng):
    # 与应用存储格式一致: JSON 数组 of f32
    return "[" + ",".join(f"{rng.uniform(-1, 1):.6f}" for _ in range(EMB_DIM)) + "]"


def main():
    random.seed(42)
    rng = random.Random(42)
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    now = now_iso()

    conn.executemany(
        "INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, datetime('now'))",
        MIGRATION_VERSIONS,
    )
    # 避免启动时触发整库备份, 干扰冷启动计时 (备份一天一次, 单独评估)
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES ('last_backup_date', ?)",
        (datetime.now().strftime("%Y-%m-%d"),),
    )

    # ---- 10 本书, 每本 2 卷 x 5 章 ----
    big_chapter_id = None
    for b in range(NUM_BOOKS):
        book_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO book (id, title, author, description, word_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (book_id, f"性能测试书 {b+1}", "测试作者", "", 0, now, now),
        )
        for v in range(2):
            vol_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO volume (id, book_id, title, number, created_at) VALUES (?,?,?,?,?)",
                (vol_id, book_id, f"第 {v+1} 卷", v + 1, now),
            )
            for c in range(5):
                ch_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO chapter (id, volume_id, title, number, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                    (ch_id, vol_id, f"第 {c+1} 章", c + 1, now, now),
                )
                if b == 0 and v == 0 and c == 0:
                    big_chapter_id = ch_id
                else:
                    text = rand_text(3000)
                    conn.execute(
                        "INSERT INTO doc_node (id, chapter_id, content, plain_text, word_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        (str(uuid.uuid4()), ch_id, text, text, len(text), now, now),
                    )

    # ---- 30 万字大章节 ----
    print("生成 30 万字大章节...")
    big_text = rand_text(BIG_CHAPTER_CHARS)
    conn.execute(
        "INSERT INTO doc_node (id, chapter_id, content, plain_text, word_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), big_chapter_id, big_text, big_text, len(big_text), now, now),
    )

    # ---- 50K 素材 + 向量 ----
    print(f"生成 {NUM_MATERIALS} 条素材与向量...")
    base = datetime.now(timezone.utc)
    batch = []
    for i in range(NUM_MATERIALS):
        mid = str(uuid.uuid4())
        created = (base - timedelta(days=rng.randint(0, 365))).isoformat()
        text = rand_text(rng.randint(50, 500))
        batch.append((mid, f"来源{i % 100}", "imported", text, text, "general",
                      rng.randint(1, 5), "active", created, created))
        if len(batch) >= 1000:
            conn.executemany(
                "INSERT INTO material (id, source_name, source_type, content, plain_text, content_level, rating, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                batch,
            )
            for (mid2, *_rest) in batch:
                pass
            vec_batch = [
                (str(uuid.uuid4()), row[0], 0, row[3][:200], rand_embedding_json(rng),
                 "", "general", float(row[6]), row[8])
                for row in batch
            ]
            conn.executemany(
                "INSERT INTO vector_embedding (id, material_id, chunk_index, chunk_text, embedding, tag_ids, content_level, quality_score, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                vec_batch,
            )
            conn.commit()
            batch = []
            if (i + 1) % 5000 == 0:
                print(f"  {i+1}/{NUM_MATERIALS}")
    if batch:
        conn.executemany(
            "INSERT INTO material (id, source_name, source_type, content, plain_text, content_level, rating, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            batch,
        )
        vec_batch = [
            (str(uuid.uuid4()), row[0], 0, row[3][:200], rand_embedding_json(rng),
             "", "general", float(row[6]), row[8])
            for row in batch
        ]
        conn.executemany(
            "INSERT INTO vector_embedding (id, material_id, chunk_index, chunk_text, embedding, tag_ids, content_level, quality_score, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            vec_batch,
        )

    # ---- FTS 索引重建 ----
    print("重建 FTS 索引...")
    conn.execute("INSERT INTO material_fts(material_fts) VALUES('rebuild')")
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("VACUUM")
    conn.close()

    size_mb = os.path.getsize(DB_PATH) / 1024 / 1024
    print(f"完成: {DB_PATH} ({size_mb:.1f} MB)")
    print(f"大章节 chapter_id: {big_chapter_id}")


if __name__ == "__main__":
    main()
