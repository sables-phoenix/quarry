import { Effect } from "effect";
import { Session } from "../dist/session.js";
import { writeFileSync } from "node:fs";

const FLOWS = [
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Validation", "ETag/If-None-Match"], needle: "If-None-Match", baseline: 57625 },
  { app: "react", url: "https://react.dev/reference/react/useState", names: ["Usage", "Adding state to a component"], needle: "Adding state to a component", baseline: 49001 },
  { app: "github", url: "https://github.com/rust-lang/rust", names: ["Issues", "Pull requests"], needle: "Pull requests", baseline: 39050 },
  { app: "wikipedia", url: "https://en.wikipedia.org/wiki/HTTPS", names: ["History", "Talk"], needle: "Talk", baseline: 79964 },
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Vary", "Validation"], needle: "Validation", baseline: 57625 },
  { app: "react", url: "https://react.dev/reference/react/useState", names: ["Usage", "Updating state based on the previous state"], needle: "Updating state based on the previous state", baseline: 47904 },
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Fresh and stale based on age", "Validation"], needle: "Validation", baseline: 58807 },
  { app: "github", url: "https://github.com/rust-lang/rust", names: ["Pull requests", "Issues"], needle: "Issues", baseline: 39374 },
  { app: "wikipedia", url: "https://en.wikipedia.org/wiki/HTTPS", names: ["History", "Read"], needle: "HTTPS", baseline: 111729 },
  { app: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", names: ["Types of caches", "Shared cache"], needle: "Shared cache", baseline: 58788 },
];

const session = await Effect.runPromise(Session.create());
const rows = [];
try {
  for (const flow of FLOWS) {
    const started = performance.now();
    const initial = await Effect.runPromise(session.open(flow.url));
    let delta = 0;
    let ok = true;
    for (const name of flow.names) {
      const result = await Effect.runPromise(session.act([{ op: "click", role: "link", name }]));
      if (!result.ok) {
        ok = false;
        break;
      }
      delta += result.delta.tokens;
    }
    const text = await Effect.runPromise(session.browser.assert([{ op: "text", value: flow.needle }]));
    ok = ok && text.every((assertion) => assertion.ok);
    const tokens = initial.tokens + delta + 10;
    rows.push({
      app: flow.app,
      flow: flow.names.join(" > "),
      state_tokens: initial.tokens,
      delta_tokens: delta,
      ssg_tokens: tokens,
      baseline_tokens: flow.baseline,
      ratio: Number((flow.baseline / Math.max(tokens, 1)).toFixed(1)),
      model_calls: 2,
      ok,
      ms: Math.round(performance.now() - started),
    });
  }
} finally {
  await Effect.runPromise(session.close());
}

const ok = rows.filter((row) => row.ok);
const summary = {
  flows: rows.length,
  ok: ok.length,
  median_ratio: Number([...ok].map((row) => row.ratio).sort((a, b) => a - b)[Math.floor(ok.length / 2)].toFixed(1)),
  min_ratio: Math.min(...ok.map((row) => row.ratio)),
  max_ratio: Math.max(...ok.map((row) => row.ratio)),
  baseline_total: rows.reduce((sum, row) => sum + row.baseline_tokens, 0),
  ssg_total: rows.reduce((sum, row) => sum + row.ssg_tokens, 0),
  baseline_calls: rows.length * 3,
  ssg_calls: rows.reduce((sum, row) => sum + row.model_calls, 0),
  replay_calls: 0,
  median_ms: Number([...rows].map((row) => row.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)].toFixed(0)),
};
summary.total_ratio = Number((summary.baseline_total / summary.ssg_total).toFixed(1));

writeFileSync(new URL("./real-flows.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify({ summary, rows }, null, 2));
