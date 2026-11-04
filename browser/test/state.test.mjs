import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, diffStates, projectState } from "../state.mjs";

function node(id, parent, role, name, extra = {}) {
  return { nodeId: id, parentId: parent, childIds: [], role: { value: role }, name: { value: name }, ignored: false, properties: [], ...extra };
}

function tree(names) {
  const nodes = [node("root", null, "RootWebArea", "page"), node("main", "root", "main", "")];
  names.forEach((name, i) => {
    nodes.push(node(`n${i}`, "main", "link", name));
    nodes[1].childIds.push(`n${i}`);
  });
  nodes[0].childIds.push("main");
  return nodes;
}

test("stable ids survive reordering", () => {
  const a = buildState(tree(["alpha", "beta", "gamma"]), "https://example.com/");
  const b = buildState(tree(["gamma", "alpha", "beta"]), "https://example.com/");
  assert.equal(a.hash, b.hash);
  assert.equal(a.text, b.text);
});

test("live region value changes are a change, not a new node", () => {
  const base = [node("root", null, "RootWebArea", "page"), node("main", "root", "main", "")];
  base[0].childIds.push("main");
  const status = node("st", "main", "status", "", { properties: [{ name: "live", value: { value: "polite" } }], childIds: ["tx"] });
  const text = node("tx", "st", "StaticText", "0");
  const nodes = [...base, status, text];
  base[1].childIds.push("st");
  const a = buildState(nodes, "https://example.com/");
  const b = buildState(nodes.map((n) => (n.nodeId === "tx" ? { ...n, name: { value: "1" } } : n)), "https://example.com/");
  const d = diffStates(a, b);
  assert.equal(d.changed, 1);
  assert.match(d.text, /~ live/);
});

test("bulk removals are summarized", () => {
  const a = buildState(tree(Array.from({ length: 12 }, (_, i) => `item ${i}`)), "https://example.com/");
  const b = buildState(tree(["item 0"]), "https://example.com/");
  const d = diffStates(a, b);
  assert.match(d.text, /11 link/);
  assert.ok(d.tokens < 40);
});

test("projection keeps matches and reports misses", () => {
  const s = buildState(tree(["etag validation", "billing", "etag header"]), "https://example.com/");
  const p = projectState(s, "etag validation");
  assert.equal(p.matched, 2);
  assert.equal(projectState(s, "nonexistent"), null);
});
