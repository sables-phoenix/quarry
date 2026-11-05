import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../browser/dist/session.js";
import { FLOWS } from "../../browser/dist/flows.js";
import { tokenCount } from "../../browser/dist/state.js";
import { serveFixtures } from "../../browser/dist/server.js";
import type { Step } from "../../browser/dist/types.js";

export async function runFixtures(): Promise<void> {
  const server = await serveFixtures(new URL("../../browser/fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const session = await Effect.runPromise(Session.create());
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const flow of FLOWS) {
      const started = performance.now();
      const initial = await Effect.runPromise(session.open(base + flow.path));
      let delta = 0;
      let ok = true;
      for (const step of flow.steps) {
        const result = await Effect.runPromise(session.act([step as Step]));
        if (!result.ok) {
          ok = false;
          break;
        }
        delta += result.delta.tokens;
      }
      const assertions = await Effect.runPromise(session.browser.assert(flow.asserts));
      const assertTokens = tokenCount(JSON.stringify(assertions));
      ok = ok && assertions.every((assertion) => assertion.ok);
      const firstTokens = initial.tokens + delta + assertTokens;
      const replay = await Effect.runPromise(session.replay({ url: base + flow.path, steps: flow.steps, asserts: flow.asserts }));
      rows.push({
        flow: flow.name,
        steps: flow.steps.length,
        first_tokens: firstTokens,
        replay_tokens: replay.tokens,
        screenshot_tokens: 1366 * (flow.steps.length + 1),
        first_ok: ok,
        replay_ok: replay.ok,
        ms: Math.round(performance.now() - started),
      });
    }
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
  const ok = rows.filter((row) => row.first_ok && row.replay_ok);
  const first = rows.map((row) => row.first_tokens as number).sort((a, b) => a - b);
  const summary = {
    flows: rows.length,
    ok: ok.length,
    first_total: first.reduce((a, b) => a + b, 0),
    replay_total: rows.reduce((sum, row) => sum + (row.replay_tokens as number), 0),
    screenshot_total: rows.reduce((sum, row) => sum + (row.screenshot_tokens as number), 0),
    first_median: first[Math.floor(first.length / 2)] ?? 0,
  };
  const data = { summary, rows };
  writeFileSync(new URL("./fixtures.json", import.meta.url), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data.summary, null, 2));
}

await runFixtures();
