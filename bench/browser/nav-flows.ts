import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../browser/dist/session.js";

const FLOWS = [
  { app: "github", url: "https://github.com/rust-lang/rust", name: "Issues", expect: "/issues", needle: "Issues" },
  { app: "github", url: "https://github.com/rust-lang/rust", name: "Pull requests", expect: "/pulls", needle: "Pull requests" },
  { app: "wikipedia", url: "https://en.wikipedia.org/wiki/HTTPS", name: "Talk", expect: "Talk:HTTPS", needle: "Find sources" },
  { app: "react", url: "https://react.dev/reference/react/useState", name: "useEffect", expect: "useEffect", needle: "useEffect" },
] as const;

export async function runNavFlows(): Promise<void> {
  const session = await Effect.runPromise(Session.create());
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const flow of FLOWS) {
      const started = performance.now();
      const initial = await Effect.runPromise(session.open(flow.url));
      const result = await Effect.runPromise(session.act([{ op: "click", role: "link", name: flow.name }, { op: "wait", ms: 2500 }]));
      const final = session.state;
      const url = final?.url ?? initial.url;
      const text = final?.text ?? "";
      const ok = result.ok && url.includes(flow.expect) && text.toLowerCase().includes(flow.needle.toLowerCase());
      rows.push({ app: flow.app, from: flow.url, click: flow.name, url, tokens: final?.tokens ?? 0, ok, ms: Math.round(performance.now() - started) });
    }
  } finally {
    await Effect.runPromise(session.close());
  }
  const summary = { flows: rows.length, ok: rows.filter((row) => row.ok).length };
  writeFileSync(new URL("./nav-flows.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify({ summary, rows }, null, 2));
}

await runNavFlows();
