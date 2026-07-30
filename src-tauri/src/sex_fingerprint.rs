use std::collections::HashMap;

use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SexStyleFingerprint {
    pub male_part_terms: HashMap<String, f64>,
    pub female_part_terms: HashMap<String, f64>,
    pub moan_patterns: HashMap<String, f64>,
    pub dirty_word_usage: f64,
    pub position_detail_level: f64,
    pub aftercare_ratio: f64,
}

pub fn compute_sex_fingerprint(text: &str) -> SexStyleFingerprint {
    if text.trim().is_empty() {
        return SexStyleFingerprint::default();
    }

    let total_chars = text.chars().count().max(1);

    let male_terms = vec![
        "阴茎", "阳具", "肉棒", "鸡巴", "龟头", "男根", "棒", "分身", "阳根", "肉茎",
    ];
    let female_terms = vec![
        "阴道", "阴户", "小穴", "花穴", "蜜穴", "肉穴", "阴蒂", "乳房", "奶子", "胸", "花瓣",
        "花唇", "玉户", "幽谷", "嫩穴",
    ];
    let dirty_words = vec!["操", "肏", "干", "日", "逼", "骚", "淫", "浪", "贱", "荡"];
    let position_action_terms = vec![
        "骑",
        "压",
        "趴",
        "躺",
        "跪",
        "抱",
        "搂",
        "吻",
        "舔",
        "顶",
        "抽插",
        "挺进",
        "进入",
        "占有",
        "贯穿",
        "纠缠",
        "翻身",
        "跨坐",
        "后入",
        "面对面",
        "侧躺",
    ];
    let aftercare_terms = vec![
        "喘息",
        "拥抱",
        "抚摸",
        "亲吻",
        "轻抚",
        "事后",
        "余韵",
        "温存",
        "依偎",
        "呢喃",
        "擦汗",
        "整理衣服",
        "穿好衣服",
        "平静下来",
    ];

    let moan_regexes = vec![
        (
            "嗯啊",
            Regex::new(r"[嗯哼哦噢啊唉呀].{0,3}[嗯哼哦噢啊唉呀]").unwrap(),
        ),
        ("娇喘", Regex::new(r"[娇轻细微].{0,2}[喘吟咛]").unwrap()),
        ("呻吟", Regex::new(r"[呻哀低].{0,2}[吟嗯啊]").unwrap()),
        ("叫床", Regex::new(r"[叫喊哭].{0,2}[出床啊]").unwrap()),
    ];

    let male_counts = count_terms(text, &male_terms);
    let female_counts = count_terms(text, &female_terms);
    let dirty_count = count_terms(text, &dirty_words).values().sum::<usize>();

    let sentences = split_sentences(text);

    let sexual_sentences: Vec<&str> = sentences
        .iter()
        .map(|s| s.as_str())
        .filter(|s| {
            male_terms.iter().any(|t| s.contains(t))
                || female_terms.iter().any(|t| s.contains(t))
                || dirty_words.iter().any(|t| s.contains(t))
                || position_action_terms.iter().any(|t| s.contains(t))
                || aftercare_terms.iter().any(|t| s.contains(t))
                || moan_regexes.iter().any(|(_, re)| re.is_match(s))
        })
        .collect();

    let sexual_sentence_count = sexual_sentences.len().max(1);
    let position_detail_count = sexual_sentences
        .iter()
        .filter(|s| position_action_terms.iter().any(|t| s.contains(t)))
        .count();

    let aftercare_count = sexual_sentences
        .iter()
        .filter(|s| aftercare_terms.iter().any(|t| s.contains(t)))
        .count();

    let mut moan_counts: HashMap<String, usize> = HashMap::new();
    for (label, re) in &moan_regexes {
        let count = re.find_iter(text).count();
        if count > 0 {
            moan_counts.insert(label.to_string(), count);
        }
    }

    SexStyleFingerprint {
        male_part_terms: normalize_counts(&male_counts),
        female_part_terms: normalize_counts(&female_counts),
        moan_patterns: normalize_counts(&moan_counts),
        dirty_word_usage: (dirty_count as f64) / (total_chars as f64) * 1000.0,
        position_detail_level: (position_detail_count as f64) / (sexual_sentence_count as f64),
        aftercare_ratio: (aftercare_count as f64) / (sexual_sentence_count as f64),
    }
}

fn count_terms(text: &str, terms: &[&str]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for term in terms {
        let count = text.matches(term).count();
        if count > 0 {
            counts.insert(term.to_string(), count);
        }
    }
    counts
}
fn normalize_counts(counts: &HashMap<String, usize>) -> HashMap<String, f64> {
    let total: usize = counts.values().sum();
    if total == 0 {
        return HashMap::new();
    }
    counts
        .iter()
        .map(|(k, v)| (k.clone(), (*v as f64) / (total as f64)))
        .collect()
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';') {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                sentences.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        sentences.push(trimmed.to_string());
    }
    sentences
}

pub fn render_fingerprint_summary(fp: &SexStyleFingerprint) -> String {
    let female_summary = top_terms_summary(&fp.female_part_terms, 3);
    let male_summary = top_terms_summary(&fp.male_part_terms, 3);
    let moan_summary = top_terms_summary(&fp.moan_patterns, 2);

    let mut parts = Vec::new();
    if !female_summary.is_empty() {
        parts.push(format!("偏好女性部位称呼：{}", female_summary));
    }
    if !male_summary.is_empty() {
        parts.push(format!("偏好男性部位称呼：{}", male_summary));
    }
    if !moan_summary.is_empty() {
        parts.push(format!("拟声模式以{}为主", moan_summary));
    }
    parts.push(format!(
        "脏话使用率 {:.1}‰；体位/动作描写详细度 {:.2}；事后描写占比 {:.2}",
        fp.dirty_word_usage, fp.position_detail_level, fp.aftercare_ratio
    ));

    parts.join("；")
}
fn top_terms_summary(terms: &HashMap<String, f64>, top_n: usize) -> String {
    if terms.is_empty() {
        return String::new();
    }
    let mut entries: Vec<(&String, &f64)> = terms.iter().collect();
    entries.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
    entries
        .into_iter()
        .take(top_n)
        .map(|(k, v)| format!("{}({:.0}%)", k, v * 100.0))
        .collect::<Vec<_>>()
        .join("、")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_text_returns_default() {
        let fp = compute_sex_fingerprint("");
        assert!(fp.male_part_terms.is_empty());
        assert!(fp.female_part_terms.is_empty());
        assert_eq!(fp.dirty_word_usage, 0.0);
    }

    #[test]
    fn test_detects_signal() {
        let text = "他进入她的小穴，她嗯啊地呻吟着。";
        let fp = compute_sex_fingerprint(text);
        assert!(!fp.female_part_terms.is_empty());
        assert!(fp.position_detail_level > 0.0);
    }
}
