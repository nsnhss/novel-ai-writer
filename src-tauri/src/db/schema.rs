pub struct Migration<'a> {
    pub version: i32,
    pub name: &'static str,
    pub sql: &'a str,
}

pub const MIGRATIONS: &[Migration<'static>] = &[
    Migration {
        version: 2026062701,
        name: "init_core_schema",
        sql: r#"
        CREATE TABLE IF NOT EXISTS book (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT DEFAULT '',
            description TEXT DEFAULT '',
            cover_path TEXT,
            word_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS volume (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            number INTEGER NOT NULL,
            summary TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE(book_id, number)
        );

        CREATE TABLE IF NOT EXISTS chapter (
            id TEXT PRIMARY KEY,
            volume_id TEXT NOT NULL REFERENCES volume(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            number INTEGER NOT NULL,
            summary TEXT DEFAULT '',
            status TEXT DEFAULT 'draft',
            word_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(volume_id, number)
        );

        CREATE TABLE IF NOT EXISTS doc_node (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            word_count INTEGER DEFAULT 0,
            version INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doc_version (
            id TEXT PRIMARY KEY,
            doc_node_id TEXT NOT NULL REFERENCES doc_node(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            version INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS character_card (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            aliases TEXT DEFAULT '',
            description TEXT DEFAULT '',
            background TEXT DEFAULT '',
            traits TEXT DEFAULT '{}',
            relationships TEXT DEFAULT '{}',
            extended_profile TEXT DEFAULT '{}',
            adult_profile TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scene_card (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            location TEXT DEFAULT '',
            time_period TEXT DEFAULT '',
            atmosphere TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tag (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            color TEXT DEFAULT '#808080'
        );

        CREATE TABLE IF NOT EXISTS material (
            id TEXT PRIMARY KEY,
            source_name TEXT DEFAULT '',
            source_type TEXT NOT NULL,
            content TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            content_level TEXT DEFAULT 'general',
            rating INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            style_fingerprint TEXT DEFAULT '',
            hit_count INTEGER DEFAULT 0,
            last_hit_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS material_tag (
            material_id TEXT NOT NULL REFERENCES material(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
            PRIMARY KEY (material_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS scene_template (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'general',
            prompt_template TEXT NOT NULL,
            is_builtin INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_model (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            endpoint TEXT DEFAULT '',
            api_key_ref TEXT DEFAULT '',
            model_name TEXT NOT NULL,
            parameters TEXT DEFAULT '{}',
            recommended_for TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS generation_log (
            id TEXT PRIMARY KEY,
            model_id TEXT REFERENCES ai_model(id),
            chapter_id TEXT REFERENCES chapter(id),
            request_type TEXT NOT NULL,
            input_tokens INTEGER,
            output_tokens INTEGER,
            latency_ms INTEGER,
            rating INTEGER DEFAULT 0,
            accepted INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS generation_history (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
            request_type TEXT NOT NULL,
            instruction TEXT,
            content TEXT NOT NULL,
            rating INTEGER DEFAULT 0,
            accepted INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_generation_history_chapter ON generation_history(chapter_id);

        CREATE TABLE IF NOT EXISTS anchor (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS style_profile (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_material_ids TEXT DEFAULT '[]',
            features TEXT DEFAULT '{}',
            sentence_length_avg REAL,
            sentence_length_std REAL,
            description_ratio REAL,
            dialogue_ratio REAL,
            top_keywords TEXT DEFAULT '[]',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS material_fts USING fts5(
            plain_text, source_name,
            content='material', content_rowid='rowid'
        );
        "#,
    },
    Migration {
        version: 2026062702,
        name: "add_slider_presets",
        sql: r#"
        CREATE TABLE IF NOT EXISTS slider_preset (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sliders TEXT NOT NULL,        -- JSON array of {key, label, min, max, step, default_value}
            mapping_template TEXT NOT NULL, -- template string with {key} placeholders
            category TEXT DEFAULT 'general',
            is_builtin INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    },
    Migration {
        version: 2026062703,
        name: "add_vector_embeddings",
        sql: r#"
        CREATE TABLE IF NOT EXISTS vector_embedding (
            id TEXT PRIMARY KEY,
            material_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            embedding TEXT NOT NULL,      -- JSON array of f32
            tag_ids TEXT DEFAULT '',
            content_level TEXT DEFAULT 'general',
            quality_score REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            UNIQUE(material_id, chunk_index)
        );

        CREATE INDEX IF NOT EXISTS idx_vector_material ON vector_embedding(material_id);
        CREATE INDEX IF NOT EXISTS idx_vector_content_level ON vector_embedding(content_level);
        "#,
    },
    Migration {
        version: 2026062704,
        name: "migrate_doc_node_to_markdown",
        sql: r#"
        -- Migrate existing doc_node/doc_version tables from TipTap JSON to Markdown.
        -- Since TipTap JSON cannot be cleanly converted to Markdown in SQL, we recreate
        -- the tables. This is acceptable during pre-release development.

        DROP TABLE IF EXISTS doc_version;
        DROP TABLE IF EXISTS doc_node;

        CREATE TABLE doc_node (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            word_count INTEGER DEFAULT 0,
            version INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE doc_version (
            id TEXT PRIMARY KEY,
            doc_node_id TEXT NOT NULL REFERENCES doc_node(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            version INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        "#,
    },
    Migration {
        version: 2026062705,
        name: "rename_content_markdown_to_content",
        sql: r#"
        -- No-op: migration 2026062704 already recreated doc_node/doc_version with the `content` column.
        -- The old ALTER TABLE RENAME COLUMN would fail on databases that already have `content`.
        "#,
    },
    Migration {
        version: 2026062706,
        name: "add_book_ai_description",
        sql: r#"
        ALTER TABLE book ADD COLUMN ai_description TEXT DEFAULT '';
        "#,
    },
    Migration {
        version: 2026062707,
        name: "add_privacy_filter_rules",
        sql: r#"
        CREATE TABLE IF NOT EXISTS privacy_filter_rule (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pattern TEXT NOT NULL,
            replacement TEXT NOT NULL DEFAULT '***',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    },
    Migration {
        version: 2026062708,
        name: "add_scene_template_adult_fields",
        sql: r#"
        ALTER TABLE scene_template ADD COLUMN is_adult INTEGER DEFAULT 0;
        ALTER TABLE scene_template ADD COLUMN adult_prompt TEXT DEFAULT '';
        "#,
    },
    Migration {
        version: 2026062709,
        name: "add_material_is_negative",
        sql: r#"
        ALTER TABLE material ADD COLUMN is_negative INTEGER DEFAULT 0;
        ALTER TABLE vector_embedding ADD COLUMN is_negative INTEGER DEFAULT 0;
        "#,
    },
    Migration {
        version: 2026062710,
        name: "add_generation_history_branch_columns",
        sql: r#"
        CREATE TABLE IF NOT EXISTS generation_history (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
            request_type TEXT NOT NULL,
            instruction TEXT,
            content TEXT NOT NULL,
            rating INTEGER DEFAULT 0,
            accepted INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_generation_history_chapter ON generation_history(chapter_id);
        ALTER TABLE generation_history ADD COLUMN group_id TEXT;
        ALTER TABLE generation_history ADD COLUMN branch_index INTEGER DEFAULT 0;
        ALTER TABLE generation_history ADD COLUMN total_branches INTEGER DEFAULT 1;
        "#,
    },
    Migration {
        version: 2026062711,
        name: "add_scene_template_beats",
        sql: r#"
        ALTER TABLE scene_template ADD COLUMN beats TEXT DEFAULT '';
        "#,
    },
    Migration {
        version: 2026062712,
        name: "add_chapter_body_state",
        sql: r#"
        CREATE TABLE IF NOT EXISTS chapter_body_state (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL UNIQUE,
            snapshot TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        );
        "#,
    },
    Migration {
        version: 2026062713,
        name: "add_generation_log_style_profile",
        sql: r#"
        ALTER TABLE generation_log ADD COLUMN style_profile_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_generation_log_profile ON generation_log(style_profile_id);
        "#,
    },
    Migration {
        version: 2026062714,
        name: "add_vector_embedding_blob",
        sql: r#"
        -- 二进制向量存储: 避免 JSON 文本的 3 倍空间开销和解析成本。
        -- 老数据仍保留在 embedding (JSON) 列, 读取时自动兼容, 写入时只写 BLOB。
        ALTER TABLE vector_embedding ADD COLUMN embedding_blob BLOB;
        "#,
    },
];
