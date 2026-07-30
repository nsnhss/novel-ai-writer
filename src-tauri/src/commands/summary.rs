use chrono::Utc;
use rusqlite::params;
use tauri::State;

use crate::error::AppError;
use crate::llm::GenerateRequest;
use crate::state::AppState;

type ChapterSummaryRow = (String, String, String);
type VolumeSummaryRow = (String, String);

#[allow(non_snake_case)]
#[tauri::command]
pub async fn summarize_chapter(
    chapterId: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let (title, content): (String, String) = tokio::task::spawn_blocking({
        let chapter_id = chapterId.clone();
        move || -> Result<(String, String), AppError> {
            let conn = crate::db::get_db()?;
            let row = conn.query_row(
                "SELECT c.title, dn.content
                 FROM chapter c
                 JOIN doc_node dn ON c.id = dn.chapter_id
                 WHERE c.id = ?1
                 ORDER BY dn.version DESC
                 LIMIT 1",
                [&chapter_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?;
            Ok(row)
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("加载章节失败: {}", e)))??;

    if content.trim().is_empty() {
        return Err(AppError::Other("章节内容为空，无法生成摘要".to_string()));
    }

    let prompt = format!(
        "请为以下网络小说章节生成一段摘要，不超过 300 个 token。摘要应包含本章核心情节、关键人物行动和情绪转折。\n\n章节标题：{}\n\n正文：\n{}\n\n摘要：",
        title,
        truncate_for_summary(&content, 2000)
    );

    let result = state
        .generation_provider
        .read()
        .await
        .generate(GenerateRequest {
            request_type: "summarize".to_string(),
            system_prompt: "你是一位专业中文网络小说编辑，擅长提炼章节核心情节。".to_string(),
            user_prompt: prompt,
            max_tokens: Some(400),
            temperature: Some(0.5),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;

    let summary = result.text.trim().to_string();
    let now = Utc::now().to_rfc3339();

    tokio::task::spawn_blocking({
        let chapter_id = chapterId.clone();
        let summary = summary.clone();
        let now = now.clone();
        move || -> Result<(), AppError> {
            let conn = crate::db::get_db()?;
            conn.execute(
                "UPDATE chapter SET summary = ?1, updated_at = ?2 WHERE id = ?3",
                params![&summary, &now, &chapter_id],
            )?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("更新章节摘要失败: {}", e)))??;

    Ok(summary)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn summarize_volume(
    volumeId: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let (title, chapters): (String, Vec<ChapterSummaryRow>) = tokio::task::spawn_blocking({
        let volume_id = volumeId.clone();
        move || -> Result<(String, Vec<ChapterSummaryRow>), AppError> {
            let conn = crate::db::get_db()?;
            let title: String = conn.query_row(
                "SELECT title FROM volume WHERE id = ?1",
                [&volume_id],
                |row| row.get(0),
            )?;

            let mut stmt = conn.prepare(
                "SELECT c.id, c.title, c.summary
                 FROM chapter c
                 WHERE c.volume_id = ?1
                 ORDER BY c.number",
            )?;
            let rows = stmt
                .query_map([&volume_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok((title, rows))
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("加载卷信息失败: {}", e)))??;

    if chapters.is_empty() {
        return Err(AppError::Other("卷下无章节，无法生成摘要".to_string()));
    }

    let chapter_summaries = chapters
        .iter()
        .map(|(_, title, summary)| format!("{}：{}", title, summary))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "请根据以下各章摘要，生成整卷摘要，不超过 500 个 token。摘要应涵盖卷内主线进展、关键转折和情绪基调。\n\n卷名：{}\n\n各章摘要：\n{}\n\n卷摘要：",
        title, chapter_summaries
    );

    let result = state
        .generation_provider
        .read()
        .await
        .generate(GenerateRequest {
            request_type: "summarize".to_string(),
            system_prompt: "你是一位专业中文网络小说编辑，擅长整合多章内容提炼卷级摘要。"
                .to_string(),
            user_prompt: prompt,
            max_tokens: Some(600),
            temperature: Some(0.5),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;

    let summary = result.text.trim().to_string();

    tokio::task::spawn_blocking({
        let volume_id = volumeId.clone();
        let summary = summary.clone();
        move || -> Result<(), AppError> {
            let conn = crate::db::get_db()?;
            conn.execute(
                "UPDATE volume SET summary = ?1 WHERE id = ?2",
                params![&summary, &volume_id],
            )?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("更新卷摘要失败: {}", e)))??;

    Ok(summary)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn summarize_book(
    bookId: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let (title, description, volumes): (String, String, Vec<VolumeSummaryRow>) =
        tokio::task::spawn_blocking({
            let book_id = bookId.clone();
            move || -> Result<(String, String, Vec<VolumeSummaryRow>), AppError> {
                let conn = crate::db::get_db()?;
                let (title, description): (String, String) = conn.query_row(
                    "SELECT title, description FROM book WHERE id = ?1",
                    [&book_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;

                let mut stmt = conn.prepare(
                    "SELECT title, summary FROM volume WHERE book_id = ?1 ORDER BY number",
                )?;
                let rows = stmt
                    .query_map([&book_id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;

                Ok((title, description, rows))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("加载书籍信息失败: {}", e)))??;

    if volumes.is_empty() {
        return Err(AppError::Other("书籍下无卷，无法生成摘要".to_string()));
    }

    let volume_summaries = volumes
        .iter()
        .map(|(title, summary)| format!("{}：{}", title, summary))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "请根据以下各卷摘要，生成书籍级梗概，不超过 800 个 token。梗概应涵盖全书主线、核心冲突和整体基调。\n\n书名：{}\n现有简介：{}\n\n各卷摘要：\n{}\n\n书籍梗概：",
        title, description, volume_summaries
    );

    let result = state
        .generation_provider
        .read()
        .await
        .generate(GenerateRequest {
            request_type: "summarize".to_string(),
            system_prompt: "你是一位专业中文网络小说编辑，擅长从卷摘要提炼全书梗概。".to_string(),
            user_prompt: prompt,
            max_tokens: Some(900),
            temperature: Some(0.5),
            top_p: None,
            top_k: None,
            repetition_penalty: None,
            frequency_penalty: None,
        })
        .await?;

    let summary = result.text.trim().to_string();
    let now = Utc::now().to_rfc3339();

    tokio::task::spawn_blocking({
        let book_id = bookId.clone();
        let summary = summary.clone();
        let now = now.clone();
        move || -> Result<(), AppError> {
            let conn = crate::db::get_db()?;
            conn.execute(
                "UPDATE book SET ai_description = ?1, updated_at = ?2 WHERE id = ?3",
                params![&summary, &now, &book_id],
            )?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("更新书籍梗概失败: {}", e)))??;

    Ok(summary)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn auto_summarize_chapter(
    chapterId: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let (summary, content_len): (String, usize) = tokio::task::spawn_blocking({
        let chapter_id = chapterId.clone();
        move || -> Result<(String, usize), AppError> {
            let conn = crate::db::get_db()?;
            let (summary, content): (String, String) = conn.query_row(
                "SELECT c.summary, dn.content
                 FROM chapter c
                 JOIN doc_node dn ON c.id = dn.chapter_id
                 WHERE c.id = ?1
                 ORDER BY dn.version DESC
                 LIMIT 1",
                [&chapter_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?;
            Ok((summary, content.chars().count()))
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("加载章节信息失败: {}", e)))??;

    if content_len > 500 && summary.trim().is_empty() {
        let summary = summarize_chapter(chapterId, state).await?;
        Ok(Some(summary))
    } else {
        Ok(None)
    }
}

fn truncate_for_summary(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        text.chars().take(max_chars).collect::<String>() + "…"
    }
}
