import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, diffStates, projectState } from "../src/state.js";
import type { AxNode } from "../src/types.js";

function node(id: string, parent: string | null, role: string, name: string, extra: Partial<AxNode> = {}): AxNode {
  return { nodeId: id, parentId: parent, childIds: [], role: { value: role }, name: { value: name }, ignored: false, properties: [], ...extra };
}

function tree(names: string[]): AxNode[] {
  const root = node("root", null, "RootWebArea", "page");
  const main = node("main", "root", "main", "");
  root.childIds = ["main"];
  main.childIds = names.map((_, index) => `n${index}`);
  return [root, main, ...names.map((name, index) => node(`n${index}`, "main", "link", name))];
}

test("stable ids survive reordering", () => {
  const a = buildState(tree(["alpha", "beta", "gamma"]), "https://example.com/");
  const b = buildState(tree(["gamma", "alpha", "beta"]), "https://example.com/");
  assert.equal(a.hash, b.hash);
  assert.equal(a.text, b.text);
});

test("live region value changes are a change, not a new node", () => {
  const root = node("root", null, "RootWebArea", "page");
  const main = node("main", "root", "main", "");
  const status = node("st", "main", "status", "", {
    properties: [{ name: "live", value: { value: "polite" } }],
    childIds: ["tx"],
  });
  const text = node("tx", "st", "StaticText", "0");
  root.childIds = ["main"];
  main.childIds = ["st"];
  const nodes = [root, main, status, text];
  const a = buildState(nodes, "https://example.com/");
  const changed = nodes.map((n) => (n.nodeId === "tx" ? { ...n, name: { value: "1" } } : n));
  const b = buildState(changed, "https://example.com/");
  const delta = diffStates(a, b);
  assert.equal(delta.changed, 1);
  assert.match(delta.text, /~ live/);
});

test("bulk removals are summarized", () => {
  const a = buildState(tree(Array.from({ length: 12 }, (_, i) => `item ${i}`)), "https://example.com/");
  const b = buildState(tree(["item 0"]), "https://example.com/");
  const delta = diffStates(a, b);
  assert.match(delta.text, /11 link/);
  assert.ok(delta.tokens < 40);
});

test("projection keeps matches and reports misses", () => {
  const state = buildState(tree(["etag validation", "billing", "etag header"]), "https://example.com/");
  const projection = projectState(state, "etag validation");
  assert.equal(projection?.matched, 2);
  assert.equal(projectState(state, "nonexistent"), null);
});
