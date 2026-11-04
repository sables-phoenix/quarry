use crate::fetch::{fetch_many, Fetcher};
use crate::model::{estimate_tokens, Research, Selected};
use crate::{outline, search};
use anyhow::Result;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

pub async fn research(
    fetcher: Arc<Fetcher>,
    client: &reqwest::Client,
    query: &str,
    k: usize,
    max_chars: usize,
    keep_links: bool,
) -> Result<Research> {
    let started = Instant::now();
    let hits = search::search(client, query, (k * 2).max(8)).await?;
    let mut seen = HashSet::new();
    let mut urls = Vec::new();
    for hit in &hits {
        let key = hit.url.split('#').next().unwrap_or(&hit.url).to_string();
        if seen.insert(key.clone()) {
            urls.push(key);
        }
        if urls.len() >= k {
            break;
        }
    }
    let results = fetch_many(fetcher, urls, max_chars * 4, 6, keep_links).await;
    let docs_fetched = results.iter().filter(|r| r.is_ok()).count();
    let mut sections: Vec<Selected> = Vec::new();
    let mut bodies = HashSet::new();
    let mut total = 0usize;
    for r in results.into_iter().flatten() {
        if r.chars < 200 {
            continue;
        }
        let ranked = outline::rank(&r.text, query, 2, max_chars);
        for s in ranked {
            if total + s.chars > max_chars && !sections.is_empty() {
                continue;
            }
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            use std::hash::{Hash, Hasher};
            s.body
                .chars()
                .take(400)
                .collect::<String>()
                .hash(&mut hasher);
            if !bodies.insert(hasher.finish()) {
                continue;
            }
            total += s.chars;
            sections.push(Selected {
                url: r.final_url.clone(),
                page_title: r.title.clone(),
                anchor: s.anchor,
                heading: s.text,
                text: s.body,
                chars: s.chars,
                tokens_est: s.tokens_est,
            });
        }
    }
    Ok(Research {
        query: query.to_string(),
        hits,
        sections,
        docs_fetched,
        chars: total,
        tokens_est: estimate_tokens(total),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

pub fn render_doc(doc: &crate::model::Doc) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "url: {}\ntitle: {}\nstatus: {} | cache: {:?} | tokens: ~{} | chars: {} | bytes: {} | {}ms\n",
        doc.final_url, doc.title, doc.status, doc.cache, doc.tokens_est, doc.chars, doc.bytes_body, doc.fetched_ms
    ));
    if doc.needs_browser {
        out.push_str("warning: page looks like a javascript shell, extraction may be empty\n");
    }
    out.push('\n');
    out.push_str(&doc.text);
    out
}

pub fn render_research(r: &Research) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "query: {}\nresults: {} | docs: {} | sections: {} | tokens: ~{} | {}ms\n\n",
        r.query,
        r.hits.len(),
        r.docs_fetched,
        r.sections.len(),
        r.tokens_est,
        r.elapsed_ms
    ));
    for (i, hit) in r.hits.iter().enumerate() {
        out.push_str(&format!(
            "[{}] {} <{}>\n    {}\n",
            i + 1,
            hit.title,
            hit.url,
            hit.snippet
        ));
    }
    out.push('\n');
    for s in &r.sections {
        out.push_str(&format!(
            "=== {} :: {} [{}] ===\n",
            s.url, s.heading, s.anchor
        ));
        out.push_str(&s.text);
        out.push_str("\n\n");
    }
    out
}
