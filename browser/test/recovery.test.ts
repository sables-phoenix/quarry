import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { Browser } from "../src/browser.js";

test("a closed browser reports closed", async () => {
  const previous = process.env.CHROME;
  process.env.CHROME = "/home/opencode/chrome-headless-shell";
  try {
    const browser = await Effect.runPromise(Browser.launch());
    await Effect.runPromise(browser.close());
    assert.equal(browser.isOpen(), false);
  } finally {
    if (previous === undefined) delete process.env.CHROME;
    else process.env.CHROME = previous;
  }
});

test("launch fails fast with a missing chrome binary", async () => {
  const previous = process.env.CHROME;
  process.env.CHROME = "/nonexistent/chrome-binary";
  try {
    const exit = await Effect.runPromiseExit(Browser.launch());
    assert.equal(exit._tag, "Failure");
  } finally {
    if (previous === undefined) delete process.env.CHROME;
    else process.env.CHROME = previous;
  }
});
