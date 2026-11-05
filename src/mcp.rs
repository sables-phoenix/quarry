use crate::fetch::{fetch_many, Fetcher};
use crate::model::estimate_tokens;
use crate::outline;
use crate::research::{render_doc, render_research, research};
use crate::search;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub async fn serve(fetcher: Arc<Fetcher>) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; quarry/0.1)")
        .timeout(std::time::Duration::from_secs(25))
        .build()?;
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();
    while let Some(line) = reader.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                let err = json!({"jsonrpc":"2.0","id":Value::Null,"error":{"code":-32700,"message":format!("parse error: {e}")}});
                stdout.write_all(format!("{err}\n").as_bytes()).await?;
                stdout.flush().await?;
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        if id.is_null() && method.starts_with("notifications/") {
            continue;
        }
        let response = match method {
            "initialize" => ok(
                id,
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "quarry", "version": env!("CARGO_PKG_VERSION")}
                }),
            ),
            "ping" => ok(id, json!({})),
            "tools/list" => ok(id, json!({"tools": tools()})),
            "tools/call" => {
                let params = req.get("params").cloned().unwrap_or(json!({}));
                match call(&fetcher, &client, params).await {
                    Ok(v) => ok(id, v),
                    Err(e) => ok(
                        id,
                        json!({
                            "content": [{"type": "text", "text": format!("error: {e}")}],
                            "isError": true
                        }),
                    ),
                }
            }
            _ => {
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("unknown method: {method}")}})
            }
        };
        stdout.write_all(format!("{response}\n").as_bytes()).await?;
        stdout.flush().await?;
    }
    Ok(())
}

fn ok(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn tools() -> Vec<Value> {
    vec![
        json!({
            "name": "web_search",
            "description": "Search the web. Returns ranked results with title, url, and snippet.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8}
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "web_fetch",
            "description": "Fetch one URL and return clean markdown text with a token estimate. Cached across calls.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "max_chars": {"type": "integer", "minimum": 500, "maximum": 200000, "default": 20000},
                    "links": {"type": "boolean", "default": false}
                },
                "required": ["url"]
            }
        }),
        json!({
            "name": "web_batch",
            "description": "Fetch many URLs in parallel and return clean text for each. Cached across calls.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "urls": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
                    "max_chars": {"type": "integer", "minimum": 500, "maximum": 100000, "default": 12000},
                    "concurrency": {"type": "integer", "minimum": 1, "maximum": 12, "default": 6},
                    "links": {"type": "boolean", "default": false}
                },
                "required": ["urls"]
            }
        }),
        json!({
            "name": "web_outline",
            "description": "Return the heading outline of a page with anchors and token estimates. Use before fetching a large doc.",
            "inputSchema": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"]
            }
        }),
        json!({
            "name": "web_section",
            "description": "Return one section of a page by its outline anchor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "anchor": {"type": "string"}
                },
                "required": ["url", "anchor"]
            }
        }),
        json!({
            "name": "web_ask",
            "description": "Fetch one page and return only the sections that match a question, with anchors and token counts. Use for a large doc.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "query": {"type": "string"},
                    "top": {"type": "integer", "minimum": 1, "maximum": 8, "default": 3},
                    "max_chars": {"type": "integer", "minimum": 500, "maximum": 60000, "default": 8000}
                },
                "required": ["url", "query"]
            }
        }),
        json!({
            "name": "web_research",
            "description": "Search, fetch, and return only the top matching sections from each result. Compact cited corpus.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "k": {"type": "integer", "minimum": 1, "maximum": 8, "default": 4},
                    "max_chars": {"type": "integer", "minimum": 500, "maximum": 100000, "default": 12000}
                },
                "required": ["query"]
            }
        }),
    ]
}

