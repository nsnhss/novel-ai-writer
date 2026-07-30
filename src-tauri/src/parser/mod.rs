use std::path::Path;

use encoding_rs::{Encoding, UTF_8};

#[derive(Debug, Clone)]
pub struct ParsedChapter {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ParsedBook {
    pub title: String,
    pub author: String,
    pub chapters: Vec<ParsedChapter>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("不支持的文件格式: {0}")]
    UnsupportedFormat(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("EPUB 解析错误: {0}")]
    Epub(String),
}

pub async fn parse_file(path: &str) -> Result<ParsedBook, ParseError> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" => parse_txt(path).await,
        "epub" => parse_epub(path).await,
        _ => Err(ParseError::UnsupportedFormat(ext)),
    }
}

async fn parse_txt(path: &str) -> Result<ParsedBook, ParseError> {
    let bytes = tokio::fs::read(path).await?;
    let (encoding, _) = detect_encoding(&bytes);
    let (text, _, had_errors) = encoding.decode(&bytes);

    if had_errors && encoding == UTF_8 {
        // Fallback to GBK if UTF-8 decode had errors
        let (gbk_text, _, _) = encoding_rs::GB18030.decode(&bytes);
        return Ok(split_chapters(&gbk_text, guess_title(path)));
    }

    Ok(split_chapters(&text, guess_title(path)))
}

async fn parse_epub(path: &str) -> Result<ParsedBook, ParseError> {
    let path = path.to_string();
    let path_for_closure = path.clone();
    let mut doc = tokio::task::spawn_blocking(move || {
        epub::doc::EpubDoc::new(&path_for_closure).map_err(|e| ParseError::Epub(e.to_string()))
    })
    .await
    .map_err(|e| ParseError::Epub(e.to_string()))??;

    let title = doc
        .mdata("title")
        .map(|item| item.value.clone())
        .unwrap_or_else(|| guess_title(&path));
    let author = doc
        .mdata("creator")
        .map(|item| item.value.clone())
        .unwrap_or_default();

    let mut chapters = Vec::new();

    // Iterate over spine items and extract text
    let spine_ids: Vec<String> = doc.spine.iter().map(|item| item.idref.clone()).collect();

    for idref in spine_ids {
        if let Some((content, _mime)) = doc.get_resource_str(&idref) {
            let text = html_to_text(&content);
            if !text.trim().is_empty() {
                chapters.push(ParsedChapter {
                    title: idref,
                    content: text,
                });
            }
        }
    }

    Ok(ParsedBook {
        title,
        author,
        chapters,
    })
}

fn guess_title(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名")
        .to_string()
}

fn detect_encoding(bytes: &[u8]) -> (&'static Encoding, bool) {
    // Check BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (UTF_8, true);
    }

    // Try UTF-8
    let (_, _, had_errors) = UTF_8.decode(bytes);
    if !had_errors {
        return (UTF_8, true);
    }

    // Try GB18030
    let (_, _, had_errors) = encoding_rs::GB18030.decode(bytes);
    if !had_errors {
        return (encoding_rs::GB18030, true);
    }

    // Default to UTF-8 and let the caller fallback
    (UTF_8, false)
}

fn split_chapters(text: &str, default_title: String) -> ParsedBook {
    // Try common chapter markers in Chinese web novels
    let patterns = [
        r"^第[一二三四五六七八九十百千万零\d]+章\s*",
        r"^Chapter\s+\d+\s*[:.．]?\s*",
        r"^\d+\s*[、.．]\s*",
    ];

    let mut chapters: Vec<(String, Vec<&str>)> = Vec::new();
    let mut current_title = String::new();
    let mut current_lines: Vec<&str> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_chapter = patterns.iter().any(|pat| {
            regex::Regex::new(pat)
                .map(|re| re.is_match(trimmed))
                .unwrap_or(false)
        });

        if is_chapter {
            if !current_title.is_empty() || !current_lines.is_empty() {
                chapters.push((
                    if current_title.is_empty() {
                        "前言".to_string()
                    } else {
                        current_title.clone()
                    },
                    current_lines.clone(),
                ));
            }
            current_title = trimmed.to_string();
            current_lines.clear();
        } else {
            current_lines.push(line);
        }
    }

    // Push last chapter
    if !current_title.is_empty() || !current_lines.is_empty() {
        chapters.push((
            if current_title.is_empty() {
                default_title.clone()
            } else {
                current_title
            },
            current_lines,
        ));
    }

    // If no chapters detected, treat entire text as one chapter
    if chapters.is_empty() {
        chapters.push((default_title.clone(), text.lines().collect()));
    }

    ParsedBook {
        title: default_title,
        author: String::new(),
        chapters: chapters
            .into_iter()
            .map(|(title, lines)| ParsedChapter {
                title,
                content: lines.join("\n").trim().to_string(),
            })
            .filter(|ch| !ch.content.is_empty())
            .collect(),
    }
}

fn html_to_text(html: &str) -> String {
    // Very basic HTML tag stripping for MVP
    let mut result = String::new();
    let mut in_tag = false;

    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                result.push(' ');
            }
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    // Decode common HTML entities
    result
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
