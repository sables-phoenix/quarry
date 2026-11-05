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

test("fillForm fills visible fields in order", { skip: !candidate && "chrome not found" }, async () => {
  const server = await serveFixtures(new URL("../fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await Effect.runPromise(Session.create());
  try {
    await Effect.runPromise(session.open(`http://127.0.0.1:${port}/signup.html`));
    const result = await Effect.runPromise(session.fillForm(["Ada", "ada@example.com", "correct-horse"]));
    assert.equal(result.filled, 3);
    assert.equal(result.fields.length, 3);
    assert.match(session.state?.text ?? "", /ada@example\.com/);
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
});
