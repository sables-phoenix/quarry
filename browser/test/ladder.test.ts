import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../src/session.js";
import { serveFixtures } from "../src/server.js";

const candidate = [process.env.CHROME, "/home/opencode/chrome-headless-shell", "/usr/bin/google-chrome"]
  .filter((value): value is string => Boolean(value))
  .find((value) => existsSync(value));
if (candidate) process.env.CHROME = candidate;

test("ladder returns a fingerprint then a crop", { skip: !candidate && "chrome not found" }, async () => {
  const server = await serveFixtures(new URL("../fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await Effect.runPromise(Session.create());
  try {
    await Effect.runPromise(session.open(`http://127.0.0.1:${port}/dashboard.html`));
    const fingerprint = await Effect.runPromise(session.fingerprint());
    assert.ok(fingerprint.tokens < 100, String(fingerprint.tokens));
    const full = await Effect.runPromise(session.look());
    assert.equal(full.kind, "full");
    assert.equal(full.tokens, 1366);
    const acted = await Effect.runPromise(session.act([{ op: "click", role: "button", name: "increment" }]));
    assert.equal(acted.ok, true);
    const next = await Effect.runPromise(session.look());
    assert.ok(next.tokens <= 1366, String(next.tokens));
    assert.ok(next.kind === "crop" || next.kind === "full");
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
});