async fn call(fetcher: &Arc<Fetcher>, client: &reqwest::Client, params: Value) -> Result<Value> {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or(json!({}));
    match name {
        "web_search" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("query is required"))?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
            let hits = search::search(client, query, limit).await?;
            let mut text = String::new();
            for (i, h) in hits.iter().enumerate() {
                text.push_str(&format!(
                    "{}. {} <{}>\n   {}\n",
                    i + 1,
                    h.title,
                    h.url,
                    h.snippet
                ));
            }
            let tokens = estimate_tokens(text.chars().count());
            Ok(json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": {"results": hits, "tokens_est": tokens}
            }))
        }
        "web_fetch" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("url is required"))?;
            let max_chars = args
                .get("max_chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(20000) as usize;
            let keep_links = args.get("links").and_then(|v| v.as_bool()).unwrap_or(false);
            let doc = fetcher.fetch(url, max_chars, keep_links).await?;
            let text = render_doc(&doc);
            Ok(json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": doc
            }))
        }
        "web_batch" => {
            let urls: Vec<String> = args
                .get("urls")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .ok_or_else(|| anyhow!("urls is required"))?;
            let max_chars = args
                .get("max_chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(12000) as usize;
            let concurrency = args
                .get("concurrency")
                .and_then(|v| v.as_u64())
                .unwrap_or(6) as usize;
            let keep_links = args.get("links").and_then(|v| v.as_bool()).unwrap_or(false);
            let results =
                fetch_many(fetcher.clone(), urls, max_chars, concurrency, keep_links).await;
            let mut text = String::new();
            let mut docs = Vec::new();
            let mut errors = Vec::new();
            for r in results {
                match r {
                    Ok(d) => {
                        text.push_str(&format!("=== {} ===\n", d.final_url));
                        text.push_str(&d.text);
                        text.push_str("\n\n");
                        docs.push(d);
                    }
                    Err(e) => {
                        text.push_str(&format!("error: {e}\n\n"));
                        errors.push(e.to_string());
                    }
                }
            }
            let tokens = estimate_tokens(text.chars().count());
            Ok(json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": {"docs": docs, "errors": errors, "tokens_est": tokens}
            }))
        }
        "web_ask" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("url is required"))?;
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("query is required"))?;
            let top = args.get("top").and_then(|v| v.as_u64()).unwrap_or(3) as usize;
            let max_chars = args
                .get("max_chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(8000) as usize;
            let doc = fetcher.fetch(url, 1000000, false).await?;
            let picked = outline::rank(&doc.text, query, top, max_chars);
            let mut text = String::new();
            for s in &picked {
                text.push_str(&format!(
                    "=== {} [{}] ===\n{}\n\n",
                    s.text, s.anchor, s.body
                ));
            }
            Ok(json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": {"url": doc.final_url, "title": doc.title, "sections": picked}
            }))
        }
        "web_research" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("query is required"))?;
            let k = args.get("k").and_then(|v| v.as_u64()).unwrap_or(4) as usize;
            let max_chars = args
                .get("max_chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(12000) as usize;
            let keep_links = args.get("links").and_then(|v| v.as_bool()).unwrap_or(false);
            let r = research(fetcher.clone(), client, query, k, max_chars, keep_links).await?;
            let text = render_research(&r);
            Ok(json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": r
            }))
        }
        "web_outline" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("url is required"))?;
            let doc = fetcher.fetch(url, 1000000, false).await?;
            let heads = outline::headings(&doc.text);
            let text = outline::render_outline(&heads);
            Ok(json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": {"url": doc.final_url, "title": doc.title, "headings": heads}
            }))
        }
        "web_section" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("url is required"))?;
            let anchor = args
                .get("anchor")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("anchor is required"))?;
            let doc = fetcher.fetch(url, 1000000, false).await?;
            match outline::section(&doc.text, anchor) {
                Some(s) => Ok(json!({
                    "content": [{"type": "text", "text": s.body}],
                    "structuredContent": s
                })),
                None => Err(anyhow!("anchor not found: {anchor}")),
            }
        }
        _ => Err(anyhow!("unknown tool: {name}")),
    }
}
