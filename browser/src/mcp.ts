import { createInterface } from "node:readline";
import { Effect } from "effect";
import { Session } from "./session.js";
import { projectState } from "./state.js";

type Request = { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
type Response = { content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

const TOOLS = [
  { name: "browser_open", description: "Open a url and return its scoped semantic state with a stable hash.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_state", description: "Return the current semantic state, its hash, and its token estimate.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_project", description: "Return only the state nodes that match a query.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "browser_act", description: "Run a batch of typed steps and return the summarized state delta.", inputSchema: { type: "object", properties: { steps: { type: "array", items: { type: "object" } } }, required: ["steps"] } },
  { name: "browser_assert", description: "Check typed assertions against the current page.", inputSchema: { type: "object", properties: { asserts: { type: "array", items: { type: "object" } } }, required: ["asserts"] } },
  { name: "browser_replay", description: "Open a flow url, run its steps, check its assertions, and return only a witness on failure.", inputSchema: { type: "object", properties: { url: { type: "string" }, steps: { type: "array", items: { type: "object" } }, asserts: { type: "array", items: { type: "object" } } }, required: ["url", "steps"] } },
  { name: "browser_jump", description: "Navigate to a previously recorded state hash using the shortest known action path.", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } },
];

let session: Session | null = null;

async function getSession(): Promise<Session> {
  if (session) return session;
  session = await Effect.runPromise(Session.create());
  return session;
}

async function call(name: string, args: Record<string, unknown>): Promise<Response> {
  const s = await getSession();
  if (name === "browser_open") {
    const state = await Effect.runPromise(s.open(String(args.url)));
    return { content: [{ type: "text", text: state.text }], structuredContent: { hash: state.hash, tokens: state.tokens, nodes: state.nodes.length } };
  }
  if (name === "browser_state") {
    if (!s.state) throw new Error("open a page first");
    return { content: [{ type: "text", text: s.state.text }], structuredContent: { hash: s.state.hash, tokens: s.state.tokens, nodes: s.state.nodes.length } };
  }
  if (name === "browser_project") {
    if (!s.state) throw new Error("open a page first");
    const projection = projectState(s.state, String(args.query));
    if (!projection) return { content: [{ type: "text", text: "no matching nodes" }], structuredContent: { matched: 0 } };
    return { content: [{ type: "text", text: projection.text }], structuredContent: { matched: projection.matched, tokens: projection.tokens } };
  }
  if (name === "browser_act") {
    const result = await Effect.runPromise(s.act((args.steps ?? []) as never));
    return { content: [{ type: "text", text: result.delta.text || "(no state change)" }], structuredContent: { ok: result.ok, failed: result.failed as unknown, delta_tokens: result.delta.tokens, hash: result.state.hash } };
  }
  if (name === "browser_assert") {
    const assertions = await Effect.runPromise(s.browser.assert((args.asserts ?? []) as never));
    return { content: [{ type: "text", text: JSON.stringify(assertions) }], structuredContent: { ok: assertions.every((a) => a.ok), assertions } };
  }
  if (name === "browser_replay") {
    const result = await Effect.runPromise(s.replay({ url: String(args.url), steps: (args.steps ?? []) as never, asserts: (args.asserts ?? []) as never }));
    return { content: [{ type: "text", text: result.ok ? "pass" : `fail\n${result.witness}` }], structuredContent: { ok: result.ok, tokens: result.tokens, failed: result.failed as unknown, assertions: result.assertions } };
  }
  if (name === "browser_jump") {
    const result = await Effect.runPromise(s.jump(String(args.target)));
    return { content: [{ type: "text", text: result.reached ? `reached ${args.target}` : "target not reached" }], structuredContent: { reached: result.reached, actions: result.actions, ms: result.ms, model_tokens: result.model_tokens, hash: result.state.hash } };
  }
  throw new Error(`unknown tool: ${name}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const text = line.trim();
  if (!text) continue;
  let request: Request;
  try {
    request = JSON.parse(text) as Request;
  } catch (error) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `parse error: ${String(error)}` } }) + "\n");
    continue;
  }
  const id = request.id ?? null;
  const method = request.method ?? "";
  if (id === null && method.startsWith("notifications/")) continue;
  if (method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "quarry-browser", version: "0.1.0" } } }) + "\n");
  } else if (method === "ping") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: {} }) + "\n");
  } else if (method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }) + "\n");
  } else if (method === "tools/call") {
    try {
      const result = await call(request.params?.name ?? "", (request.params?.arguments ?? {}) as Record<string, unknown>);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `error: ${String(error)}` }], isError: true } }) + "\n");
    }
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } }) + "\n");
  }
}

const active = session as Session | null;
if (active) await Effect.runPromise(active.close());
