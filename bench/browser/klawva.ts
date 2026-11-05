import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../browser/dist/session.js";
import { tokenCount } from "../../browser/dist/state.js";
import type { Step } from "../../browser/dist/types.js";

const SITE = "https://klawva.xyz/employees";

const FIRST: Step[] = [
  { op: "wait_for", text: "Cv Tailor", timeout: 8000 },
  { op: "click", role: "link", name: "Cv Tailor" },
  { op: "wait_for", text: "HIRE KLAWVA CV TAILOR", timeout: 8000 },
  { op: "click", role: "button", name: "HIRE KLAWVA CV TAILOR" },
  { op: "wait_for", text: "PAY AND LAUNCH", timeout: 8000 },
  { op: "fill", role: "textbox", name: "Lagos or remote", value: "Remote" },
  { op: "fill", role: "textbox", name: "you@example.com", value: "bench@example.com" },
  { op: "click", role: "button", name: "24 hours" },
];

const ASSERTS = [{ op: "text" as const, value: "PAY AND LAUNCH" }];

export async function runKlawva(): Promise<void> {
  const session = await Effect.runPromise(Session.create());
  const first: Array<Record<string, number | boolean>> = [];
  const replay: Array<Record<string, number | boolean>> = [];
  try {
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const initial = await Effect.runPromise(session.open(SITE));
      let delta = 0;
      let ok = true;
      for (const step of FIRST) {
        const result = await Effect.runPromise(session.act([step]));
        if (!result.ok) {
          ok = false;
          break;
        }
        delta += result.delta.tokens;
      }
      const assertions = await Effect.runPromise(session.browser.assert(ASSERTS));
      const assertTokens = tokenCount(JSON.stringify(assertions));
      ok = ok && assertions.every((assertion) => assertion.ok);
      first.push({ run, ms: Math.round(performance.now() - started), tokens: initial.tokens + delta + assertTokens, ok });
    }
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const result = await Effect.runPromise(session.replay({ url: SITE, steps: FIRST, asserts: ASSERTS }));
      replay.push({ run, ms: Math.round(performance.now() - started), tokens: result.tokens, ok: result.ok });
    }
  } finally {
    await Effect.runPromise(session.close());
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const summary = {
    tokenizer: "o200k_base",
    first: { median_ms: median(first.map((row) => row.ms as number)), tokens: median(first.map((row) => row.tokens as number)), runs: first },
    replay: { median_ms: median(replay.map((row) => row.ms as number)), tokens: median(replay.map((row) => row.tokens as number)), runs: replay },
  };
  writeFileSync(new URL("./klawva-quarry.json", import.meta.url), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await runKlawva();
