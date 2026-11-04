import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { Browser } from "../driver.mjs";
import { FLOWS } from "../flows.mjs";
import { buildState, diffStates } from "../state.mjs";

const candidate = [process.env.CHROME, "/home/opencode/chrome-headless-shell", "/usr/bin/google-chrome"].filter(Boolean).find((p) => existsSync(p));
if (candidate) process.env.CHROME = candidate;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve(root) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url.split("?")[0];
      const file = join(root, path === "/" ? "/index.html" : path);
      try {
        const body = readFileSync(file);
        res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("19 flows pass first run and replay", { skip: !candidate && "chrome not found" }, async () => {
  const server = await serve(new URL("../fixtures", import.meta.url).pathname);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await Browser.launch();
  const failures = [];
  try {
    for (const flow of FLOWS) {
      await browser.navigate(base + flow.path);
      let ok = true;
      for (const step of flow.steps) {
        const r = await browser.act([step]);
        if (!r.ok) { ok = false; break; }
      }
      const assertions = await browser.assert(flow.asserts);
      if (!ok || !assertions.every((a) => a.ok)) failures.push(`first:${flow.name}`);

      await browser.navigate(base + flow.path);
      const run = await browser.act(flow.steps);
      const replayAssertions = await browser.assert(flow.asserts);
      if (!run.ok || !replayAssertions.every((a) => a.ok)) failures.push(`replay:${flow.name}`);
    }
    assert.deepEqual(failures, []);

    const modal = FLOWS.find((f) => f.name === "modal confirm");
    await browser.navigate(base + modal.path);
    const before = buildState(await browser.ax(), await browser.url());
    await browser.act(modal.steps);
    const after = buildState(await browser.ax(), await browser.url());
    const wrong = await browser.assert([{ op: "text", value: "account removed" }]);
    const witness = diffStates(before, after);
    assert.equal(wrong.every((a) => a.ok), false);
    assert.match(witness.text, /account deleted/);
  } finally {
    await browser.close();
    server.close();
  }
});
