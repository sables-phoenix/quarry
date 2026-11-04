use crate::model::SearchHit;
use anyhow::{anyhow, bail, Result};
use scraper::{Html, Selector};

pub async fn search(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let keywords = crate::outline::keywords(query);
    let query = if keywords.is_empty() {
        query
    } else {
        keywords.as_str()
    };
    if let Ok(key) = std::env::var("BRAVE_API_KEY") {
        return brave(client, query, limit, &key).await;
    }
    if let Ok(key) = std::env::var("EXA_API_KEY") {
        return exa(client, query, limit, &key).await;
    }
    if let Ok(key) = std::env::var("TAVILY_API_KEY") {
        return tavily(client, query, limit, &key).await;
    }
    duckduckgo(client, query, limit).await
}

async fn brave(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    key: &str,
) -> Result<Vec<SearchHit>> {
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .header("X-Subscription-Token", key)
        .header("Accept", "application/json")
        .query(&[("q", query), ("count", &limit.to_string())])
        .send()
        .await?;
    if !resp.status().is_success() {
        bail!("brave returned {}", resp.status());
    }
    let v: serde_json::Value = resp.json().await?;
    let mut out = Vec::new();
    if let Some(items) = v.pointer("/web/results").and_then(|x| x.as_array()) {
        for item in items.iter().take(limit) {
            out.push(SearchHit {
                title: item
                    .get("title")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                url: item
                    .get("url")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                snippet: item
                    .get("description")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                source: "brave".into(),
            });
        }
    }
    Ok(out)
}

