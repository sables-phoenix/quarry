import { createInterface } from "node:readline";
import { Browser } from "./driver.mjs";
import { buildState, diffStates, projectState } from "./state.mjs";
import { Graph } from "./graph.mjs";

class Session {
  constructor() {
    this.browser = null;
    this.graph = new Graph();
    this.state = null;
  }

  async ensure() {
    if (!this.browser) this.browser = await Browser.launch();
    return this.browser;
  }

  async open(url) {
    const b = await this.ensure();
    await b.navigate(url);
    this.state = buildState(await b.ax(), await b.url());
    this.graph.rememberState(this.state);
    return this.state;
  }

  async act(steps) {
    const b = await this.ensure();
    if (!this.state) throw new Error("open a page first");
    const before = this.state;
    const result = await b.act(steps);
    const after = buildState(await b.ax(), await b.url());
    const delta = diffStates(before, after);
    this.state = after;
    this.graph.rememberState(after);
    if (result.ok) this.graph.record(before.hash, steps, after.hash);
    return { ok: result.ok, failed: result.failed, ms: result.ms, delta, state: after };
  }

  async replay(flow) {
    const b = await this.ensure();
    await b.navigate(flow.url);
    const before = buildState(await b.ax(), await b.url());
    const result = await b.act(flow.steps || []);
    const after = buildState(await b.ax(), await b.url());
    const assertions = await b.assert(flow.asserts || []);
    const ok = result.ok && assertions.every((a) => a.ok);
    const witness = ok ? "" : diffStates(before, after).text;
    this.state = after;
    return { ok, failed: result.failed, assertions, witness, tokens: ok ? 10 : 10 + Math.ceil(witness.length / 4) + 40, state: after };
  }

  async jump(target) {
    const b = await this.ensure();
    if (!this.state) throw new Error("open a page first");
    const paths = this.graph.path(this.state.hash, target);
    if (!paths) throw new Error(`no known path to ${target}`);
    const steps = paths.flat();
    const result = await this.act(steps);
    return { reached: this.state.hash === target, actions: steps.length, ms: result.ms, model_tokens: 0, state: this.state };
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.state = null;
  }
}

const TOOLS = [
  {
    name: "browser_open",
    description: "Open a url and return its scoped semantic state with a stable hash.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "browser_state",
    description: "Return the current semantic state, its hash, and its token estimate.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_project",
    description: "Return only the state nodes that match a query.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "browser_act",
    description: "Run a batch of typed steps and return the summarized state delta.",
    inputSchema: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "object" } } },
      required: ["steps"],
    },
  },
  {
    name: "browser_assert",
    description: "Check typed assertions against the current page.",
    inputSchema: {
      type: "object",
      properties: { asserts: { type: "array", items: { type: "object" } } },
      required: ["asserts"],
    },
  },
  {
    name: "browser_replay",
    description: "Open a flow url, run its steps, check its assertions, and return only a witness on failure.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        steps: { type: "array", items: { type: "object" } },
        asserts: { type: "array", items: { type: "object" } },
      },
      required: ["url", "steps"],
    },
  },
  {
    name: "browser_jump",
    description: "Navigate to a previously recorded state hash using the shortest known action path.",
    inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
  },
];

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

async function call(session, name, args) {
  if (name === "browser_open") {
    const s = await session.open(args.url);
    return { content: [{ type: "text", text: s.text }], structuredContent: { hash: s.hash, tokens: s.tokens, nodes: s.nodes.length } };
  }
  if (name === "browser_state") {
    if (!session.state) throw new Error("open a page first");
    return { content: [{ type: "text", text: session.state.text }], structuredContent: { hash: session.state.hash, tokens: session.state.tokens, nodes: session.state.nodes.length } };
  }
  if (name === "browser_project") {
    if (!session.state) throw new Error("open a page first");
    const p = projectState(session.state, args.query);
    if (!p) return { content: [{ type: "text", text: "no matching nodes" }], structuredContent: { matched: 0 } };
    return { content: [{ type: "text", text: p.text }], structuredContent: { matched: p.matched, tokens: p.tokens } };
  }
  if (name === "browser_act") {
    const r = await session.act(args.steps || []);
    return { content: [{ type: "text", text: r.delta.text || "(no state change)" }], structuredContent: { ok: r.ok, failed: r.failed, delta_tokens: r.delta.tokens, hash: r.state.hash } };
  }
  if (name === "browser_assert") {
    const assertions = await session.browser.assert(args.asserts || []);
    const okAll = assertions.every((a) => a.ok);
    return { content: [{ type: "text", text: JSON.stringify(assertions) }], structuredContent: { ok: okAll, assertions } };
  }
  if (name === "browser_replay") {
    const r = await session.replay({ url: args.url, steps: args.steps || [], asserts: args.asserts || [] });
    return { content: [{ type: "text", text: r.ok ? "pass" : `fail\n${r.witness}` }], structuredContent: { ok: r.ok, tokens: r.tokens, failed: r.failed, assertions: r.assertions } };
  }
  if (name === "browser_jump") {
    const r = await session.jump(args.target);
    return { content: [{ type: "text", text: r.reached ? `reached ${args.target}` : "target not reached" }], structuredContent: r };
  }
  throw new Error(`unknown tool: ${name}`);
}

const session = new Session();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const text = line.trim();
  if (!text) continue;
  let req;
  try {
    req = JSON.parse(text);
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `parse error: ${e.message}` } }) + "\n");
    continue;
  }
  const id = req.id ?? null;
  const method = req.method || "";
  if (id === null && method.startsWith("notifications/")) continue;
  let response;
  if (method === "initialize") {
    response = ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "quarry-browser", version: "0.1.0" } });
  } else if (method === "ping") {
    response = ok(id, {});
  } else if (method === "tools/list") {
    response = ok(id, { tools: TOOLS });
  } else if (method === "tools/call") {
    const params = req.params || {};
    try {
      const result = await call(session, params.name, params.arguments || {});
      response = ok(id, result);
    } catch (e) {
      response = ok(id, { content: [{ type: "text", text: `error: ${e.message}` }], isError: true });
    }
  } else {
    response = { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
}

await session.close();
