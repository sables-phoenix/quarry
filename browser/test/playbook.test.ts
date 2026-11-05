import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaybookStore } from "../src/playbook.js";

const steps = [{ op: "click" as const, role: "link", name: "Docs" }];

test("playbook store saves, finds, and marks results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quarry-playbook-"));
  const store = new PlaybookStore(dir);
  const saved = await store.save({ site: "example.com", goal: "read the docs", url: "https://example.com/docs", steps });
  assert.equal(saved.id.length, 16);
  assert.equal(saved.successCount, 0);

  const other = await store.save({ site: "example.com", goal: "open pricing", url: "https://example.com/pricing", steps });
  assert.notEqual(saved.id, other.id);

  const matches = await store.find("https://example.com", "find the documentation");
  assert.equal(matches[0]?.playbook.id, saved.id);
  assert.equal(matches.length, 2);

  const marked = await store.markResult(saved.id, true);
  assert.equal(marked?.successCount, 1);
  assert.notEqual(marked?.verifiedAt, undefined);

  const loaded = await store.load(saved.id);
  assert.deepEqual(loaded?.steps, steps);
});
