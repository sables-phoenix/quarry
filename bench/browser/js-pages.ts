import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../browser/dist/session.js";
import { tokenCount } from "../../browser/dist/state.js";

const URLS = ["https://excalidraw.com/", "https://linear.app/", "https://www.notion.so/product"];

export async function runJsPages(): Promise<void> {
  const session = await Effect.runPromise(Session.create());
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const url of URLS) {
      const raw = execFileSync("target/release/quarry", ["fetch", url, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const doc = JSON.parse(raw) as { chars: number; tokens_est: number; needs_browser: boolean; text: string };
      const exact = tokenCount(doc.text);
      const state = await Effect.runPromise(session.open(url));
      rows.push({
        url,
        text_chars: doc.chars,
        text_tokens: exact,
        needs_browser: doc.needs_browser,
        text_usable: doc.chars >= 500 && !doc.needs_browser,
        state_tokens: state.tokens,
      });
    }
  } finally {
    await Effect.runPromise(session.close());
  }
  const usable = rows.filter((row) => row.text_usable);
  const summary = {
    pages: rows.length,
    text_unusable: rows.length - usable.length,
    state_total: rows.reduce((sum, row) => sum + (row.state_tokens as number), 0),
    text_total: rows.reduce((sum, row) => sum + (row.text_tokens as number), 0),
  };
  writeFileSync(new URL("./js-pages.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify({ summary, rows }, null, 2));
}

await runJsPages();
