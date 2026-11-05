import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LivingBrain } from "../src/livingbrain.js";
import { PlaybookStore } from "../src/playbook.js";

const readBody = (request: import("node:http").IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

test("living brain adapter stores a pointer and resolves it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quarry-lb-"));
  const store = new PlaybookStore(dir);
  const playbook = await store.save({ site: "example.com", goal: "read the docs", url: "https://example.com/docs", steps: [{ op: "click", role: "link", name: "Docs" }] });
  let captured = "";
  let queried = "";
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    if (request.url === "/v1/brains/brain/captures") {
      captured = body;
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "source-1", status: "pending" }));
      return;
    }
    if (request.url === "/v1/brains/brain/search") {
      queried = body;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ slug: "example-docs", title: "example docs", summary: "playbook", status: "active", similarity: 0.91, matchedOn: "both" }]));
      return;
    }
    if (request.url === "/v1/brains/brain/pages/example-docs") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ slug: "example-docs", title: "example docs", status: "active", body: `shared page\nquarry-playbook-id: ${playbook.id}` }));
      return;
    }
    response.writeHead(404);
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const brain = new LivingBrain({ apiKey: "test-key", subjectId: "subject", brainId: "brain", baseUrl: `http://127.0.0.1:${port}/v1` });
    const source = await brain.capture(playbook);
    assert.equal(source.id, "source-1");
    assert.match(captured, new RegExp(playbook.id));
    assert.doesNotMatch(captured, /"op":"click"/);
    const found = await brain.find("example.com", "read docs", store);
    assert.equal(found?.playbook.id, playbook.id);
    assert.match(queried, /example\.com read docs/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
