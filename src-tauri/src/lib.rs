pub mod chunker;
pub mod commands;
pub mod context;
pub mod db;
pub mod embeddings;
pub mod error;
pub mod llm;
pub mod models;
pub mod parser;
pub mod sex_fingerprint;
pub mod state;
pub mod tokenizer;
pub mod vectordb;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, EnvFilter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("frontend".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Webview,
                ))
                .build(),
        )
        .setup(|app| {
            let app_dir = app.path().app_data_dir().map_err(|e| {
                crate::error::AppError::Other(format!("无法获取应用数据目录: {}", e))
            })?;
            std::fs::create_dir_all(&app_dir)?;

            // Initialize backend file logging.
            let log_dir = app_dir.join("logs");
            std::fs::create_dir_all(&log_dir)?;
            let is_debug = std::env::args().any(|a| a == "--debug");
            let level = if is_debug { "debug" } else { "info" };
            let env_filter = EnvFilter::try_new(level).unwrap_or_else(|_| EnvFilter::new(level));
            let file_appender = tracing_appender::rolling::daily(&log_dir, "rust");
            let (non_blocking, log_guard) = tracing_appender::non_blocking(file_appender);
            let subscriber = tracing_subscriber::registry()
                .with(env_filter)
                .with(
                    tracing_subscriber::fmt::layer()
                        .with_writer(non_blocking)
                        .with_ansi(false),
                );
            tracing::subscriber::set_global_default(subscriber).map_err(|e| {
                crate::error::AppError::Other(format!("初始化日志订阅器失败: {}", e))
            })?;
            app.manage(log_guard);

            db::init_db(app.handle())?;

            let data_dir = db::app_data_dir(app.handle())?;
            let state = tauri::async_runtime::block_on(state::AppState::new(data_dir))?;
            app.manage(state);

            tracing::info!("application setup complete, debug={}", is_debug);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::anchor::list_anchors,
            commands::anchor::create_anchor,
            commands::anchor::update_anchor,
            commands::anchor::delete_anchor,
            commands::book::create_book,
            commands::book::delete_book,
            commands::book::create_volume,
            commands::book::create_chapter,
            commands::book::delete_volume,
            commands::book::delete_chapter,
            commands::book::list_books,
            commands::book::get_book_tree,
            commands::book::get_chapter_content,
            commands::book::update_chapter,
            commands::book::move_volume,
            commands::book::move_chapter,
            commands::book::rename_volume,
            commands::book::rename_book,
            commands::book::export_book,
            commands::material::import_material,
            commands::material::list_materials,
            commands::material::get_material_by_id,
            commands::material::update_material,
            commands::material::update_material_content_level,
            commands::material::update_material_status,
            commands::material::rate_material,
            commands::material::update_material_negative,
            commands::material::delete_material,
            commands::material::search_materials,
            commands::material::search_materials_fts,
            commands::material::preview_import_duplicates,
            commands::material::export_materials,
            commands::material::export_materials_epub,
            commands::material::apply_storage_tier_migration,
            commands::material::get_cleanup_suggestions,
            commands::material::batch_delete_materials,
            commands::material::create_tag,
            commands::material::list_tags,
            commands::material::list_tag_categories,
            commands::material::delete_tag,
            commands::consistency::detect_generation_inconsistencies,
            commands::consistency::recommend_system_prompt_tuning,
            commands::consistency::apply_system_prompt_tuning,
            commands::context::get_writing_context,
            commands::context::render_writing_context,
            commands::context::get_system_prompt_template,
            commands::context::set_system_prompt_template,
            commands::context::get_forbidden_topics,
            commands::context::set_forbidden_topics,
            commands::context::get_adult_mode,
            commands::context::set_adult_mode,
            commands::embedding::get_embedding_config,
            commands::embedding::set_embedding_config,
            commands::embedding::test_embedding_connection,
            commands::ai_model::list_ai_models,
            commands::ai_model::get_ai_model,
            commands::ai_model::get_default_ai_model,
            commands::ai_model::create_ai_model,
            commands::ai_model::update_ai_model,
            commands::ai_model::delete_ai_model,
            commands::ai_model::set_default_ai_model,
            commands::ai_model::set_model_api_key,
            commands::ai_model::has_model_api_key,
            commands::ai_model::test_ai_model_connection,
            commands::ai_model::get_current_ai_model,
            commands::ai_model::switch_generation_model,
            commands::ai_model::check_ollama_status,
            commands::ai_model::list_model_recommendations,
            commands::scene_template::list_scene_templates,
            commands::scene_template::get_scene_template,
            commands::scene_template::create_scene_template,
            commands::scene_template::update_scene_template,
            commands::scene_template::delete_scene_template,
            commands::scene_template::list_scene_template_categories,
            commands::body_state::extract_body_state,
            commands::body_state::get_latest_body_state,
            commands::character::list_characters,
            commands::character::get_character,
            commands::character::create_character,
            commands::character::update_character,
            commands::character::delete_character,
            commands::character::list_scenes,
            commands::character::get_scene,
            commands::character::create_scene,
            commands::character::update_scene,
            commands::character::delete_scene,
            commands::generation::stream_generate,
            commands::generation::abort_generation,
            commands::generation::stream_generate_branch,
            commands::generation::abort_generation_branch,
            commands::generation::stream_generate_beats,
            commands::generation_history::save_generation_history,
            commands::generation_history::list_generation_history,
            commands::generation_history::delete_generation_history,
            commands::generation_params::get_generation_params,
            commands::generation_params::set_generation_params,
            commands::feedback::submit_generation_feedback,
            commands::feedback::reject_generation,
            commands::summary::summarize_chapter,
            commands::summary::summarize_volume,
            commands::summary::summarize_book,
            commands::summary::auto_summarize_chapter,
            commands::style_profile::extract_style_profile,
            commands::style_profile::list_style_profiles,
            commands::style_profile::get_style_profile,
            commands::style_profile::delete_style_profile,
            commands::style_profile::get_active_style_profile_id,
            commands::style_profile::set_active_style_profile_id,
            commands::style_profile::recalibrate_active_style_profile,
            commands::style_profile::evaluate_style_drift,
            commands::style_profile::get_auto_recalibrate_style_profile,
            commands::style_profile::set_auto_recalibrate_style_profile,
            commands::extension_package::import_extension_package,
            commands::extension_package::list_installed_extensions,
            commands::extension_package::get_character_profile_schema,
            commands::extension_package::get_diagnostic_dimensions,
            commands::extension_package::diagnose_text,
            commands::privacy::list_privacy_filter_rules,
            commands::privacy::create_privacy_filter_rule,
            commands::privacy::update_privacy_filter_rule,
            commands::privacy::delete_privacy_filter_rule,
            commands::privacy::get_privacy_filter_rule,
            commands::privacy::get_privacy_mode,
            commands::privacy::set_privacy_mode,
            commands::privacy::apply_privacy_filter,
            commands::shortcuts::get_keyboard_shortcuts,
            commands::shortcuts::set_keyboard_shortcuts,
            commands::storage::get_db_encryption_status,
            commands::storage::enable_db_encryption,
            commands::storage::disable_db_encryption,
            commands::storage::get_backup_status,
            commands::storage::set_backup_enabled,
            commands::storage::set_backup_retention_days,
            commands::storage::manual_backup_now,
            commands::storage::get_log_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
