use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Doc {
    pub url: String,
    pub final_url: String,
    pub title: String,
    pub text: String,
    pub chars: usize,
    pub tokens_est: usize,
    pub content_type: String,
    pub status: u16,
    pub fetched_ms: u128,
    pub bytes_wire: usize,
    pub bytes_body: usize,
    pub cache: CacheState,
    pub truncated: bool,
    pub needs_browser: bool,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheState {
    Miss,
    Hit,
    Revalidated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub url: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selected {
    pub url: String,
    pub page_title: String,
    pub anchor: String,
    pub heading: String,
    pub text: String,
    pub chars: usize,
    pub tokens_est: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Research {
    pub query: String,
    pub hits: Vec<SearchHit>,
    pub sections: Vec<Selected>,
    pub docs_fetched: usize,
    pub chars: usize,
    pub tokens_est: usize,
    pub elapsed_ms: u128,
}

pub fn estimate_tokens(chars: usize) -> usize {
    chars.div_ceil(4)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heading {
    pub level: usize,
    pub text: String,
    pub anchor: String,
    pub line: usize,
    pub chars: usize,
    pub tokens_est: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub anchor: String,
    pub level: usize,
    pub text: String,
    pub body: String,
    pub chars: usize,
    pub tokens_est: usize,
}
