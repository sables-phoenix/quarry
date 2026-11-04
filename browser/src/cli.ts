#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Session } from "./session.js";
import { projectState } from "./state.js";
import { Graph } from "./graph.js";
import type { Assertion, Flow, Step } from "./types.js";

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

async function withSession<A>(run: (session: Session) => Promise<A>): Promise<A> {
  const session = await Effect.runPromise(Session.create());
  try {
    return await run(session);
  } finally {
    await Effect.runPromise(session.close());
  }
}

if (command === "mcp") {
  await import("./mcp.js");
} else if (command === "state") {
  if (!target) throw new Error("usage: quarry-browser state <url>");
  await withSession(async (session) => {
    const state = await Effect.runPromise(session.open(target));
    if (values.json) console.log(JSON.stringify({ hash: state.hash, tokens: state.tokens, nodes: state.nodes.length }));
    else console.log(`${state.hash} ~${state.tokens} tokens\n${state.text}`);
  });
} else if (command === "act") {
  if (!target || !values.steps) throw new Error("usage: quarry-browser act <url> --steps '<json>'");
  const steps = JSON.parse(values.steps) as Step[];
  await withSession(async (session) => {
    await Effect.runPromise(session.open(target));
    const result = await Effect.runPromise(session.act(steps));
    if (values.json) console.log(JSON.stringify({ ok: result.ok, failed: result.failed, delta: result.delta.tokens, hash: result.state.hash }));
    else console.log(result.delta.text || "(no state change)");
  });
} else if (command === "project") {
  if (!target || !values.query) throw new Error("usage: quarry-browser project <url> --query <text>");
  await withSession(async (session) => {
    const state = await Effect.runPromise(session.open(target));
    const projection = projectState(state, values.query ?? "");
    if (!projection) throw new Error("no matching nodes");
    if (values.json) console.log(JSON.stringify({ matched: projection.matched, tokens: projection.tokens }));
    else console.log(projection.text);
  });
} else if (command === "replay") {
  if (!target) throw new Error("usage: quarry-browser replay <flow.json>");
  const flow = JSON.parse(readFileSync(target, "utf8")) as Flow;
  await withSession(async (session) => {
    const result = await Effect.runPromise(session.replay(flow));
    if (values.json) console.log(JSON.stringify(result));
    else console.log(result.ok ? "pass" : `fail\n${result.witness}`);
  });
} else if (command === "jump") {
  if (!target || !values.target) throw new Error("usage: quarry-browser jump <url> --target <hash>");
  await withSession(async (session) => {
    const state = await Effect.runPromise(session.open(target));
    const steps = new Graph().path(state.hash, String(values.target));
    if (!steps) throw new Error(`no known path to ${values.target}`);
    const flat = steps.flat();
    const result = await Effect.runPromise(session.act(flat));
    console.log(JSON.stringify({ reached: result.state.hash === values.target, actions: flat.length, ms: result.ms }));
  });
} else {
  console.error("commands: state, act, project, replay, jump, mcp");
  process.exit(2);
}
