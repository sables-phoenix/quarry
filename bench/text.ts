import { writeFileSync } from "node:fs";
import { fetchBaseline, median, quarry, round, tokens, withCache } from "./lib.js";

export const CORPUS = [
  "https://docs.rs/serde/latest/serde/",
  "https://react.dev/reference/react/useState",
  "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
  "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
  "https://nextjs.org/docs/app/building-your-application/routing",
  "https://nodejs.org/api/fs.html",
  "https://www.postgresql.org/docs/current/sql-select.html",
  "https://kubernetes.io/docs/concepts/overview/",
  "https://go.dev/doc/effective_go",
  "https://docs.python.org/3/library/asyncio.html",
  "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
  "https://www.rust-lang.org/",
  "https://en.wikipedia.org/wiki/HTTPS",
  "https://www.rfc-editor.org/rfc/rfc9110.html",
  "https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api",
  "https://web.dev/articles/rendering-performance",
  "https://docs.docker.com/engine/network/",
  "https://grafana.com/docs/grafana/latest/datasources/prometheus/",
  "https://sqlite.org/lang_select.html",
  "https://www.typescriptlang.org/docs/handbook/2/generics.html",
];

export async function runText(): Promise<void> {
  const rows = await withCache(async (cache) => {
    const out: Array<Record<string, unknown>> = [];
    for (const url of CORPUS) {
      const row: Record<string, unknown> = { url };
      try {
        row.baseline = await fetchBaseline(url);
      } catch (error) {
        row.baseline = { error: String(error).slice(0, 160) };
      }
      try {
        const c0 = performance.now();
        const cold = await quarry(["fetch", url, "--json", "--max-chars", "1000000"], cache);
        const coldMs = performance.now() - c0;
        const w0 = performance.now();
        const warm = await quarry(["fetch", url, "--json", "--max-chars", "1000000"], cache);
        const warmMs = performance.now() - w0;
        row.quarry_cold = { tokens: tokens(cold.text), chars: cold.chars, bytes: cold.bytes_body, ms: Math.round(coldMs), cache: cold.cache, truncated: cold.truncated };
        row.quarry_warm = { tokens: tokens(warm.text), ms: Math.round(warmMs), cache: warm.cache };
      } catch (error) {
        row.quarry_cold = { error: String(error).slice(0, 160) };
      }
      const baseline = row.baseline as { textTokens?: number; htmlTokens?: number; bytes?: number };
      const cold = row.quarry_cold as { tokens?: number; ms?: number; bytes?: number };
      if (baseline.textTokens && cold.tokens) {
        row.text_ratio = round(baseline.textTokens / cold.tokens);
        row.html_ratio = round(baseline.htmlTokens! / cold.tokens);
        row.bytes_ratio = round(baseline.bytes! / cold.bytes!);
      }
      out.push(row);
      console.log(JSON.stringify(row).slice(0, 320));
    }
    return out;
  });

  const ok = rows.filter((row) => row.text_ratio !== undefined);
  const summary = {
    tokenizer: "o200k_base",
    pages: rows.length,
    ok: ok.length,
    median_text_ratio: round(median(ok.map((row) => row.text_ratio as number))),
    median_html_ratio: round(median(ok.map((row) => row.html_ratio as number))),
    median_bytes_ratio: round(median(ok.map((row) => row.bytes_ratio as number))),
    total_baseline_tokens: ok.reduce((sum, row) => sum + (row.baseline as { textTokens: number }).textTokens, 0),
    total_quarry_tokens: ok.reduce((sum, row) => sum + (row.quarry_cold as { tokens: number }).tokens, 0),
    cold_ms_p50: round(median(rows.filter((row) => (row.quarry_cold as { ms?: number }).ms !== undefined).map((row) => (row.quarry_cold as { ms: number }).ms)), 1),
    warm_ms_p50: round(median(rows.filter((row) => (row.quarry_warm as { ms?: number }).ms !== undefined).map((row) => (row.quarry_warm as { ms: number }).ms)), 1),
  };
  const data = { summary: { ...summary, total_ratio: round(summary.total_baseline_tokens / summary.total_quarry_tokens) }, rows };
  writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data.summary, null, 2));
}

await runText();
