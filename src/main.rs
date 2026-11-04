mod extract;
mod fetch;
mod mcp;
mod model;
mod outline;
mod research;
mod search;

use anyhow::Result;
use clap::{Parser, Subcommand};
use fetch::{fetch_many, Fetcher};
use model::estimate_tokens;
use research::{render_doc, render_research, research as run_research};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
#[command(
    name = "quarry",
    version,
    about = "a web access layer for coding agents"
)]
struct Cli {
    #[arg(long, global = true, env = "QUARRY_CACHE")]
    cache_dir: Option<PathBuf>,
    #[arg(long, global = true, env = "QUARRY_TTL", default_value_t = 3600)]
    ttl: u64,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Fetch {
        url: String,
        #[arg(long, default_value_t = 20000)]
        max_chars: usize,
        #[arg(long)]
        links: bool,
        #[arg(long)]
        json: bool,
    },
    Outline {
        url: String,
        #[arg(long)]
        json: bool,
    },
    Section {
        url: String,
        #[arg(long)]
        anchor: String,
        #[arg(long)]
        json: bool,
    },
    Ask {
        url: String,
        #[arg(long, short = 'q')]
        query: String,
        #[arg(long, default_value_t = 3)]
        top: usize,
        #[arg(long, default_value_t = 8000)]
        max_chars: usize,
        #[arg(long)]
        json: bool,
    },
    Search {
        query: String,
        #[arg(long, default_value_t = 8)]
        limit: usize,
        #[arg(long)]
        json: bool,
    },
    Batch {
        urls: Vec<String>,
        #[arg(long, default_value_t = 12000)]
        max_chars: usize,
        #[arg(long, default_value_t = 6)]
        concurrency: usize,
        #[arg(long)]
        links: bool,
        #[arg(long)]
        json: bool,
    },
    Research {
        query: String,
        #[arg(long, short = 'k', default_value_t = 4)]
        k: usize,
        #[arg(long, default_value_t = 12000)]
        max_chars: usize,
        #[arg(long)]
        links: bool,
        #[arg(long)]
        json: bool,
    },
    Mcp,
    Cache {
        #[command(subcommand)]
        command: CacheCommand,
    },
}

#[derive(Subcommand)]
enum CacheCommand {
    Stats,
    Clear,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let fetcher = Arc::new(Fetcher::new(cli.cache_dir.clone(), Some(cli.ttl))?);
    match cli.command {
        Command::Fetch {
            url,
            max_chars,
            links,
            json,
        } => {
            let doc = fetcher.fetch(&url, max_chars, links).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&doc)?);
            } else {
                println!("{}", render_doc(&doc));
            }
        }
        Command::Outline { url, json } => {
            let doc = fetcher.fetch(&url, 1000000, false).await?;
            let heads = outline::headings(&doc.text);
            if json {
                println!("{}", serde_json::to_string_pretty(&heads)?);
            } else {
                println!("{}", outline::render_outline(&heads));
            }
        }
        Command::Section { url, anchor, json } => {
            let doc = fetcher.fetch(&url, 1000000, false).await?;
            match outline::section(&doc.text, &anchor) {
                Some(s) => {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&s)?);
                    } else {
                        println!("{}", s.body);
                    }
                }
                None => anyhow::bail!("anchor not found: {anchor}"),
            }
        }
        Command::Ask {
            url,
            query,
            top,
            max_chars,
            json,
        } => {
            let doc = fetcher.fetch(&url, 1000000, false).await?;
            let picked = outline::rank(&doc.text, &query, top, max_chars);
            if json {
                println!("{}", serde_json::to_string_pretty(&picked)?);
            } else {
                for s in picked {
                    println!("=== {} [{}] ===\n{}\n", s.text, s.anchor, s.body);
                }
            }
        }
        Command::Search { query, limit, json } => {
            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (compatible; quarry/0.1)")
                .timeout(std::time::Duration::from_secs(25))
                .build()?;
            let hits = search::search(&client, &query, limit).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&hits)?);
            } else {
                for (i, h) in hits.iter().enumerate() {
                    println!("{}. {} <{}>\n   {}", i + 1, h.title, h.url, h.snippet);
                }
                println!(
                    "\n{} results | ~{} tokens",
                    hits.len(),
                    estimate_tokens(hits.iter().map(|h| h.snippet.len()).sum())
                );
            }
        }
        Command::Batch {
            urls,
            max_chars,
            concurrency,
            links,
            json,
        } => {
            let results = fetch_many(fetcher.clone(), urls, max_chars, concurrency, links).await;
            if json {
                let mut docs = Vec::new();
                let mut errors = Vec::new();
                for r in results {
                    match r {
                        Ok(d) => docs.push(d),
                        Err(e) => errors.push(e.to_string()),
                    }
                }
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &serde_json::json!({"docs": docs, "errors": errors})
                    )?
                );
            } else {
                for r in results {
                    match r {
                        Ok(d) => println!("=== {} ===\n{}\n", d.final_url, render_doc(&d)),
                        Err(e) => println!("error: {e}\n"),
                    }
                }
            }
        }
        Command::Research {
            query,
            k,
            max_chars,
            links,
            json,
        } => {
            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (compatible; quarry/0.1)")
                .timeout(std::time::Duration::from_secs(25))
                .build()?;
            let r = run_research(fetcher.clone(), &client, &query, k, max_chars, links).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&r)?);
            } else {
                println!("{}", render_research(&r));
            }
        }
        Command::Mcp => {
            mcp::serve(fetcher).await?;
        }
        Command::Cache { command } => {
            let dir = cli.cache_dir.clone().unwrap_or_else(default_cache_dir);
            match command {
                CacheCommand::Stats => {
                    let meta = dir.join("meta");
                    let bodies = dir.join("bodies");
                    let count = std::fs::read_dir(&meta).map(|d| d.count()).unwrap_or(0);
                    let bytes: u64 = std::fs::read_dir(&bodies)
                        .map(|d| {
                            d.filter_map(|e| e.ok())
                                .filter_map(|e| e.metadata().ok())
                                .map(|m| m.len())
                                .sum()
                        })
                        .unwrap_or(0);
                    println!(
                        "{} entries | {:.1} MB | {}",
                        count,
                        bytes as f64 / 1_048_576.0,
                        dir.display()
                    );
                }
                CacheCommand::Clear => {
                    let _ = std::fs::remove_dir_all(dir.join("meta"));
                    let _ = std::fs::remove_dir_all(dir.join("bodies"));
                    std::fs::create_dir_all(dir.join("meta"))?;
                    std::fs::create_dir_all(dir.join("bodies"))?;
                    println!("cache cleared");
                }
            }
        }
    }
    Ok(())
}

fn default_cache_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        return PathBuf::from(xdg).join("quarry");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".cache").join("quarry")
}
