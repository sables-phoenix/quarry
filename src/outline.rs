use crate::model::{estimate_tokens, Heading, Section};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static HEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(#{1,6})\s+(.+?)\s*$").unwrap());
static LINKS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").unwrap());
static EMPH: Lazy<Regex> = Lazy::new(|| Regex::new(r"[*_`]").unwrap());
static NON_ALNUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-z0-9]+").unwrap());

pub fn slugify(text: &str) -> String {
    let plain = LINKS.replace_all(text, "$1");
    let plain = EMPH.replace_all(&plain, "");
    let lower = plain.to_ascii_lowercase();
    let slug = NON_ALNUM.replace_all(&lower, "-");
    slug.trim_matches('-').to_string()
}

pub fn headings(text: &str) -> Vec<Heading> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<Heading> = Vec::new();
    let mut used: HashMap<String, usize> = HashMap::new();
    let mut last_line = lines.len();
    for (i, line) in lines.iter().enumerate() {
        let Some(caps) = HEADING.captures(line) else {
            continue;
        };
        let level = caps[1].len();
        let raw = caps[2].to_string();
        let base = slugify(&raw);
        let base = if base.is_empty() {
            "section".to_string()
        } else {
            base
        };
        let count = used.entry(base.clone()).or_insert(0);
        *count += 1;
        let anchor = if *count == 1 {
            base
        } else {
            format!("{}-{}", base, count)
        };
        out.push(Heading {
            level,
            text: raw,
            anchor,
            line: i,
            chars: 0,
            tokens_est: 0,
        });
        let _ = last_line;
    }
    for h in out.iter_mut() {
        let end = section_end(&lines, h.line, h.level);
        let body: String = lines[h.line..end].join("\n");
        h.chars = body.chars().count();
        h.tokens_est = estimate_tokens(h.chars);
    }
    last_line = lines.len();
    let _ = last_line;
    out
}

fn section_end(lines: &[&str], start: usize, level: usize) -> usize {
    for (i, line) in lines.iter().enumerate().skip(start + 1) {
        if let Some(caps) = HEADING.captures(line) {
            if caps[1].len() <= level {
                return i;
            }
        }
    }
    lines.len()
}

pub fn sections(text: &str) -> Vec<Section> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    for h in headings(text) {
        let end = section_end(&lines, h.line, h.level);
        let body = lines[h.line..end].join("\n").trim().to_string();
        out.push(Section {
            anchor: h.anchor,
            level: h.level,
            text: h.text,
            body,
            chars: 0,
            tokens_est: 0,
        });
    }
    for s in out.iter_mut() {
        s.chars = s.body.chars().count();
        s.tokens_est = estimate_tokens(s.chars);
    }
    out
}

pub fn section(text: &str, anchor: &str) -> Option<Section> {
    sections(text).into_iter().find(|s| s.anchor == anchor)
}

pub fn render_outline(headings: &[Heading]) -> String {
    let mut out = String::new();
    for h in headings {
        let indent = "  ".repeat(h.level.saturating_sub(1));
        out.push_str(&format!(
            "{}{} {} [{}] ~{} tokens\n",
            indent,
            "#".repeat(h.level),
            h.text,
            h.anchor,
            h.tokens_est
        ));
    }
    out
}

static STOP: Lazy<std::collections::HashSet<&'static str>> = Lazy::new(|| {
    [
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "to",
        "in",
        "on",
        "for",
        "with",
        "how",
        "do",
        "does",
        "did",
        "is",
        "are",
        "was",
        "were",
        "what",
        "when",
        "why",
        "which",
        "who",
        "i",
        "my",
        "me",
        "we",
        "our",
        "you",
        "your",
        "it",
        "this",
        "that",
        "these",
        "those",
        "can",
        "could",
        "should",
        "would",
        "use",
        "using",
        "used",
        "get",
        "set",
        "from",
        "by",
        "as",
        "at",
        "be",
        "been",
        "if",
        "then",
        "than",
        "so",
        "not",
        "no",
        "but",
        "work",
        "works",
        "working",
        "mean",
        "means",
        "happen",
        "happens",
        "difference",
        "between",
        "example",
        "examples",
        "need",
        "needs",
        "make",
        "makes",
        "way",
        "ways",
    ]
    .into_iter()
    .collect()
});

fn terms(query: &str) -> Vec<String> {
    query
        .to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        .filter(|w| w.len() > 1 && !STOP.contains(*w))
        .map(str::to_string)
        .collect()
}

pub fn rank(text: &str, query: &str, top_n: usize, max_chars: usize) -> Vec<Section> {
    let terms = terms(query);
    if text.chars().count() <= 12000 {
        let body = if text.chars().count() > max_chars {
            let cut = floor_char_boundary(text, max_chars);
            format!("{}\n\n[truncated]", &text[..cut])
        } else {
            text.to_string()
        };
        let chars = body.chars().count();
        return vec![Section {
            anchor: "full".into(),
            level: 1,
            text: String::new(),
            body,
            chars,
            tokens_est: estimate_tokens(chars),
        }];
    }
    let all = sections(text);
    if all.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(f64, Section)> = Vec::new();
    for s in all {
        if s.level == 1 && s.chars > 2000 {
            continue;
        }
        if s.chars < 60 {
            continue;
        }
        let head = s.text.to_ascii_lowercase();
        let body = s.body.to_ascii_lowercase();
        let mut score = 0.0;
        let mut covered = 0.0;
        for t in &terms {
            let in_head = head.matches(t.as_str()).count() as f64;
            let in_body = body.matches(t.as_str()).count() as f64;
            if in_head + in_body > 0.0 {
                covered += 1.0;
            }
            score += in_head * 12.0 + (in_body.min(12.0) * 0.5);
        }
        if score <= 0.0 {
            continue;
        }
        score += covered * 15.0;
        if s.chars > 6000 {
            score *= 0.6;
        }
        scored.push((score, s));
    }
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    let mut used = 0usize;
    for (_, mut s) in scored {
        if out.len() >= top_n || used + s.chars > max_chars {
            continue;
        }
        used += s.chars;
        if s.body.len() > max_chars {
            let cut = floor_char_boundary(&s.body, max_chars);
            s.body.truncate(cut);
            s.body.push_str("\n\n[truncated]");
        }
        s.chars = s.body.chars().count();
        s.tokens_est = estimate_tokens(s.chars);
        out.push(s);
    }
    if out.is_empty() {
        let mut first = sections(text)
            .into_iter()
            .find(|s| s.chars >= 60)
            .unwrap_or_else(|| Section {
                anchor: "top".into(),
                level: 1,
                text: String::new(),
                body: String::new(),
                chars: 0,
                tokens_est: 0,
            });
        if !first.body.is_empty() && first.chars > max_chars {
            let cut = floor_char_boundary(&first.body, max_chars);
            first.body.truncate(cut);
            first.body.push_str("\n\n[truncated]");
            first.chars = first.body.chars().count();
            first.tokens_est = estimate_tokens(first.chars);
        }
        if !first.body.is_empty() {
            out.push(first);
        }
    }
    out
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

pub fn keywords(query: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for t in terms(query) {
        if !out.contains(&t) {
            out.push(t);
        }
        if out.len() >= 6 {
            break;
        }
    }
    out.join(" ")
}
