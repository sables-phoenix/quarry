import { createInterface } from "node:readline";
import { Effect } from "effect";
import { Session } from "./session.js";
import { projectState } from "./state.js";
import { PlaybookStore } from "./playbook.js";

type Request = { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Response = { content: Content[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const TOOLS = [
  { name: "browser_open", description: "Open a url and return the scoped semantic state. Example: browser_open({url:'https://example.com'}). Call this first.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_fingerprint", description: "Return a tiny observation: hash, url, title, text length, and control count. Use this first after an action. Example: browser_fingerprint({}).", inputSchema: { type: "object", properties: {} } },
  { name: "browser_wait", description: "Wait for text or a fixed delay. Use this after a click when the next screen is slow. Example: browser_wait({ text: 'Checkout', timeout: 8000 }).", inputSchema: { type: "object", properties: { text: { type: "string" }, ms: { type: "number" }, timeout: { type: "number" } } } },
  { name: "browser_look", description: "Return a screenshot. The first call is a full frame. Later calls compare with the previous frame and return a cropped image when the change is small. Use only when pixels matter.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_controls", description: "Return only interactive controls with stable ids, roles, names, and values. Use this to find the field or button to act on. Example: browser_controls({}).", inputSchema: { type: "object", properties: {} } },
  { name: "browser_fill_form", description: "Fill every visible text field in document order with the given values. Returns the field labels and how many were filled. Use this when a form has several fields and guecting labels is slow. Example: browser_fill_form({values:['Backend engineer','Remote','you@example.com']}).", inputSchema: { type: "object", properties: { values: { type: "array", items: { type: "string" } } }, required: ["values"] } },
  { name: "browser_state", description: "Return the current semantic state, its hash, and its token estimate.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_project", description: "Return only the state nodes that match a query.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "browser_act", description: "Run typed steps and return a summarized delta. Click needs a role and a name: {op:'click',role:'link',name:'Docs'}. Other steps: {op:'fill',role:'textbox',name:'email',value:'a@b.c'}, {op:'wait_for',text:'Checkout',timeout:8000}, {op:'wait',ms:300}. Roles: link, button, textbox, tab, checkbox. Batch independent steps in one call when the flow is known. Always call browser_open first.", inputSchema: { type: "object", properties: { steps: { type: "array", items: { type: "object" } } }, required: ["steps"] } },
  { name: "browser_assert", description: "Check typed assertions against the current page. Ops: text, not_text, url, count, exists, present, visible. Example: browser_assert({asserts:[{op:'text',value:'Checkout'}]}).", inputSchema: { type: "object", properties: { asserts: { type: "array", items: { type: "object" } } }, required: ["asserts"] } },
  { name: "browser_replay", description: "Run a recorded flow. Shape: {url, steps:[...], asserts:[{op:'text',value:'Checkout'}]}. Returns 1 token on pass, a witness on failure. Prefer browser_open + browser_act while exploring.", inputSchema: { type: "object", properties: { url: { type: "string" }, steps: { type: "array", items: { type: "object" } }, asserts: { type: "array", items: { type: "object" } } }, required: ["url", "steps"] } },
  { name: "browser_playbook_save", description: "Save an executable playbook locally. Example: browser_playbook_save({site:'klawva.xyz',goal:'hire cv tailor',url:'https://klawva.xyz/employees',steps:[...],asserts:[...]}).", inputSchema: { type: "object", properties: { site: { type: "string" }, goal: { type: "string" }, url: { type: "string" }, steps: { type: "array", items: { type: "object" } }, asserts: { type: "array", items: { type: "object" } } }, required: ["site", "goal", "url", "steps"] } },
  { name: "browser_playbook_find", description: "Find saved playbooks by site and goal. Returns the top local matches.", inputSchema: { type: "object", properties: { site: { type: "string" }, goal: { type: "string" }, limit: { type: "number" } }, required: ["site", "goal"] } },
  { name: "browser_playbook_run", description: "Load a saved playbook by id, replay it, and record the result. Returns pass or a witness.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "browser_jump", description: "Navigate to a previously recorded state hash using the shortest known action path.", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } },
];

let session: Session | null = null;
const playbooks = new PlaybookStore();

async function getSession(): Promise<Session> {
  if (session && session.browser.isOpen()) return session;
  if (session) await Effect.runPromise(session.close());
  session = await Effect.runPromise(Session.create());
  return session;
}

async function call(name: string, args: Record<string, unknown>): Promise<Response> {
  if (name === "browser_playbook_save") {
    const playbook = await playbooks.save({
      site: String(args.site),
      goal: String(args.goal),
      url: String(args.url),
      steps: (args.steps ?? []) as never,
      asserts: (args.asserts ?? []) as never,
    });
    return { content: [{ type: "text", text: JSON.stringify({ playbook }) }], structuredContent: { id: playbook.id } };
  }
  if (name === "browser_playbook_find") {
    const limit = typeof args.limit === "number" ? args.limit : 3;
    const local = await playbooks.find(String(args.site), String(args.goal), limit);
    if (local.length > 0) {
      return { content: [{ type: "text", text: JSON.stringify(local.map((match) => ({ ...match, source: "local" }))) }], structuredContent: { matched: local.length, source: "local" } };
    }
    return { content: [{ type: "text", text: "no matching playbook" }], structuredContent: { matched: 0 } };
  }
  if (name === "browser_playbook_run") {
    const playbook = await playbooks.load(String(args.id));
    if (!playbook) throw new Error(`playbook not found: ${String(args.id)}`);
    const started = performance.now();
    const runSession = await getSession();
    const result = await Effect.runPromise(runSession.replay({ url: playbook.url, steps: playbook.steps, asserts: playbook.asserts ?? [] }));
    await playbooks.markResult(playbook.id, result.ok, result.witness);
    const ms = Math.round(performance.now() - started);
    return { content: [{ type: "text", text: result.ok ? `pass ${playbook.id} ${ms}ms` : `fail ${playbook.id} ${ms}ms\n${result.witness}` }], structuredContent: { ok: result.ok, id: playbook.id, ms, tokens: result.tokens, failed: result.failed as unknown } };
  }
  const s = await getSession();
  if (name === "browser_open") {
    const state = await Effect.runPromise(s.open(String(args.url)));
    return { content: [{ type: "text", text: state.text }], structuredContent: { hash: state.hash, tokens: state.tokens, nodes: state.nodes.length } };
  }
  if (name === "browser_fingerprint") {
    const fp = await Effect.runPromise(s.fingerprint());
    return { content: [{ type: "text", text: fp.text }], structuredContent: { tokens: fp.tokens, hash: fp.hash } };
  }
  if (name === "browser_wait") {
    const waitArgs = args as { text?: string; ms?: number; timeout?: number };
    const started = Date.now();
    if (waitArgs.text) {
      const result = await Effect.runPromise(s.browser.act([{ op: "wait_for", text: waitArgs.text, timeout: waitArgs.timeout }]));
      return { content: [{ type: "text", text: JSON.stringify({ ok: result.ok, ms: Date.now() - started }) }], isError: !result.ok };
    }
    await Effect.runPromise(s.browser.act([{ op: "wait", ms: waitArgs.ms ?? 500 }]));
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, ms: Date.now() - started }) }] };
  }
  if (name === "browser_look") {
    const look = await Effect.runPromise(s.look());
    return {
      content: [
        { type: "image", data: look.data, mimeType: "image/png" },
        { type: "text", text: JSON.stringify({ kind: look.kind, tokens: look.tokens, ratio: look.ratio, box: look.box }) },
      ],
      structuredContent: { kind: look.kind, tokens: look.tokens, ratio: look.ratio, box: look.box },
    };
  }
  if (name === "browser_controls") {
    const controls = await Effect.runPromise(s.controls());
    return { content: [{ type: "text", text: controls.text }], structuredContent: { tokens: controls.tokens } };
  }
  if (name === "browser_fill_form") {
    const result = await Effect.runPromise(s.fillForm((args.values ?? []) as string[]));
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { filled: result.filled, fields: result.fields } };
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
