use crate::extract;
use crate::model::{estimate_tokens, CacheState, Doc};
use anyhow::{anyhow, bail, Result};
use reqwest::header::{
    ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED,
};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, Semaphore};

const MAX_BODY: usize = 5 * 1024 * 1024;
const DEFAULT_TTL: u64 = 3600;
const UA: &str = "Mozilla/5.0 (compatible; quarry/0.1; +https://github.com/sables-phoenix/quarry)";

#[derive(Serialize, Deserialize)]
struct Meta {
    url: String,
    final_url: String,
    status: u16,
    content_type: String,
    etag: Option<String>,
    last_modified: Option<String>,
    fetched_at: u64,
    bytes_wire: usize,
    bytes_body: usize,
}

pub struct Fetcher {
    client: Client,
    cache_dir: PathBuf,
    ttl: u64,
    gates: Mutex<HashMap<String, Arc<Semaphore>>>,
    last_seen: Mutex<HashMap<String, Instant>>,
}

impl Fetcher {
    pub fn new(cache_dir: Option<PathBuf>, ttl: Option<u64>) -> Result<Self> {
        let dir = cache_dir.unwrap_or_else(default_cache_dir);
        std::fs::create_dir_all(dir.join("bodies"))?;
        std::fs::create_dir_all(dir.join("meta"))?;
        let client = Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(16)
            .http2_adaptive_window(true)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > 10 {
                    return attempt.stop();
                }
                let host = attempt.url().host_str().unwrap_or("");
                if blocked_host(host) {
                    return attempt.error(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "redirect to a private address is blocked",
                    ));
                }
                attempt.follow()
            }))
            .build()?;
        Ok(Self {
            client,
            cache_dir: dir,
            ttl: ttl.unwrap_or(DEFAULT_TTL),
            gates: Mutex::new(HashMap::new()),
            last_seen: Mutex::new(HashMap::new()),
        })
    }

    pub async fn fetch(&self, raw_url: &str, max_chars: usize, keep_links: bool) -> Result<Doc> {
        let url = normalize_url(raw_url)?;
        ensure_public(&url).await?;
        let key = cache_key(&url);
        let meta_path = self.cache_dir.join("meta").join(format!("{key}.json"));
        let body_path = self.cache_dir.join("bodies").join(&key);
        let now = unix_now();

        let cached = read_meta(&meta_path).ok();
        let mut cache = CacheState::Miss;
        let mut conditional = Vec::new();

        if let Some(m) = &cached {
            if now.saturating_sub(m.fetched_at) < self.ttl {
                if let Ok(body) = std::fs::read(&body_path) {
                    return Ok(self.build_doc(
                        &url,
                        &m.final_url,
                        m.status,
                        &m.content_type,
                        body,
                        m.bytes_wire,
                        CacheState::Hit,
                        0,
                        max_chars,
                        keep_links,
                    ));
                }
            } else {
                if let Some(etag) = &m.etag {
                    conditional.push((IF_NONE_MATCH, etag.clone()));
                }
                if let Some(lm) = &m.last_modified {
                    conditional.push((IF_MODIFIED_SINCE, lm.clone()));
                }
            }
        }

        self.throttle(&url).await;
        let started = Instant::now();
        let mut req = self
            .client
            .get(url.clone())
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header(ACCEPT_LANGUAGE, "en-US,en;q=0.9");
        for (k, v) in &conditional {
            req = req.header(k, v);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let final_url = resp.url().to_string();

        if status == StatusCode::NOT_MODIFIED {
            if let (Some(m), Ok(body)) = (&cached, std::fs::read(&body_path)) {
                let mut m2 = Meta {
                    url: m.url.clone(),
                    final_url: m.final_url.clone(),
                    status: m.status,
                    content_type: m.content_type.clone(),
                    etag: m.etag.clone(),
                    last_modified: m.last_modified.clone(),
                    fetched_at: now,
                    bytes_wire: m.bytes_wire,
                    bytes_body: m.bytes_body,
                };
                m2.fetched_at = now;
                let _ = write_meta(&meta_path, &m2);
                return Ok(self.build_doc(
                    &url,
                    &final_url,
                    m.status,
                    &m.content_type,
                    body,
                    m.bytes_wire,
                    CacheState::Revalidated,
                    started.elapsed().as_millis(),
                    max_chars,
                    keep_links,
                ));
            }
        }

        if !status.is_success() {
            let code = status.as_u16();
            bail!("upstream returned HTTP {code} for {url}");
        }

        let headers = resp.headers().clone();
        let content_type = headers
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let etag = headers
            .get(ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let last_modified = headers
            .get(LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let bytes_wire = headers
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        let body = read_capped(resp, MAX_BODY).await?;
        let bytes_body = body.len();

        let meta = Meta {
            url: url.clone(),
            final_url: final_url.clone(),
            status: status.as_u16(),
            content_type: content_type.clone(),
            etag,
            last_modified,
            fetched_at: now,
            bytes_wire,
            bytes_body,
        };
        let _ = write_meta(&meta_path, &meta);
        let _ = write_body(&body_path, &body);

        Ok(self.build_doc(
            &url,
            &final_url,
            status.as_u16(),
            &content_type,
            body,
            bytes_wire,
            cache,
            started.elapsed().as_millis(),
            max_chars,
            keep_links,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    fn build_doc(
        &self,
        url: &str,
        final_url: &str,
        status: u16,
        content_type: &str,
        body: Vec<u8>,
        bytes_wire: usize,
        cache: CacheState,
        fetched_ms: u128,
        max_chars: usize,
        keep_links: bool,
    ) -> Doc {
        let ctype = content_type.to_ascii_lowercase();
        let looks_html = {
            let head = &body[..body.len().min(2048)];
            let probe = String::from_utf8_lossy(head).to_ascii_lowercase();
            probe.contains("<!doctype html") || probe.contains("<html") || probe.contains("<body")
        };
        let (title, text, links, needs_browser) = if ctype.contains("html")
            || ctype.is_empty()
            || (ctype.starts_with("text/") && looks_html)
        {
            let html = String::from_utf8_lossy(&body);
            let e = extract::extract(&html, final_url, max_chars, keep_links);
            (e.title, e.text, e.links, e.needs_browser)
        } else if ctype.contains("json") {
            let text = match serde_json::from_slice::<serde_json::Value>(&body) {
                Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_default(),
                Err(_) => String::from_utf8_lossy(&body).to_string(),
            };
            let text = truncate(text, max_chars);
            (String::new(), text, Vec::new(), false)
        } else if ctype.starts_with("text/")
            || ctype.contains("xml")
            || ctype.contains("javascript")
        {
            (
                String::new(),
                truncate(String::from_utf8_lossy(&body).to_string(), max_chars),
                Vec::new(),
                false,
            )
        } else {
            (
                String::new(),
                format!("[unsupported content type: {ctype}, {} bytes]", body.len()),
                Vec::new(),
                false,
            )
        };
        let truncated = text.ends_with("[truncated]");
        let chars = text.chars().count();
        Doc {
            url: url.to_string(),
            final_url: final_url.to_string(),
            title,
            chars,
            tokens_est: estimate_tokens(chars),
            text,
            content_type: content_type.to_string(),
            status,
            fetched_ms,
            bytes_wire,
            bytes_body: body.len(),
            cache,
            truncated,
            needs_browser,
            links,
        }
    }

    async fn throttle(&self, url: &str) {
        let host = url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default();
        let gate = {
            let mut gates = self.gates.lock().await;
            gates
                .entry(host.clone())
                .or_insert_with(|| Arc::new(Semaphore::new(4)))
                .clone()
        };
        let _permit = gate.acquire().await.ok();
        let wait = {
            let seen = self.last_seen.lock().await;
            seen.get(&host)
                .map(|prev| Duration::from_millis(150).saturating_sub(prev.elapsed()))
                .unwrap_or_default()
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        self.last_seen.lock().await.insert(host, Instant::now());
    }
}

fn truncate(mut text: String, max_chars: usize) -> String {
    if text.chars().count() > max_chars {
        let cut = text
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(text.len());
        text.truncate(cut);
        text.push_str("\n\n[truncated]");
    }
    text
}

async fn read_capped(resp: reqwest::Response, cap: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(64 * 1024);
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if out.len() + chunk.len() > cap {
            out.extend_from_slice(&chunk[..cap.saturating_sub(out.len())]);
            break;
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn normalize_url(raw: &str) -> Result<String> {
    let mut u = url::Url::parse(raw).map_err(|e| anyhow!("invalid url: {e}"))?;
    if u.scheme() != "http" && u.scheme() != "https" {
        bail!("only http and https are supported");
    }
    u.set_fragment(None);
    Ok(u.to_string())
}

fn allow_private() -> bool {
    matches!(
        std::env::var("QUARRY_ALLOW_PRIVATE").as_deref(),
        Ok("1") | Ok("true")
    )
}

fn blocked_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".internal") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(ip) => private_ip(ip),
        Err(_) => false,
    }
}

fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || v4.octets()[0] == 0
                || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))
                || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}

async fn ensure_public(raw: &str) -> Result<()> {
    if allow_private() {
        return Ok(());
    }
    let url = url::Url::parse(raw)?;
    let host = url.host_str().ok_or_else(|| anyhow!("url has no host"))?;
    if blocked_host(host) {
        bail!("refusing to fetch a private or loopback address: {host}");
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let mut addrs = tokio::net::lookup_host((host, port)).await?;
    if addrs.all(|a| private_ip(a.ip())) {
        bail!("refusing to fetch a host that resolves only to private addresses: {host}");
    }
    Ok(())
}

fn cache_key(url: &str) -> String {
    let mut h = Sha256::new();
    h.update(url.as_bytes());
    h.update(b"\naccent:text\n");
    hex::encode(h.finalize())
}

fn default_cache_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("QUARRY_CACHE") {
        return PathBuf::from(dir);
    }
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        return PathBuf::from(xdg).join("quarry");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".cache").join("quarry")
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_meta(path: &PathBuf) -> Result<Meta> {
    let raw = std::fs::read(path)?;
    Ok(serde_json::from_slice(&raw)?)
}

fn write_meta(path: &PathBuf, meta: &Meta) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(meta)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn write_body(path: &PathBuf, body: &[u8]) -> Result<()> {
    let tmp = path.with_extension("body.tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

pub async fn fetch_many(
    fetcher: Arc<Fetcher>,
    urls: Vec<String>,
    max_chars: usize,
    concurrency: usize,
    keep_links: bool,
) -> Vec<Result<Doc>> {
    let sem = Arc::new(Semaphore::new(concurrency.max(1)));
    let mut handles = Vec::with_capacity(urls.len());
    for url in urls {
        let f = fetcher.clone();
        let s = sem.clone();
        handles.push(tokio::spawn(async move {
            let _permit = s.acquire().await.ok();
            f.fetch(&url, max_chars, keep_links).await
        }));
    }
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        match h.await {
            Ok(r) => out.push(r),
            Err(e) => out.push(Err(anyhow!("task failed: {e}"))),
        }
    }
    out
}
