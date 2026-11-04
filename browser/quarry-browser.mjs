#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Browser } from "./driver.mjs";
import { buildState, diffStates, projectState } from "./state.mjs";
import { Graph } from "./graph.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    steps: { type: "string" },
    query: { type: "string" },
    target: { type: "string" },
    json: { type: "boolean", default: false },
    scope: { type: "string" },
  },
});

const [command, target] = positionals;

async function withBrowser(fn) {
  const b = await Browser.launch();
  try {
    return await fn(b);
  } finally {
    await b.close();
  }
}

if (command === "mcp") {
  await import("./mcp.mjs");
} else if (command === "state") {
  if (!target) throw new Error("usage: quarry-browser state <url>");
  const state = await withBrowser(async (b) => {
    await b.navigate(target);
    return buildState(await b.ax(), await b.url(), { scope: values.scope });
  });
  if (values.json) console.log(JSON.stringify({ hash: state.hash, tokens: state.tokens, nodes: state.nodes.length }));
  else console.log(`${state.hash} ~${state.tokens} tokens\n${state.text}`);
} else if (command === "act") {
  if (!target || !values.steps) throw new Error("usage: quarry-browser act <url> --steps '<json>'");
  const steps = JSON.parse(values.steps);
  const result = await withBrowser(async (b) => {
    await b.navigate(target);
    const before = buildState(await b.ax(), await b.url(), { scope: values.scope });
    const run = await b.act(steps);
    const after = buildState(await b.ax(), await b.url(), { scope: values.scope });
    const graph = new Graph();
    graph.rememberState(after);
    if (run.ok) graph.record(before.hash, steps, after.hash);
    return { run, delta: diffStates(before, after), hash: after.hash };
  });
  if (values.json) console.log(JSON.stringify({ ok: result.run.ok, failed: result.run.failed, delta: result.delta.tokens, hash: result.hash }));
  else console.log(result.delta.text || "(no state change)");
} else if (command === "project") {
  if (!target || !values.query) throw new Error("usage: quarry-browser project <url> --query <text>");
  const projected = await withBrowser(async (b) => {
    await b.navigate(target);
    const state = buildState(await b.ax(), await b.url(), { scope: values.scope });
    return projectState(state, values.query);
  });
  if (!projected) throw new Error("no matching nodes");
  if (values.json) console.log(JSON.stringify({ matched: projected.matched, tokens: projected.tokens }));
  else console.log(projected.text);
} else if (command === "replay") {
  if (!target) throw new Error("usage: quarry-browser replay <flow.json>");
  const flow = JSON.parse(readFileSync(target, "utf8"));
  const result = await withBrowser(async (b) => {
    await b.navigate(flow.url);
    const before = buildState(await b.ax(), await b.url(), { scope: values.scope });
    const run = await b.act(flow.steps || []);
    const after = buildState(await b.ax(), await b.url(), { scope: values.scope });
    const assertions = await b.assert(flow.asserts || []);
    const ok = run.ok && assertions.every((a) => a.ok);
    return { ok, failed: run.failed, assertions, witness: ok ? "" : diffStates(before, after).text };
  });
  if (values.json) console.log(JSON.stringify(result));
  else console.log(result.ok ? "pass" : `fail\n${result.witness}`);
} else if (command === "jump") {
  if (!target || !values.target) throw new Error("usage: quarry-browser jump <url> --target <hash>");
  const result = await withBrowser(async (b) => {
    await b.navigate(target);
    const state = buildState(await b.ax(), await b.url(), { scope: values.scope });
    const graph = new Graph();
    const steps = graph.path(state.hash, values.target);
    if (!steps) throw new Error(`no known path to ${values.target}`);
    const flat = steps.flat();
    const run = await b.act(flat);
    const after = buildState(await b.ax(), await b.url(), { scope: values.scope });
    return { reached: after.hash === values.target, actions: flat.length, ms: run.ms };
  });
  console.log(JSON.stringify(result));
} else {
  console.error("commands: state, act, project, replay, jump, mcp");
  process.exit(2);
}
