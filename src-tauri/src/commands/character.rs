use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::models::{CharacterCard, SceneCard};

// ─────────────────────────────────────────────────────────────────────────────
// Character cards
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateCharacterRequest {
    pub book_id: String,
    pub name: String,
    pub aliases: Option<String>,
    pub description: Option<String>,
    pub background: Option<String>,
    pub traits: Option<String>,
    pub relationships: Option<String>,
    pub extended_profile: Option<String>,
    pub adult_profile: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCharacterRequest {
    pub id: String,
    pub name: Option<String>,
    pub aliases: Option<String>,
    pub description: Option<String>,
    pub background: Option<String>,
    pub traits: Option<String>,
    pub relationships: Option<String>,
    pub extended_profile: Option<String>,
    pub adult_profile: Option<String>,
}

fn row_to_character(row: &rusqlite::Row) -> Result<CharacterCard, rusqlite::Error> {
    Ok(CharacterCard {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        aliases: row.get(3)?,
        description: row.get(4)?,
        background: row.get(5)?,
        traits: row.get(6)?,
        relationships: row.get(7)?,
        extended_profile: row.get(8)?,
        adult_profile: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn list_characters(bookId: String) -> Result<Vec<CharacterCard>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, book_id, name, aliases, description, background, traits, relationships, extended_profile, adult_profile, created_at, updated_at
         FROM character_card WHERE book_id = ?1 ORDER BY name",
    )?;
    let rows = stmt
        .query_map([&bookId], row_to_character)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_character(id: String) -> Result<CharacterCard, AppError> {
    let conn = db::get_db()?;
    let row = conn.query_row(
        "SELECT id, book_id, name, aliases, description, background, traits, relationships, extended_profile, adult_profile, created_at, updated_at
         FROM character_card WHERE id = ?1",
        [&id],
        row_to_character,
    )?;
    Ok(row)
}

#[tauri::command]
pub fn create_character(req: CreateCharacterRequest) -> Result<CharacterCard, AppError> {
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    {
        let conn = db::get_db()?;
        conn.execute(
            "INSERT INTO character_card (
                id, book_id, name, aliases, description, background, traits, relationships, extended_profile, adult_profile, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                &id,
                &req.book_id,
                &req.name,
                req.aliases.as_deref().unwrap_or(""),
                req.description.as_deref().unwrap_or(""),
                req.background.as_deref().unwrap_or(""),
                req.traits.as_deref().unwrap_or("{}"),
                req.relationships.as_deref().unwrap_or("{}"),
                req.extended_profile.as_deref().unwrap_or("{}"),
                req.adult_profile.as_deref().unwrap_or(""),
                &now,
                &now
            ],
        )?;
    }
    get_character(id)
}

#[tauri::command]
pub fn update_character(req: UpdateCharacterRequest) -> Result<CharacterCard, AppError> {
    let existing = get_character(req.id.clone())?;
    let name = req.name.unwrap_or(existing.name);
    let aliases = req.aliases.unwrap_or(existing.aliases);
    let description = req.description.unwrap_or(existing.description);
    let background = req.background.unwrap_or(existing.background);
    let traits = req.traits.unwrap_or(existing.traits);
    let relationships = req.relationships.unwrap_or(existing.relationships);
    let extended_profile = req.extended_profile.unwrap_or(existing.extended_profile);
    let adult_profile = req.adult_profile.unwrap_or(existing.adult_profile);
    let now = Utc::now().to_rfc3339();

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE character_card SET
                name = ?1, aliases = ?2, description = ?3, background = ?4,
                traits = ?5, relationships = ?6, extended_profile = ?7, adult_profile = ?8, updated_at = ?9
             WHERE id = ?10",
            params![
                &name, &aliases, &description, &background,
                &traits, &relationships, &extended_profile, &adult_profile, &now, &req.id
            ],
        )?;
    }
    get_character(req.id)
}

#[tauri::command]
pub fn delete_character(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM character_card WHERE id = ?1", [&id])?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene cards
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateSceneRequest {
    pub book_id: String,
    pub name: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub time_period: Option<String>,
    pub atmosphere: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSceneRequest {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub time_period: Option<String>,
    pub atmosphere: Option<String>,
}

fn row_to_scene(row: &rusqlite::Row) -> Result<SceneCard, rusqlite::Error> {
    Ok(SceneCard {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        location: row.get(4)?,
        time_period: row.get(5)?,
        atmosphere: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn list_scenes(bookId: String) -> Result<Vec<SceneCard>, AppError> {
    let conn = db::get_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, book_id, name, description, location, time_period, atmosphere, created_at, updated_at
         FROM scene_card WHERE book_id = ?1 ORDER BY name",
    )?;
    let rows = stmt
        .query_map([&bookId], row_to_scene)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_scene(id: String) -> Result<SceneCard, AppError> {
    let conn = db::get_db()?;
    let row = conn.query_row(
        "SELECT id, book_id, name, description, location, time_period, atmosphere, created_at, updated_at
         FROM scene_card WHERE id = ?1",
        [&id],
        row_to_scene,
    )?;
    Ok(row)
}

#[tauri::command]
pub fn create_scene(req: CreateSceneRequest) -> Result<SceneCard, AppError> {
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    {
        let conn = db::get_db()?;
        conn.execute(
            "INSERT INTO scene_card (id, book_id, name, description, location, time_period, atmosphere, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                &id,
                &req.book_id,
                &req.name,
                req.description.as_deref().unwrap_or(""),
                req.location.as_deref().unwrap_or(""),
                req.time_period.as_deref().unwrap_or(""),
                req.atmosphere.as_deref().unwrap_or(""),
                &now,
                &now
            ],
        )?;
    }
    get_scene(id)
}

#[tauri::command]
pub fn update_scene(req: UpdateSceneRequest) -> Result<SceneCard, AppError> {
    let existing = get_scene(req.id.clone())?;
    let name = req.name.unwrap_or(existing.name);
    let description = req.description.unwrap_or(existing.description);
    let location = req.location.unwrap_or(existing.location);
    let time_period = req.time_period.unwrap_or(existing.time_period);
    let atmosphere = req.atmosphere.unwrap_or(existing.atmosphere);
    let now = Utc::now().to_rfc3339();

    {
        let conn = db::get_db()?;
        conn.execute(
            "UPDATE scene_card SET name = ?1, description = ?2, location = ?3, time_period = ?4, atmosphere = ?5, updated_at = ?6 WHERE id = ?7",
            params![&name, &description, &location, &time_period, &atmosphere, &now, &req.id],
        )?;
    }
    get_scene(req.id)
}

#[tauri::command]
pub fn delete_scene(id: String) -> Result<(), AppError> {
    let conn = db::get_db()?;
    conn.execute("DELETE FROM scene_card WHERE id = ?1", [&id])?;
    Ok(())
}
