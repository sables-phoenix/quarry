import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { Effect } from "effect";
import { Session } from "../src/session.js";
import { FLOWS } from "../src/flows.js";

const candidate = [process.env.CHROME, "/home/opencode/chrome-headless-shell", "/usr/bin/google-chrome"]
  .filter((value): value is string => Boolean(value))
  .find((value) => existsSync(value));
if (candidate) process.env.CHROME = candidate;

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve(root: string): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      const file = join(root, path === "/" ? "/index.html" : path);
      try {
        const body = readFileSync(file);
        response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("19 flows pass first run and replay", { skip: !candidate && "chrome not found" }, async () => {
  const server = await serve(new URL("../fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const session = await Effect.runPromise(Session.create());
  const failures: string[] = [];
  try {
    for (const flow of FLOWS) {
      await Effect.runPromise(session.open(base + flow.path));
      let ok = true;
      for (const step of flow.steps) {
        const result = await Effect.runPromise(session.act([step]));
        if (!result.ok) {
          ok = false;
          break;
        }
      }
      const assertions = await Effect.runPromise(session.browser.assert(flow.asserts));
      if (!ok || !assertions.every((assertion) => assertion.ok)) failures.push(`first:${flow.name}`);

      const replay = await Effect.runPromise(session.replay({ url: base + flow.path, steps: flow.steps, asserts: flow.asserts }));
      if (!replay.ok) failures.push(`replay:${flow.name}`);
    }
    assert.deepEqual(failures, []);

    const modal = FLOWS.find((flow) => flow.name === "modal confirm");
    assert.ok(modal);
    const broken = await Effect.runPromise(session.replay({ url: base + modal.path, steps: modal.steps, asserts: [{ op: "text", value: "account removed" }] }));
    assert.equal(broken.ok, false);
    assert.match(broken.witness, /account deleted/);
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }
});