async fn exa(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    key: &str,
) -> Result<Vec<SearchHit>> {
    let resp = client
        .post("https://api.exa.ai/search")
        .header("x-api-key", key)
        .json(&serde_json::json!({"query": query, "numResults": limit, "contents": {"text": {"maxCharacters": 600}}}))
        .send()
        .await?;
    if !resp.status().is_success() {
        bail!("exa returned {}", resp.status());
    }
    let v: serde_json::Value = resp.json().await?;
    let mut out = Vec::new();
    if let Some(items) = v.get("results").and_then(|x| x.as_array()) {
        for item in items.iter().take(limit) {
            out.push(SearchHit {
                title: item
                    .get("title")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                url: item
                    .get("url")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                snippet: item
                    .get("text")
                    .or_else(|| item.get("summary"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .chars()
                    .take(600)
                    .collect(),
                source: "exa".into(),
            });
        }
    }
    Ok(out)
}

async fn tavily(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    key: &str,
) -> Result<Vec<SearchHit>> {
    let resp = client
        .post("https://api.tavily.com/search")
        .json(&serde_json::json!({"api_key": key, "query": query, "max_results": limit}))
        .send()
        .await?;
    if !resp.status().is_success() {
        bail!("tavily returned {}", resp.status());
    }
    let v: serde_json::Value = resp.json().await?;
    let mut out = Vec::new();
    if let Some(items) = v.get("results").and_then(|x| x.as_array()) {
        for item in items.iter().take(limit) {
            out.push(SearchHit {
                title: item
                    .get("title")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                url: item
                    .get("url")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                snippet: item
                    .get("content")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                source: "tavily".into(),
            });
        }
    }
    Ok(out)
}

async fn duckduckgo(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    if let Ok(hits) = ddg_lite(client, query, limit).await {
        if !hits.is_empty() {
            return Ok(hits);
        }
    }
    if let Ok(hits) = ddg_html(client, query, limit).await {
        if !hits.is_empty() {
            return Ok(hits);
        }
    }
    bing(client, query, limit).await
}

async fn bing(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let resp = client
        .get("https://www.bing.com/search")
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .query(&[("q", query), ("setlang", "en")])
        .send()
        .await?;
    if !resp.status().is_success() {
        bail!("bing returned {}", resp.status());
    }
    let html = resp.text().await?;
    let doc = Html::parse_document(&html);
    let item_sel = Selector::parse("li.b_algo").unwrap();
    let link_sel = Selector::parse("h2 a").unwrap();
    let snip_sel = Selector::parse("p").unwrap();
    let mut out = Vec::new();
    for item in doc.select(&item_sel).take(limit) {
        let Some(a) = item.select(&link_sel).next() else {
            continue;
        };
        let title = a.text().collect::<Vec<_>>().join(" ").trim().to_string();
        let href = a.value().attr("href").unwrap_or("");
        let Some(href) = decode_bing(href) else {
            continue;
        };
        let snippet = item
            .select(&snip_sel)
            .next()
            .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_default();
        out.push(SearchHit {
            title,
            url: href,
            snippet,
            source: "bing".into(),
        });
    }
    if out.is_empty() {
        bail!("no search provider returned results");
    }
    Ok(out)
}

async fn ddg_lite(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let resp = client
        .post("https://lite.duckduckgo.com/lite/")
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Origin", "https://lite.duckduckgo.com")
        .header("Referer", "https://lite.duckduckgo.com/")
        .form(&[("q", query), ("kl", "us-en")])
        .send()
        .await?;
    if !resp.status().is_success() {
        bail!("duckduckgo lite returned {}", resp.status());
    }
    let html = resp.text().await?;
    if std::env::var("QUARRY_DEBUG").is_ok() {
        eprintln!(
            "ddg lite html {} bytes, result-link={}",
            html.len(),
            html.matches("result-link").count()
        );
    }
    let doc = Html::parse_document(&html);
    let link_sel = Selector::parse("a.result-link").unwrap();
    let snip_sel = Selector::parse("td.result-snippet").unwrap();
    let snips: Vec<String> = doc
        .select(&snip_sel)
        .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .collect();
    let mut out = Vec::new();
    for (i, a) in doc.select(&link_sel).take(limit).enumerate() {
        let title = a.text().collect::<Vec<_>>().join(" ").trim().to_string();
        let href = a.value().attr("href").unwrap_or("");
        if !href.starts_with("http") {
            continue;
        }
        out.push(SearchHit {
            title,
            url: href.to_string(),
            snippet: snips.get(i).cloned().unwrap_or_default(),
            source: "duckduckgo".into(),
        });
    }
    Ok(out)
}

async fn ddg_html(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let resp = client
        .post("https://html.duckduckgo.com/html/")
        .header("Accept", "text/html")
        .form(&[("q", query), ("kl", "us-en")])
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(anyhow!("duckduckgo returned {}", resp.status()));
    }
    let html = resp.text().await?;
    let doc = Html::parse_document(&html);
    let link_sel = Selector::parse("a.result__a").unwrap();
    let snippet_sel = Selector::parse(".result__snippet").unwrap();
    let mut snippets = doc.select(&snippet_sel);
    let mut out = Vec::new();
    for a in doc.select(&link_sel).take(limit) {
        let title = a.text().collect::<Vec<_>>().join(" ").trim().to_string();
        let href = a.value().attr("href").unwrap_or("");
        let snippet = snippets
            .next()
            .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_default();
        if let Some(url) = decode_ddg(href) {
            out.push(SearchHit {
                title,
                url,
                snippet,
                source: "duckduckgo".into(),
            });
        }
    }
    if out.is_empty() {
        bail!("duckduckgo returned no parseable results");
    }
    Ok(out)
}

fn decode_ddg(href: &str) -> Option<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(href.to_string());
    }
    let u = url::Url::parse(&format!("https://duckduckgo.com{href}")).ok()?;
    u.query_pairs()
        .find(|(k, _)| k == "uddg")
        .map(|(_, v)| v.to_string())
        .or_else(|| {
            u.query_pairs()
                .find(|(k, _)| k == "rut")
                .map(|(_, v)| v.to_string())
        })
}

fn decode_bing(href: &str) -> Option<String> {
    if href.starts_with("https://www.bing.com/ck/a") {
        let u = url::Url::parse(href).ok()?;
        let raw = u
            .query_pairs()
            .find(|(k, _)| k == "u")
            .map(|(_, v)| v.to_string())?;
        let raw = raw.strip_prefix("a1").unwrap_or(&raw);
        let decoded = base64url(raw)?;
        if decoded.starts_with("http") {
            return Some(decoded);
        }
        return None;
    }
    if href.starts_with("http") {
        return Some(href.to_string());
    }
    None
}

fn base64url(input: &str) -> Option<String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut lookup = [255u8; 256];
    for (i, b) in TABLE.iter().enumerate() {
        lookup[*b as usize] = i as u8;
    }
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u8;
    for c in input.bytes() {
        if c == b'=' {
            break;
        }
        let v = lookup[c as usize];
        if v == 255 {
            return None;
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    String::from_utf8(out).ok()
}
