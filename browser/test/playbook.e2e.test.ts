import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Session } from "../src/session.js";
import { serveFixtures } from "../src/server.js";
import { PlaybookStore } from "../src/playbook.js";

const candidate = [process.env.CHROME, "/home/opencode/chrome-headless-shell", "/usr/bin/google-chrome"]
  .filter((value): value is string => Boolean(value))
  .find((value) => existsSync(value));
if (candidate) process.env.CHROME = candidate;

test("saved playbook is found and replayed end to end", { skip: !candidate && "chrome not found" }, async () => {
  const server = await serveFixtures(new URL("../fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const site = `127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), "quarry-e2e-"));
  const store = new PlaybookStore(dir);
  const saved = await store.save({
    site,
    goal: "sign in and reach the dashboard",
    url: `http://${site}/login.html`,
    steps: [
      { op: "fill", role: "textbox", name: "email", value: "ada@example.com" },
      { op: "fill", role: "textbox", name: "password", value: "correct-horse" },
      { op: "click", role: "button", name: "continue" },
    ],
    asserts: [{ op: "text", value: "welcome back" }],
  });
  const matches = await store.find(site, "log into the dashboard");
  assert.equal(matches[0]?.playbook.id, saved.id);
  const session = await Effect.runPromise(Session.create());
  try {
    const result = await Effect.runPromise(session.replay({ url: saved.url, steps: saved.steps, asserts: saved.asserts ?? [] }));
    assert.equal(result.ok, true);
    const marked = await store.markResult(saved.id, result.ok, result.witness);
    assert.equal(marked?.successCount, 1);
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
});
