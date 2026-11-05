import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../browser/dist/session.js";
import { tokenCount } from "../../browser/dist/state.js";
import type { Step } from "../../browser/dist/types.js";

type RealFlow = { app: string; url: string; names: string[]; needle: string; baseline: number };

export const FLOWS: RealFlow[] = [
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Validation", "ETag/If-None-Match"], needle: "If-None-Match", baseline: 72004 },
  { app: "react", url: "https://react.dev/reference/react/useState", names: ["Usage", "Adding state to a component"], needle: "Adding state to a component", baseline: 61784 },
  { app: "github", url: "https://github.com/rust-lang/rust", names: ["Issues", "Pull requests"], needle: "Pull requests", baseline: 39000 },
  { app: "wikipedia", url: "https://en.wikipedia.org/wiki/HTTPS", names: ["History", "Talk"], needle: "Talk", baseline: 98356 },
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Vary", "Validation"], needle: "Validation", baseline: 70969 },
  { app: "react", url: "https://react.dev/reference/react/useState", names: ["Usage", "Updating state based on the previous state"], needle: "Updating state based on the previous state", baseline: 61891 },
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Fresh and stale based on age", "Validation"], needle: "Validation", baseline: 70957 },
  { app: "github", url: "https://github.com/rust-lang/rust", names: ["Pull requests", "Issues"], needle: "Issues", baseline: 30443 },
  { app: "wikipedia", url: "https://en.wikipedia.org/wiki/HTTPS", names: ["History", "Read"], needle: "HTTPS", baseline: 139124 },
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Types of caches", "Shared cache"], needle: "Shared cache", baseline: 70967 },
];

export async function runRealFlows(): Promise<void> {
  const session = await Effect.runPromise(Session.create());
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const flow of FLOWS) {
      const started = performance.now();
      const initial = await Effect.runPromise(session.open(flow.url));
      let payload = initial.text;
      let delta = 0;
      let ok = true;
      for (const name of flow.names) {
        const result = await Effect.runPromise(session.act([{ op: "click", role: "link", name } satisfies Step]));
        if (!result.ok) {
          ok = false;
          break;
        }
        delta += result.delta.tokens;
        payload += "\n" + result.delta.text;
      }
      ok = ok && payload.toLowerCase().includes(flow.needle.toLowerCase());
      const tokens = initial.tokens + delta;
      rows.push({
        app: flow.app,
        flow: flow.names.join(" > "),
        state_tokens: initial.tokens,
        delta_tokens: delta,
        ssg_tokens: tokens,
        baseline_tokens: flow.baseline,
        ratio: Number((flow.baseline / Math.max(tokens, 1)).toFixed(1)),
        ok,
        ms: Math.round(performance.now() - started),
      });
    }
  } finally {
    await Effect.runPromise(session.close());
  }
  const ok = rows.filter((row) => row.ok);
  const ratios = ok.map((row) => row.ratio as number).sort((a, b) => a - b);
  const summary = {
    flows: rows.length,
    ok: ok.length,
    median_ratio: ratios[Math.floor(ratios.length / 2)] ?? 0,
    min_ratio: Math.min(...ratios),
    max_ratio: Math.max(...ratios),
    baseline_total: rows.reduce((sum, row) => sum + (row.baseline_tokens as number), 0),
    ssg_total: rows.reduce((sum, row) => sum + (row.ssg_tokens as number), 0),
  };
  const data = { summary: { ...summary, total_ratio: Number((summary.baseline_total / summary.ssg_total).toFixed(1)) }, rows };
  writeFileSync(new URL("./real-flows.json", import.meta.url), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data.summary, null, 2));
}

await runRealFlows();
