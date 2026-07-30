/// Chunking strategy for long texts.
///
/// Goals:
/// - Each chunk is semantically coherent (prefer paragraph boundaries).
/// - Chunk size is within [min_size, max_size] characters when possible.
/// - Overlap between chunks helps retrieval continuity.
#[derive(Debug, Clone)]
pub struct ChunkConfig {
    pub max_size: usize,
    pub min_size: usize,
    pub overlap: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            max_size: 500,
            min_size: 50,
            overlap: 50,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TextChunk {
    pub text: String,
    pub start_pos: usize,
    pub end_pos: usize,
}

pub fn chunk_text(text: &str, config: &ChunkConfig) -> Vec<TextChunk> {
    let paragraphs: Vec<&str> = text
        .split('\n')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if paragraphs.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_start = 0;
    let mut global_pos = 0;

    for para in paragraphs {
        // If adding this paragraph exceeds max_size and current is already big enough,
        // finalize current chunk first.
        if !current.is_empty()
            && current.len() + para.len() + 1 > config.max_size
            && current.len() >= config.min_size
        {
            let chunk_text = current.trim().to_string();
            let chunk_end = global_pos;
            chunks.push(TextChunk {
                text: chunk_text.clone(),
                start_pos: current_start,
                end_pos: chunk_end,
            });

            // Build overlap for next chunk
            let overlap_text = build_overlap(&chunk_text, config.overlap);
            current_start = chunk_end - overlap_text.len();
            current = overlap_text;
            current.push('\n');
        }

        if current.is_empty() {
            current_start = global_pos;
        }
        current.push_str(para);
        current.push('\n');
        global_pos += para.len() + 1;

        // If a single paragraph is huge, force split by sentences.
        if current.len() >= config.max_size {
            let (split_chunks, consumed) = split_long_paragraph(&current, current_start, config);
            current.clear();
            global_pos = current_start + consumed;

            for (i, chunk) in split_chunks.iter().enumerate() {
                if i == split_chunks.len() - 1 && chunk.text.len() < config.min_size {
                    // Keep the remainder for next iteration
                    current = chunk.text.clone();
                    current_start = chunk.start_pos;
                    if !current.is_empty() {
                        current.push('\n');
                    }
                } else {
                    chunks.push(chunk.clone());
                }
            }
        }
    }

    // Push remaining content
    let trimmed = current.trim();
    if !trimmed.is_empty() && trimmed.len() >= config.min_size {
        chunks.push(TextChunk {
            text: trimmed.to_string(),
            start_pos: current_start,
            end_pos: global_pos,
        });
    }

    chunks
}

fn build_overlap(text: &str, overlap_size: usize) -> String {
    if text.len() <= overlap_size {
        return text.to_string();
    }

    // Find a safe byte position near the requested overlap size that is on a char boundary.
    let mut start_idx = text.len().saturating_sub(overlap_size);
    while start_idx < text.len() && !text.is_char_boundary(start_idx) {
        start_idx += 1;
    }

    // Try to break at a sentence boundary within the overlap window
    let window = &text[start_idx..];

    // Find sentence boundary (.!? followed by space or newline)
    for window_pair in window.char_indices().collect::<Vec<_>>().windows(2) {
        let prev = window_pair[0];
        let next = window_pair[1];
        if "。！？.!?".contains(prev.1) && next.1.is_whitespace() {
            let byte_pos = start_idx + window_pair[1].0;
            // Ensure the boundary is still on a char boundary (it should be from char_indices).
            if text.is_char_boundary(byte_pos) {
                return text[byte_pos..].trim_start().to_string();
            }
        }
    }

    // Fallback: just take the last N characters from the safe start index
    text[start_idx..].trim_start().to_string()
}

fn split_long_paragraph(
    text: &str,
    start_pos: usize,
    config: &ChunkConfig,
) -> (Vec<TextChunk>, usize) {
    let sentences: Vec<&str> = text
        .split_inclusive(|c: char| "。！？.!?".contains(c))
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_start = start_pos;
    let mut consumed = 0usize;

    for sentence in sentences {
        if !current.is_empty()
            && current.len() + sentence.len() + 1 > config.max_size
            && current.len() >= config.min_size
        {
            let chunk_text = current.trim().to_string();
            chunks.push(TextChunk {
                text: chunk_text,
                start_pos: current_start,
                end_pos: current_start + consumed,
            });

            let overlap_text = build_overlap(&current, config.overlap);
            current_start = current_start + consumed - overlap_text.len();
            current = overlap_text;
            if !current.is_empty() {
                current.push(' ');
            }
        }

        if current.is_empty() {
            current_start = start_pos + consumed;
        }
        current.push_str(sentence);
        current.push(' ');
        consumed += sentence.len() + 1;
    }

    chunks.push(TextChunk {
        text: current.trim().to_string(),
        start_pos: current_start,
        end_pos: start_pos + consumed,
    });

    (chunks, consumed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_short_text() {
        let text = "这是第一段。\n这是第二段。\n这是第三段，内容比较长。";
        let config = ChunkConfig {
            max_size: 100,
            min_size: 10,
            overlap: 5,
        };
        let chunks = chunk_text(text, &config);
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert!(chunk.text.len() <= config.max_size);
        }
    }

    #[test]
    fn test_chunk_long_text() {
        let text = "第一句话。 ".repeat(100);
        let config = ChunkConfig {
            max_size: 200,
            min_size: 50,
            overlap: 20,
        };
        let chunks = chunk_text(&text, &config);
        assert!(chunks.len() > 1);
    }

    #[test]
    fn test_chunk_empty_text() {
        let chunks = chunk_text("", &ChunkConfig::default());
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_whitespace_only() {
        let chunks = chunk_text("   \n\n  ", &ChunkConfig::default());
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_positions_are_monotonic() {
        let text = "第一段内容。\n第二段内容。\n第三段内容更长一些。\n第四段。".repeat(10);
        let config = ChunkConfig {
            max_size: 80,
            min_size: 10,
            overlap: 5,
        };
        let chunks = chunk_text(&text, &config);
        assert!(!chunks.is_empty());
        for window in chunks.windows(2) {
            assert!(window[0].start_pos < window[0].end_pos);
            assert!(window[1].start_pos >= window[0].start_pos);
        }
    }

    #[test]
    fn test_build_overlap_fits_in_window() {
        let text = "第一句。第二句。第三句更长一点。";
        let overlap = build_overlap(text, 20);
        assert!(overlap.len() <= text.len());
        assert!(!overlap.is_empty());
    }
}
