import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../browser/dist/session.js";
import { serveFixtures } from "../../browser/dist/server.js";

const FLOWS = [
  { path: "/dashboard.html", step: { op: "click", role: "button", name: "increment" } },
  { path: "/tabs.html", step: { op: "click", role: "tab", name: "billing" } },
  { path: "/modal.html", step: { op: "click", role: "button", name: "delete account" } },
  { path: "/list.html", step: { op: "fill", role: "textbox", name: "filter", value: "item 4" } },
] as const;

export async function runLadder(): Promise<void> {
  const server = await serveFixtures(new URL("../../browser/fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const session = await Effect.runPromise(Session.create());
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const flow of FLOWS) {
      await Effect.runPromise(session.open(base + flow.path));
      const fingerprint = await Effect.runPromise(session.fingerprint());
      const before = await Effect.runPromise(session.look());
      await Effect.runPromise(session.act([flow.step]));
      const afterFingerprint = await Effect.runPromise(session.fingerprint());
      const after = await Effect.runPromise(session.look());
      rows.push({
        path: flow.path,
        fingerprint_tokens: fingerprint.tokens,
        after_fingerprint_tokens: afterFingerprint.tokens,
        first_look: before.kind,
        after_look: after.kind,
        after_tokens: after.tokens,
        screenshot_per_step: 1366 * 2,
      });
    }
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
  const summary = {
    flows: rows.length,
    ladder_total: rows.reduce((sum, row) => sum + (row.fingerprint_tokens as number) + (row.after_fingerprint_tokens as number) + (row.after_tokens as number), 0),
    screenshot_total: rows.reduce((sum, row) => sum + (row.screenshot_per_step as number), 0),
    crops: rows.filter((row) => row.after_look === "crop").length,
  };
  writeFileSync(new URL("./ladder.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify({ summary, rows }, null, 2));
}

await runLadder();
