import { writeFileSync } from "node:fs";
import { median, quarry, round, tokens } from "./lib.js";

const URLS = [
  "https://docs.rs/serde/latest/serde/",
  "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
  "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
  "https://nodejs.org/api/fs.html",
  "https://www.typescriptlang.org/docs/handbook/2/generics.html",
  "https://sqlite.org/lang_select.html",
];

export async function runExternal(): Promise<void> {
  const rows: Array<Record<string, unknown>> = [];
  for (const url of URLS) {
    const row: Record<string, unknown> = { url };
    try {
      const started = performance.now();
      const response = await fetch("https://r.jina.ai/" + url, { headers: { "user-agent": "quarry-bench/0.1" } });
      const body = await response.text();
      row.jina = { status: response.status, tokens: tokens(body), ms: Math.round(performance.now() - started) };
    } catch (error) {
      row.jina = { error: String(error).slice(0, 160) };
    }
    try {
      const doc = await quarry(["fetch", url, "--json", "--max-chars", "1000000"]);
      row.quarry = { tokens: tokens(doc.text), ms: doc.fetched_ms };
    } catch (error) {
      row.quarry = { error: String(error).slice(0, 160) };
    }
    const jina = row.jina as { tokens?: number; ms?: number };
    const local = row.quarry as { tokens?: number; ms?: number };
    if (jina.tokens && local.tokens) {
      row.token_ratio = round(jina.tokens / local.tokens);
      row.ms_ratio = round(jina.ms! / Math.max(local.ms!, 1));
    }
    rows.push(row);
  }
  const ok = rows.filter((row) => row.token_ratio !== undefined);
  const summary = {
    tokenizer: "o200k_base",
    urls: rows.length,
    ok: ok.length,
    median_token_ratio: round(median(ok.map((row) => row.token_ratio as number))),
    median_ms_ratio: round(median(ok.map((row) => row.ms_ratio as number))),
    quarry_tokens: ok.reduce((sum, row) => sum + (row.quarry as { tokens: number }).tokens, 0),
    jina_tokens: ok.reduce((sum, row) => sum + (row.jina as { tokens: number }).tokens, 0),
  };
  writeFileSync(new URL("./external.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await runExternal();
