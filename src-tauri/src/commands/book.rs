use chrono::Utc;
use rusqlite::params;
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::models::{
    Book, Chapter, CreateBookRequest, CreateChapterRequest, CreateVolumeRequest, DocNode,
    UpdateChapterRequest, Volume,
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveVolumeRequest {
    pub book_id: String,
    pub volume_id: String,
    pub direction: String, // "up" | "down"
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveChapterRequest {
    pub volume_id: String,
    pub chapter_id: String,
    pub direction: String, // "up" | "down"
}

#[tauri::command]
pub fn create_book(req: CreateBookRequest) -> Result<Book, AppError> {
    let now = Utc::now().to_rfc3339();
    let book_id = Uuid::new_v4().to_string();
    let volume_id = Uuid::new_v4().to_string();
    let chapter_id = Uuid::new_v4().to_string();

    let mut conn = db::get_db()?;
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO book (id, title, author, description, ai_description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &book_id,
            &req.title,
            req.author.as_deref().unwrap_or(""),
            req.description.as_deref().unwrap_or(""),
            "",
            &now,
            &now
        ],
    )?;

    tx.execute(
        "INSERT INTO volume (id, book_id, title, number, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&volume_id, &book_id, "第一卷", 1, "", &now],
    )?;

    tx.execute(
        "INSERT INTO chapter (id, volume_id, title, number, summary, status, word_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![&chapter_id, &volume_id, "第一章", 1, "", "draft", 0, &now, &now],
    )?;

    tx.execute(
        "INSERT INTO doc_node (id, chapter_id, content, plain_text, word_count, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            Uuid::new_v4().to_string(),
            &chapter_id,
            "",
            "",
            0,
            1,
            &now,
            &now
        ],
    )?;

    tx.commit()?;

    Ok(Book {
        id: book_id,
        title: req.title,
        author: req.author.unwrap_or_default(),
        description: req.description.unwrap_or_default(),
        ai_description: "".to_string(),
        cover_path: None,
        word_count: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn create_volume(req: CreateVolumeRequest) -> Result<Volume, AppError> {
    let now = Utc::now().to_rfc3339();
    let volume_id = Uuid::new_v4().to_string();
    let chapter_id = Uuid::new_v4().to_string();

    let mut conn = db::get_db()?;
    let tx = conn.transaction()?;

    // Get next volume number
    let number: i32 = tx.query_row(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM volume WHERE book_id = ?1",
        [&req.book_id],
        |row| row.get(0),
    )?;

    tx.execute(
        "INSERT INTO volume (id, book_id, title, number, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&volume_id, &req.book_id, &req.title, number, "", &now],
    )?;

    tx.execute(
        "INSERT INTO chapter (id, volume_id, title, number, summary, status, word_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![&chapter_id, &volume_id, "第一章", 1, "", "draft", 0, &now, &now],
    )?;

    tx.execute(
        "INSERT INTO doc_node (id, chapter_id, content, plain_text, word_count, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![&format!("{}-doc", &chapter_id), &chapter_id, "", "", 0, 1, &now, &now],
    )?;

    tx.commit()?;

    Ok(Volume {
        id: volume_id,
        book_id: req.book_id,
        title: req.title,
        number,
        summary: String::new(),
        created_at: now,
        chapters: None,
    })
}

#[tauri::command]
pub fn create_chapter(req: CreateChapterRequest) -> Result<Chapter, AppError> {
    let now = Utc::now().to_rfc3339();
    let chapter_id = Uuid::new_v4().to_string();

    let conn = db::get_db()?;

    let number: i32 = conn.query_row(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM chapter WHERE volume_id = ?1",
        [&req.volume_id],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO chapter (id, volume_id, title, number, summary, status, word_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![&chapter_id, &req.volume_id, &req.title, number, "", "draft", 0, &now, &now],
    )?;

    conn.execute(
        "INSERT INTO doc_node (id, chapter_id, content, plain_text, word_count, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![&format!("{}-doc", &chapter_id), &chapter_id, "", "", 0, 1, &now, &now],
    )?;

    Ok(Chapter {
        id: chapter_id,
        volume_id: req.volume_id,
        title: req.title,
        number,
        summary: String::new(),
        status: "draft".to_string(),
        word_count: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn delete_book(bookId: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    // CASCADE should handle children, but be explicit about the chain
    conn.execute("DELETE FROM doc_node WHERE chapter_id IN (SELECT id FROM chapter WHERE volume_id IN (SELECT id FROM volume WHERE book_id = ?1))", [&bookId])?;
    conn.execute(
        "DELETE FROM chapter WHERE volume_id IN (SELECT id FROM volume WHERE book_id = ?1)",
        [&bookId],
    )?;
    conn.execute("DELETE FROM volume WHERE book_id = ?1", [&bookId])?;
    conn.execute("DELETE FROM character_card WHERE book_id = ?1", [&bookId])?;
    conn.execute("DELETE FROM scene_card WHERE book_id = ?1", [&bookId])?;
    conn.execute("DELETE FROM anchor WHERE book_id = ?1", [&bookId])?;
    conn.execute("DELETE FROM book WHERE id = ?1", [&bookId])?;
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn delete_volume(volumeId: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute(
        "DELETE FROM doc_node WHERE chapter_id IN (SELECT id FROM chapter WHERE volume_id = ?1)",
        [&volumeId],
    )?;
    conn.execute("DELETE FROM chapter WHERE volume_id = ?1", [&volumeId])?;
    conn.execute("DELETE FROM volume WHERE id = ?1", [&volumeId])?;
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn delete_chapter(chapterId: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM doc_node WHERE chapter_id = ?1", [&chapterId])?;
    conn.execute("DELETE FROM chapter WHERE id = ?1", [&chapterId])?;
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn rename_volume(volumeId: String, title: String) -> Result<(), AppError> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Other("卷标题不能为空".to_string()));
    }
    let conn = db::get_db()?;
    // volume 表没有 updated_at 字段（见 db/schema.rs），只更新 title。
    let updated = conn.execute(
        "UPDATE volume SET title = ?1 WHERE id = ?2",
        params![&title, &volumeId],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("卷 {} 不存在", volumeId)));
    }
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn rename_book(bookId: String, title: String) -> Result<(), AppError> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Other("书名不能为空".to_string()));
    }
    let now = Utc::now().to_rfc3339();
    let conn = db::get_db()?;
    let updated = conn.execute(
        "UPDATE book SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![&title, &now, &bookId],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("书籍 {} 不存在", bookId)));
    }
    Ok(())
}

#[tauri::command]
pub fn list_books() -> Result<Vec<Book>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, author, description, ai_description, cover_path, word_count, created_at, updated_at
         FROM book ORDER BY updated_at DESC",
    )?;

    let books = stmt
        .query_map([], |row| {
            Ok(Book {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                description: row.get(3)?,
                ai_description: row.get(4)?,
                cover_path: row.get(5)?,
                word_count: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(books)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn get_book_tree(bookId: String) -> Result<Vec<Volume>, AppError> {
    let conn = db::get_db()?;
    let mut volumes = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT id, book_id, title, number, summary, created_at
         FROM volume WHERE book_id = ?1 ORDER BY number",
    )?;

    let volume_rows = stmt.query_map([&bookId], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(2)?,
            row.get::<_, i32>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;

    for row in volume_rows {
        let (volume_id, title, number, summary, created_at) = row?;

        let mut chapter_stmt = conn.prepare(
            "SELECT id, volume_id, title, number, summary, status, word_count, created_at, updated_at
             FROM chapter WHERE volume_id = ?1 ORDER BY number",
        )?;

        let chapters = chapter_stmt
            .query_map([&volume_id], |row| {
                Ok(Chapter {
                    id: row.get(0)?,
                    volume_id: row.get(1)?,
                    title: row.get(2)?,
                    number: row.get(3)?,
                    summary: row.get(4)?,
                    status: row.get(5)?,
                    word_count: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        volumes.push(Volume {
            id: volume_id,
            book_id: bookId.clone(),
            title,
            number,
            summary,
            created_at,
            chapters: Some(chapters),
        });
    }

    Ok(volumes)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn get_chapter_content(chapterId: String) -> Result<DocNode, AppError> {
    let conn = db::get_db()?;
    let node = conn.query_row(
        "SELECT id, chapter_id, content, plain_text, word_count, version, created_at, updated_at
         FROM doc_node WHERE chapter_id = ?1 ORDER BY version DESC LIMIT 1",
        [&chapterId],
        |row| {
            Ok(DocNode {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                content: row.get(2)?,
                plain_text: row.get(3)?,
                word_count: row.get(4)?,
                version: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )?;

    Ok(node)
}

#[tauri::command]
pub fn move_volume(req: MoveVolumeRequest) -> Result<(), AppError> {
    let conn = db::get_db()?;
    let current: i32 = conn.query_row(
        "SELECT number FROM volume WHERE id = ?1 AND book_id = ?2",
        [&req.volume_id, &req.book_id],
        |row| row.get(0),
    )?;

    let offset = if req.direction == "up" { -1 } else { 1 };
    let target: Option<String> = conn
        .query_row(
            "SELECT id FROM volume WHERE book_id = ?1 AND number = ?2",
            params![&req.book_id, current + offset],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(target_id) = target {
        conn.execute(
            "UPDATE volume SET number = CASE
                WHEN id = ?1 THEN (SELECT number FROM volume WHERE id = ?2)
                WHEN id = ?2 THEN (SELECT number FROM volume WHERE id = ?1)
             END
             WHERE id IN (?1, ?2)",
            [&req.volume_id, &target_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn move_chapter(req: MoveChapterRequest) -> Result<(), AppError> {
    let conn = db::get_db()?;
    let current: i32 = conn.query_row(
        "SELECT number FROM chapter WHERE id = ?1 AND volume_id = ?2",
        [&req.chapter_id, &req.volume_id],
        |row| row.get(0),
    )?;

    let offset = if req.direction == "up" { -1 } else { 1 };
    let target: Option<String> = conn
        .query_row(
            "SELECT id FROM chapter WHERE volume_id = ?1 AND number = ?2",
            params![&req.volume_id, current + offset],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(target_id) = target {
        conn.execute(
            "UPDATE chapter SET number = CASE
                WHEN id = ?1 THEN (SELECT number FROM chapter WHERE id = ?2)
                WHEN id = ?2 THEN (SELECT number FROM chapter WHERE id = ?1)
             END
             WHERE id IN (?1, ?2)",
            [&req.chapter_id, &target_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_chapter(req: UpdateChapterRequest) -> Result<DocNode, AppError> {
    let now = Utc::now().to_rfc3339();
    {
        let mut conn = db::get_db()?;
        let tx = conn.transaction()?;

        // Update chapter metadata
        if let Some(title) = &req.title {
            tx.execute(
                "UPDATE chapter SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, &now, &req.id],
            )?;
        }

        // Update or insert doc_node
        if let (Some(content), Some(plain_text)) = (&req.content, &req.plain_text) {
            let word_count = plain_text.chars().count() as i64;

            // Snapshot current version into doc_version before updating
            tx.execute(
                "INSERT INTO doc_version (id, doc_node_id, content, version, created_at)
                 SELECT ?1, id, content, version, ?2 FROM doc_node WHERE chapter_id = ?3",
                params![Uuid::new_v4().to_string(), &now, &req.id],
            )?;

            // Clean up old versions: keep only the most recent 100 snapshots
            tx.execute(
                "DELETE FROM doc_version WHERE id IN (
                    SELECT id FROM doc_version
                    WHERE doc_node_id = (SELECT id FROM doc_node WHERE chapter_id = ?1)
                    ORDER BY version DESC, created_at DESC
                    LIMIT -1 OFFSET 100
                )",
                [&req.id],
            )?;

            tx.execute(
                "UPDATE doc_node
                 SET content = ?1, plain_text = ?2, word_count = ?3, version = version + 1, updated_at = ?4
                 WHERE chapter_id = ?5",
                params![content, plain_text, word_count, &now, &req.id],
            )?;

            let updated = tx.execute(
                "UPDATE chapter SET word_count = ?1, updated_at = ?2 WHERE id = ?3",
                params![word_count, &now, &req.id],
            )?;

            if updated == 0 {
                return Err(AppError::NotFound(format!("章节 {} 不存在", req.id)));
            }
        }

        tx.commit()?;
    } // drop conn before re-acquiring the global lock

    get_chapter_content(req.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 插入一本书 + 一卷，返回 (book_id, volume_id)。updated_at 用固定旧时间，便于断言更新。
    fn setup_book_with_volume() -> (String, String) {
        crate::db::init_test_db().unwrap();
        let book_id = Uuid::new_v4().to_string();
        let volume_id = Uuid::new_v4().to_string();
        let old_ts = "2020-01-01T00:00:00+00:00";
        let conn = db::get_db().unwrap();
        conn.execute(
            "INSERT INTO book (id, title, author, description, ai_description, created_at, updated_at)
             VALUES (?1, ?2, '', '', '', ?3, ?3)",
            params![&book_id, "旧书名", old_ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO volume (id, book_id, title, number, summary, created_at)
             VALUES (?1, ?2, ?3, 1, '', ?4)",
            params![&volume_id, &book_id, "旧卷名", old_ts],
        )
        .unwrap();
        (book_id, volume_id)
    }

    #[test]
    fn rename_volume_success() {
        let (_book_id, volume_id) = setup_book_with_volume();
        rename_volume(volume_id.clone(), "新卷名".to_string()).unwrap();

        let conn = db::get_db().unwrap();
        let title: String = conn
            .query_row(
                "SELECT title FROM volume WHERE id = ?1",
                [&volume_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "新卷名");
    }

    #[test]
    fn rename_volume_rejects_empty_title() {
        let (_book_id, volume_id) = setup_book_with_volume();
        let err = rename_volume(volume_id.clone(), "   ".to_string()).unwrap_err();
        assert!(matches!(err, AppError::Other(_)));

        // 标题应保持不变
        let conn = db::get_db().unwrap();
        let title: String = conn
            .query_row(
                "SELECT title FROM volume WHERE id = ?1",
                [&volume_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "旧卷名");
    }

    #[test]
    fn rename_book_success() {
        let (book_id, _volume_id) = setup_book_with_volume();
        rename_book(book_id.clone(), "新书名".to_string()).unwrap();

        let conn = db::get_db().unwrap();
        let (title, updated_at): (String, String) = conn
            .query_row(
                "SELECT title, updated_at FROM book WHERE id = ?1",
                [&book_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "新书名");
        assert_ne!(updated_at, "2020-01-01T00:00:00+00:00");
    }

    #[test]
    fn rename_book_rejects_empty_title() {
        let (book_id, _volume_id) = setup_book_with_volume();
        let err = rename_book(book_id.clone(), "".to_string()).unwrap_err();
        assert!(matches!(err, AppError::Other(_)));

        let conn = db::get_db().unwrap();
        let title: String = conn
            .query_row(
                "SELECT title FROM book WHERE id = ?1",
                [&book_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "旧书名");
    }
}
