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

test("controls lists the button with its id", { skip: !candidate && "chrome not found" }, async () => {
  const server = await serveFixtures(new URL("../fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await Effect.runPromise(Session.create());
  try {
    await Effect.runPromise(session.open(`http://127.0.0.1:${port}/dashboard.html`));
    const controls = await Effect.runPromise(session.controls());
    assert.match(controls.text, /button increment/);
    assert.ok(controls.tokens > 0);
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
});
