use crate::model::Link;
use ego_tree::NodeRef;
use once_cell::sync::Lazy;
use regex::Regex;
use scraper::{Html, Node, Selector};
use std::collections::HashSet;

const BLOCK_TAGS: &[&str] = &[
    "article",
    "main",
    "section",
    "div",
    "p",
    "ul",
    "ol",
    "li",
    "pre",
    "table",
    "thead",
    "tbody",
    "tr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "figure",
    "figcaption",
    "dl",
    "dt",
    "dd",
    "details",
    "summary",
];

const SKIP_TAGS: &[&str] = &[
    "script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed",
    "form", "button", "input", "select", "textarea", "nav", "aside", "footer", "header", "menu",
];

const CHROME_TAGS: &[&str] = &["nav", "aside", "footer", "header", "menu"];

pub struct Extracted {
    pub title: String,
    pub text: String,
    pub links: Vec<Link>,
    pub needs_browser: bool,
}

pub fn extract(html: &str, base_url: &str, max_chars: usize, keep_links: bool) -> Extracted {
    let doc = Html::parse_document(html);
    let title = page_title(&doc);
    let scripts = count_tag(&doc, "script");
    let root = main_region(&doc);
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    let mut out = String::with_capacity(8192);
    let mut state = WalkState {
        base: base_url.to_string(),
        out: &mut out,
        links: &mut links,
        seen: &mut seen,
        keep_links,
        list_depth: 0,
        quote_depth: 0,
        in_pre: false,
    };
    state.walk_children(root);
    let mut text = normalize(&out);
    text = strip_frontmatter(&text);
    text = drop_jsx_lines(&text);
    text = drop_chrome_lines(&text);
    text = drop_tail_sections(&text);
    let visible = text.chars().filter(|c| !c.is_whitespace()).count();
    let needs_browser = visible < 400 && scripts >= 3;
    if text.len() > max_chars {
        let cut = floor_char_boundary(&text, max_chars);
        text.truncate(cut);
        text.push_str("\n\n[truncated]");
    }
    Extracted {
        title,
        text,
        links,
        needs_browser,
    }
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

fn page_title(doc: &Html) -> String {
    for sel in ["meta[property='og:title']", "meta[name='twitter:title']"] {
        if let Ok(s) = Selector::parse(sel) {
            if let Some(e) = doc.select(&s).next() {
                if let Some(c) = e.value().attr("content") {
                    let t = c.trim();
                    if !t.is_empty() {
                        return t.to_string();
                    }
                }
            }
        }
    }
    if let Ok(s) = Selector::parse("title") {
        if let Some(e) = doc.select(&s).next() {
            let t = e.text().collect::<Vec<_>>().join(" ");
            let t = t.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    if let Ok(s) = Selector::parse("h1") {
        if let Some(e) = doc.select(&s).next() {
            let t = inline_text(doc.tree.get(e.id()).unwrap());
            if !t.is_empty() {
                return t;
            }
        }
    }
    String::new()
}

fn count_tag(doc: &Html, tag: &str) -> usize {
    match Selector::parse(tag) {
        Ok(s) => doc.select(&s).count(),
        Err(_) => 0,
    }
}

fn main_region(doc: &Html) -> NodeRef<'_, Node> {
    let candidates = ["main", "article", "[role='main']", "div", "section", "td"];
    let best = best_candidate(doc, &candidates);
    match best {
        Some(id) => doc.tree.get(id).unwrap(),
        None => doc.tree.get(doc.root_element().id()).unwrap(),
    }
}

fn best_candidate(doc: &Html, candidates: &[&str]) -> Option<ego_tree::NodeId> {
    let mut scores: Vec<(f64, usize, ego_tree::NodeId)> = Vec::new();
    let chrome: HashSet<&str> = CHROME_TAGS.iter().copied().collect();
    for sel in candidates {
        let Ok(selector) = Selector::parse(sel) else {
            continue;
        };
        for el in doc.select(&selector) {
            if chrome.contains(el.value().name()) {
                continue;
            }
            let mut text_len = 0usize;
            let mut link_len = 0usize;
            let mut paragraphs = 0usize;
            let mut headings = 0usize;
            collect_stats(
                el,
                &mut text_len,
                &mut link_len,
                &mut paragraphs,
                &mut headings,
            );
            if text_len < 200 {
                continue;
            }
            let density = link_len as f64 / text_len as f64;
            let score = text_len as f64 * (1.0 - density).max(0.05)
                + 120.0 * paragraphs as f64
                + 60.0 * headings as f64;
            scores.push((score, text_len, el.id()));
        }
    }
    if scores.is_empty() {
        return None;
    }
    scores.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let top = scores[0];
    let mut chosen = top.2;
    let mut chosen_score = top.0;
    let mut node = doc.tree.get(chosen).unwrap();
    while let Some(parent) = node.parent() {
        if parent.value().is_element() {
            let mut text_len = 0usize;
            let mut link_len = 0usize;
            let mut paragraphs = 0usize;
            let mut headings = 0usize;
            if let Some(el) = scraper::ElementRef::wrap(parent) {
                collect_stats(
                    el,
                    &mut text_len,
                    &mut link_len,
                    &mut paragraphs,
                    &mut headings,
                );
                let density = link_len as f64 / text_len.max(1) as f64;
                let score = text_len as f64 * (1.0 - density).max(0.05)
                    + 120.0 * paragraphs as f64
                    + 60.0 * headings as f64;
                if score >= chosen_score * 0.92 {
                    chosen = parent.id();
                    chosen_score = score;
                }
            }
        }
        node = parent;
    }
    Some(chosen)
}

fn collect_stats(
    el: scraper::ElementRef<'_>,
    text_len: &mut usize,
    link_len: &mut usize,
    paragraphs: &mut usize,
    headings: &mut usize,
) {
    for node in el.descendants() {
        if let Some(t) = node.value().as_text() {
            *text_len += t.trim().len();
        }
        if let Some(e) = node.value().as_element() {
            match e.name() {
                "a" => {
                    for d in node.descendants() {
                        if let Some(t) = d.value().as_text() {
                            *link_len += t.trim().len();
                        }
                    }
                }
                "p" => *paragraphs += 1,
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => *headings += 1,
                _ => {}
            }
        }
    }
}

struct WalkState<'a> {
    base: String,
    keep_links: bool,
    out: &'a mut String,
    links: &'a mut Vec<Link>,
    seen: &'a mut HashSet<String>,
    list_depth: usize,
    quote_depth: usize,
    in_pre: bool,
}

impl<'a> WalkState<'a> {
    fn walk_children(&mut self, node: NodeRef<'_, Node>) {
        for child in node.children() {
            self.walk(child);
        }
    }

    fn walk(&mut self, node: NodeRef<'_, Node>) {
        match node.value() {
            Node::Text(t) => {
                if self.in_pre {
                    self.out.push_str(t);
                } else {
                    self.push_inline(&collapse_ws(t));
                }
            }
            Node::Element(e) => {
                let tag = e.name();
                if SKIP_TAGS.contains(&tag) {
                    return;
                }
                match tag {
                    "br" => self.out.push('\n'),
                    "hr" => self.block("---"),
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        let level = tag[1..].parse::<usize>().unwrap_or(2);
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.block(&format!("{} {}", "#".repeat(level.clamp(1, 6)), text));
                        }
                    }
                    "p" => {
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.block(&text);
                        }
                    }
                    "pre" => {
                        let code = pre_text(node);
                        if !code.trim().is_empty() {
                            let lang = code_lang(node);
                            let fence = if code.contains("```") { "````" } else { "```" };
                            self.block(&format!(
                                "{}{}\n{}\n{}",
                                fence,
                                lang,
                                code.trim_end(),
                                fence
                            ));
                        }
                    }
                    "ul" | "ol" => {
                        self.block("");
                        self.list_depth += 1;
                        self.walk_children(node);
                        self.list_depth -= 1;
                        self.block("");
                    }
                    "li" => {
                        let marker = "- ".to_string();
                        self.out
                            .push_str(&"  ".repeat(self.list_depth.saturating_sub(1)));
                        self.out.push_str(&marker);
                        self.walk_list_item(node);
                        self.out.push('\n');
                    }
                    "table" => {
                        let table = render_table(node);
                        if !table.is_empty() {
                            self.block(&table);
                        }
                    }
                    "blockquote" => {
                        self.block("");
                        self.quote_depth += 1;
                        self.walk_children(node);
                        self.quote_depth -= 1;
                        self.block("");
                    }
                    "a" => {
                        let href = e.attr("href").unwrap_or("");
                        let text = inline_text(node);
                        if text.is_empty() {
                            return;
                        }
                        if href.is_empty()
                            || href.starts_with('#')
                            || href.starts_with("javascript:")
                        {
                            self.push_inline(&text);
                        } else {
                            let abs = absolute(&self.base, href);
                            if self.seen.insert(abs.clone()) && self.links.len() < 64 {
                                self.links.push(Link {
                                    url: abs.clone(),
                                    text: text.clone(),
                                });
                            }
                            let is_nav = text.len() < 4 && !looks_like_content_link(&text);
                            if is_nav || !self.keep_links {
                                self.push_inline(&text);
                            } else {
                                self.push_inline(&format!("[{}]({})", text, abs));
                            }
                        }
                    }
                    "strong" | "b" => {
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.push_inline(&format!("**{}**", text));
                        }
                    }
                    "em" | "i" => {
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.push_inline(&format!("*{}*", text));
                        }
                    }
                    "code" => {
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.push_inline(&format!("`{}`", text));
                        }
                    }
                    "img" => {
                        if let Some(alt) = e.attr("alt") {
                            let alt = alt.trim();
                            if !alt.is_empty() {
                                self.push_inline(&format!("[image: {}]", alt));
                            }
                        }
                    }
                    "dt" => {
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.block(&format!("**{}**", text));
                        }
                    }
                    "dd" => {
                        let text = inline_text(node);
                        if !text.is_empty() {
                            self.block(&format!("  {}", text));
                        }
                    }
                    _ => {
                        if BLOCK_TAGS.contains(&tag) {
                            let text = inline_text(node);
                            if !text.is_empty() && !has_block_children(node) {
                                self.block(&text);
                            } else {
                                self.walk_children(node);
                            }
                        } else {
                            self.walk_children(node);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn walk_list_item(&mut self, node: NodeRef<'_, Node>) {
        for child in node.children() {
            if let Some(e) = child.value().as_element() {
                if e.name() == "ul" || e.name() == "ol" {
                    self.out.push('\n');
                    self.list_depth += 1;
                    self.walk_children(child);
                    self.list_depth -= 1;
                    continue;
                }
            }
            self.walk(child);
        }
    }

    fn push_inline(&mut self, s: &str) {
        if s.is_empty() {
            return;
        }
        let prev = self.out.chars().last();
        let next = s.chars().next();
        let need_space = prev
            .map(|c| !c.is_whitespace() && !"([/".contains(c))
            .unwrap_or(false)
            && next
                .map(|c| !c.is_whitespace() && !",.;:)!?]".contains(c))
                .unwrap_or(false);
        if need_space {
            self.out.push(' ');
        }
        self.out.push_str(s);
    }

    fn block(&mut self, s: &str) {
        if !self.out.is_empty() && !self.out.ends_with("\n\n") {
            if !self.out.ends_with('\n') {
                self.out.push('\n');
            }
            self.out.push('\n');
        }
        if self.quote_depth > 0 {
            for line in s.lines() {
                self.out.push_str("> ");
                self.out.push_str(line);
                self.out.push('\n');
            }
        } else {
            self.out.push_str(s);
            if !s.is_empty() {
                self.out.push('\n');
            }
        }
        self.out.push('\n');
    }
}

fn strip_frontmatter(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut consumed = 0usize;
    let mut started = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if !started {
            if t.is_empty() {
                consumed = i + 1;
                continue;
            }
            if t.starts_with("---") {
                started = true;
                consumed = i + 1;
                if t.len() > 3 && t.ends_with("---") {
                    break;
                }
                continue;
            }
            return text.to_string();
        }
        consumed = i + 1;
        if t == "---" || t.ends_with("---") && t.len() < 6 {
            break;
        }
        if i > 40 {
            return text.to_string();
        }
    }
    if !started {
        return text.to_string();
    }
    lines[consumed..]
        .join("\n")
        .trim_start_matches('\n')
        .to_string()
}

