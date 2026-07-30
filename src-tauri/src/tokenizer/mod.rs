use std::sync::OnceLock;

use tiktoken_rs::CoreBPE;

use crate::error::AppError;

static TOKENIZER: OnceLock<Result<CoreBPE, String>> = OnceLock::new();

fn get_tokenizer() -> Result<&'static CoreBPE, AppError> {
    let init = TOKENIZER.get_or_init(|| {
        tiktoken_rs::cl100k_base().map_err(|e| format!("初始化 tokenizer 失败: {}", e))
    });

    match init {
        Ok(t) => Ok(t),
        Err(e) => Err(AppError::Other(e.clone())),
    }
}

/// 计算文本对应的 token 数量。
pub fn count_tokens(text: &str) -> Result<usize, AppError> {
    let tokenizer = get_tokenizer()?;
    Ok(tokenizer.encode_ordinary(text).len())
}

/// 将文本截断到不超过 max_tokens 个 token。
///
/// - `from_end = true`：保留开头，从末尾截断（适用于光标前原文）。
/// - `from_end = false`：保留末尾，从开头截断（适用于长文本的尾部片段）。
pub fn truncate_to_tokens(
    text: &str,
    max_tokens: usize,
    from_end: bool,
) -> Result<String, AppError> {
    if text.is_empty() {
        return Ok(String::new());
    }

    let tokenizer = get_tokenizer()?;
    let tokens = tokenizer.encode_ordinary(text);

    if tokens.len() <= max_tokens {
        return Ok(text.to_string());
    }

    let truncated = if from_end {
        // Keep the beginning: take first max_tokens
        &tokens[..max_tokens]
    } else {
        // Keep the end: take last max_tokens
        &tokens[tokens.len() - max_tokens..]
    };

    tokenizer
        .decode(truncated.to_vec())
        .map_err(|e| AppError::Other(format!("解码 token 失败: {}", e)))
}

/// 从文本末尾截断，保留前面的内容。
pub fn truncate_from_end(text: &str, max_tokens: usize) -> Result<String, AppError> {
    truncate_to_tokens(text, max_tokens, true)
}

/// 从文本开头截断，保留末尾的内容。
pub fn truncate_from_start(text: &str, max_tokens: usize) -> Result<String, AppError> {
    truncate_to_tokens(text, max_tokens, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_tokens_empty() {
        assert_eq!(count_tokens("").unwrap(), 0);
    }

    #[test]
    fn test_count_tokens_english() {
        // "hello world" is typically 2 tokens with cl100k_base
        assert_eq!(count_tokens("hello world").unwrap(), 2);
    }

    #[test]
    fn test_truncate_from_end() {
        let text = "hello world, this is a test sentence for truncation";
        let truncated = truncate_from_end(text, 5).unwrap();
        let count = count_tokens(&truncated).unwrap();
        assert_eq!(count, 5);
        assert!(text.starts_with(&truncated));
    }

    #[test]
    fn test_truncate_from_start() {
        let text = "hello world, this is a test sentence for truncation";
        let truncated = truncate_from_start(text, 5).unwrap();
        let count = count_tokens(&truncated).unwrap();
        assert_eq!(count, 5);
        assert!(text.ends_with(&truncated));
    }

    #[test]
    fn test_count_tokens_chinese() {
        // Chinese characters consume more tokens than English words.
        let count = count_tokens("你好世界").unwrap();
        assert!(count >= 2);
    }

    #[test]
    fn test_truncate_to_zero_tokens() {
        let truncated = truncate_from_end("hello world", 0).unwrap();
        assert!(truncated.is_empty());
    }
}
