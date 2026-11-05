import { writeFileSync } from "node:fs";
import { median, quarry, round, tokens } from "./lib.js";

export const CASES = [
  ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", "how does etag revalidation work", "if-none-match"],
  ["https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html", "what happens when a value goes out of scope", "drop"],
  ["https://www.postgresql.org/docs/current/sql-select.html", "how do i limit the rows returned", "LIMIT"],
  ["https://nodejs.org/api/fs.html", "how do i read a file synchronously", "readFileSync"],
  ["https://www.typescriptlang.org/docs/handbook/2/generics.html", "constrain a type parameter", "extends"],
  ["https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api", "how do i authenticate a request", "token"],
  ["https://sqlite.org/lang_select.html", "how do i aggregate rows into groups", "GROUP BY"],
  ["https://kubernetes.io/docs/concepts/workloads/pods/", "how do i run a set of containers together", "pod"],
  ["https://docs.docker.com/engine/network/", "how do containers talk to each other by default", "bridge"],
  ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control", "how do i stop a response being stored", "no-store"],
] as const;

type Section = { anchor: string; text: string; body: string };

export async function runSelect(): Promise<void> {
  const rows: Array<Record<string, unknown>> = [];
  for (const [url, question, needle] of CASES) {
    const full = await quarry(["fetch", url, "--json", "--max-chars", "1000000"]);
    const picked = (await quarry(["ask", url, "-q", question, "--top", "3", "--json"])) as unknown as Section[];
    const text = picked.map((section) => section.body).join("\n");
    const selected = tokens(text);
    rows.push({
      url,
      question,
      full_tokens: tokens(full.text),
      selected_tokens: selected,
      ratio: round(tokens(full.text) / Math.max(selected, 1)),
      found: text.toLowerCase().includes(needle.toLowerCase()),
      sections: picked.map((section) => section.anchor),
    });
  }
  const ok = rows.filter((row) => row.ratio !== undefined);
  const summary = {
    tokenizer: "o200k_base",
    cases: rows.length,
    recall: round(ok.filter((row) => row.found).length / Math.max(ok.length, 1)),
    median_ratio: round(median(ok.map((row) => row.ratio as number))),
    total_full_tokens: ok.reduce((sum, row) => sum + (row.full_tokens as number), 0),
    total_selected_tokens: ok.reduce((sum, row) => sum + (row.selected_tokens as number), 0),
  };
  const data = { summary: { ...summary, total_ratio: round(summary.total_full_tokens / summary.total_selected_tokens) }, rows };
  writeFileSync(new URL("./select.json", import.meta.url), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data.summary, null, 2));
}

await runSelect();