fn drop_jsx_lines(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let t = line.trim();
            if t.is_empty() {
                return true;
            }
            let jsx = t.starts_with('<')
                && t.ends_with('>')
                && !t.starts_with("</")
                && t.chars()
                    .nth(1)
                    .map(|c| c.is_ascii_uppercase())
                    .unwrap_or(false);
            let close = t.starts_with("</")
                && t.chars()
                    .nth(2)
                    .map(|c| c.is_ascii_uppercase())
                    .unwrap_or(false);
            let mdx_comment = t.starts_with("{/*") && t.ends_with("*/}");
            let mdx_attr = t.starts_with('{') && t.ends_with('}') && t.len() < 80;
            !(jsx || close || mdx_comment || mdx_attr)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn drop_tail_sections(text: &str) -> String {
    const TAIL: &[&str] = &[
        "references",
        "external links",
        "see also",
        "further reading",
        "notes",
        "citations",
        "bibliography",
        "footnotes",
        "sources",
    ];
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<&str> = Vec::new();
    let mut skip_level: Option<usize> = None;
    for line in lines {
        if let Some(caps) = HEADING_RE.captures(line) {
            let level = caps[1].len();
            let title = caps[2].trim().trim_end_matches(':').to_ascii_lowercase();
            if skip_level.map(|s| level <= s).unwrap_or(true) && TAIL.contains(&title.as_str()) {
                skip_level = Some(level);
                continue;
            }
            if skip_level.map(|s| level <= s).unwrap_or(false) {
                skip_level = None;
            }
        }
        if skip_level.is_none() {
            out.push(line);
        }
    }
    out.join("\n")
}

static HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(#{1,6})\s+(.+?)\s*$").unwrap());

fn drop_chrome_lines(text: &str) -> String {
    const NOISE: &[&str] = &[
        "skip to main content",
        "skip to search",
        "skip to content",
        "skip navigation",
        "toggle navigation",
        "edit on github",
        "edit this page",
        "was this page helpful",
        "table of contents",
    ];
    text.lines()
        .filter(|line| {
            let t = line
                .trim()
                .trim_start_matches(['-', '*', ' '])
                .to_ascii_lowercase();
            !NOISE.contains(&t.as_str())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn looks_like_content_link(text: &str) -> bool {
    text.split_whitespace().count() >= 3 || text.chars().any(|c| c.is_ascii_digit())
}

fn has_block_children(node: NodeRef<'_, Node>) -> bool {
    node.children().any(|c| {
        c.value()
            .as_element()
            .map(|e| BLOCK_TAGS.contains(&e.name()))
            .unwrap_or(false)
    })
}

fn pre_text(node: NodeRef<'_, Node>) -> String {
    let mut s = String::new();
    for d in node.descendants() {
        if let Some(t) = d.value().as_text() {
            s.push_str(t);
        }
        if let Some(e) = d.value().as_element() {
            if e.name() == "br" {
                s.push('\n');
            }
        }
    }
    s
}

fn code_lang(node: NodeRef<'_, Node>) -> String {
    for d in node.descendants() {
        if let Some(e) = d.value().as_element() {
            if e.name() == "code" {
                if let Some(class) = e.attr("class") {
                    for token in class.split_whitespace() {
                        if let Some(lang) = token.strip_prefix("language-") {
                            return lang.to_string();
                        }
                        if let Some(lang) = token.strip_prefix("lang-") {
                            return lang.to_string();
                        }
                    }
                }
            }
        }
    }
    String::new()
}

fn inline_text(node: NodeRef<'_, Node>) -> String {
    let mut s = String::new();
    collect_inline(node, &mut s);
    collapse_ws(&s)
}

fn collect_inline(node: NodeRef<'_, Node>, out: &mut String) {
    for child in node.children() {
        match child.value() {
            Node::Text(t) => out.push_str(t),
            Node::Element(e) => {
                let tag = e.name();
                if SKIP_TAGS.contains(&tag) {
                    continue;
                }
                match tag {
                    "br" => out.push('\n'),
                    "code" => {
                        out.push('`');
                        collect_inline(child, out);
                        out.push('`');
                    }
                    "strong" | "b" => {
                        out.push_str("**");
                        collect_inline(child, out);
                        out.push_str("**");
                    }
                    "em" | "i" => {
                        out.push('*');
                        collect_inline(child, out);
                        out.push('*');
                    }
                    "img" => {
                        if let Some(alt) = e.attr("alt") {
                            if !alt.trim().is_empty() {
                                out.push_str(&format!("[image: {}]", alt.trim()));
                            }
                        }
                    }
                    _ => collect_inline(child, out),
                }
            }
            _ => {}
        }
    }
}

fn render_table(node: NodeRef<'_, Node>) -> String {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for child in node.descendants() {
        if let Some(e) = child.value().as_element() {
            if e.name() == "tr" {
                let mut cells = Vec::new();
                for cell in child.children() {
                    if let Some(ce) = cell.value().as_element() {
                        if ce.name() == "td" || ce.name() == "th" {
                            let text = inline_text(cell).replace('|', "\\|");
                            cells.push(text);
                        }
                    }
                }
                if !cells.is_empty() {
                    rows.push(cells);
                }
            }
        }
    }
    if rows.is_empty() {
        return String::new();
    }
    let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if width == 0 {
        return String::new();
    }
    let mut out = String::new();
    for (i, row) in rows.iter().enumerate() {
        let mut cells = row.clone();
        cells.resize(width, String::new());
        out.push_str("| ");
        out.push_str(&cells.join(" | "));
        out.push_str(" |\n");
        if i == 0 {
            out.push_str("| ");
            out.push_str(&vec!["---"; width].join(" | "));
            out.push_str(" |\n");
        }
    }
    out.trim_end().to_string()
}

fn absolute(base: &str, href: &str) -> String {
    match url::Url::parse(base) {
        Ok(b) => b
            .join(href)
            .map(|u| u.to_string())
            .unwrap_or_else(|_| href.to_string()),
        Err(_) => href.to_string(),
    }
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(c);
        }
    }
    out
}

fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blanks = 0;
    for line in s.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blanks += 1;
            continue;
        }
        if blanks > 0 && !out.is_empty() {
            out.push('\n');
            if blanks > 1 {
                out.push('\n');
            }
        }
        blanks = 0;
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_scripts_and_nav() {
        let html = r#"<html><head><title>x</title></head><body>
        <nav><a href="/a">Home</a><a href="/b">Docs</a></nav>
        <main><h1>Title</h1><p>Hello <b>world</b>.</p>
        <pre><code class="language-rust">fn main() {}</code></pre>
        <script>var x=1;</script></main>
        <footer>foot</footer></body></html>"#;
        let e = extract(html, "https://example.com/docs", 10000, false);
        assert!(e.text.contains("# Title"));
        assert!(e.text.contains("**world**"));
        assert!(e.text.contains("```rust"));
        assert!(!e.text.contains("var x"));
        assert!(!e.text.contains("foot"));
    }

    #[test]
    fn marks_js_shell() {
        let html = r#"<html><body><div id="root"></div><script>1</script><script>2</script><script>3</script></body></html>"#;
        let e = extract(html, "https://example.com", 10000, false);
        assert!(e.needs_browser);
    }

    #[test]
    fn strips_frontmatter_and_jsx() {
        let html = "<html><body><main><p>---<br>title: useState<br>---</p><p>&lt;Intro&gt;</p><p>real body text here that is long enough to count as content for the extractor to keep around.</p></main></body></html>";
        let e = extract(html, "https://example.com/x", 10000, false);
        assert!(!e.text.contains("title: useState"), "{}", e.text);
        assert!(!e.text.contains("<Intro>"), "{}", e.text);
        assert!(e.text.contains("real body"));
    }

    #[test]
    fn extracts_title() {
        let html = r#"<html><head><title>a &amp; b</title></head><body><p>hi</p></body></html>"#;
        let e = extract(html, "https://example.com", 10000, false);
        assert_eq!(e.title, "a & b");
    }
}
