use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub ai_description: String,
    pub cover_path: Option<String>,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub number: i32,
    pub summary: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapters: Option<Vec<Chapter>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub volume_id: String,
    pub title: String,
    pub number: i32,
    pub summary: String,
    pub status: String,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocNode {
    pub id: String,
    pub chapter_id: String,
    pub content: String,
    pub plain_text: String,
    pub word_count: i64,
    pub version: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateBookRequest {
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChapterRequest {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub plain_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateVolumeRequest {
    pub book_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateChapterRequest {
    pub volume_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: String,
    pub source_name: String,
    pub source_type: String,
    pub content: String,
    pub plain_text: String,
    pub content_level: String,
    pub rating: i32,
    pub status: String,
    pub is_negative: bool,
    pub style_fingerprint: String,
    pub hit_count: i64,
    pub last_hit_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub category: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SceneTemplate {
    pub id: String,
    pub name: String,
    pub category: String,
    pub prompt_template: String,
    pub is_adult: bool,
    pub adult_prompt: String,
    pub beats: String,
    pub is_builtin: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCard {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub aliases: String,
    pub description: String,
    pub background: String,
    pub traits: String,
    pub relationships: String,
    pub extended_profile: String,
    pub adult_profile: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SceneCard {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub description: String,
    pub location: String,
    pub time_period: String,
    pub atmosphere: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub endpoint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_ref: Option<String>,
    pub model_name: String,
    pub parameters: String,
    pub recommended_for: String,
    pub is_default: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StyleProfile {
    pub id: String,
    pub name: String,
    pub source_material_ids: String,
    pub features: String,
    pub sentence_length_avg: Option<f64>,
    pub sentence_length_std: Option<f64>,
    pub description_ratio: Option<f64>,
    pub dialogue_ratio: Option<f64>,
    pub top_keywords: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub id: String,
    pub book_id: String,
    pub content: String,
    pub category: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistory {
    pub id: String,
    pub chapter_id: String,
    pub request_type: String,
    pub instruction: String,
    pub content: String,
    pub rating: i32,
    pub accepted: bool,
    pub group_id: Option<String>,
    pub branch_index: i32,
    pub total_branches: i32,
    pub created_at: String,
}
