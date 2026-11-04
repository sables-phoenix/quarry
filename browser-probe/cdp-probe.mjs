import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "chrome-headless-shell";
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "quarry-cdp-"));

const pages = process.argv.slice(2);
if (pages.length === 0) {
  console.error("usage: node cdp-probe.mjs <url> [...]");
  process.exit(2);
}

const chrome = spawn(CHROME, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function version() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(50);
  }
  throw new Error("chrome did not start");
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        const list = this.events.get(msg.method) || [];
        this.events.set(msg.method, []);
        for (const fn of list) fn(msg.params);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeout = 15000) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout ${method}`)), timeout);
      const fn = (p) => { clearTimeout(timer); res(p); };
      const list = this.events.get(method) || [];
      list.push(fn);
      this.events.set(method, list);
    });
  }
}

function compact(nodes) {
  const keep = new Set(["button","link","textbox","checkbox","radio","combobox","heading","listitem","cell","row","tab","dialog","alert","navigation","main","form","searchbox","switch","slider","img","status"]);
  const lines = [];
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const depth = (n) => { let d = 0, p = n.parentId; while (p && byId.has(p)) { d++; p = byId.get(p).parentId; } return d; };
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role?.value || "";
    const name = (n.name?.value || "").replace(/\s+/g, " ").trim();
    const value = (n.value?.value || "").replace(/\s+/g, " ").trim();
    if (!role && !name) continue;
    if (!name && !keep.has(role)) continue;
    if (!name && !value && !keep.has(role)) continue;
    const props = {};
    for (const p of n.properties || []) {
      if (["checked","disabled","expanded","selected","required","invalid","modal"].includes(p.name)) props[p.name] = p.value?.value;
    }
    const d = Math.min(depth(n), 12);
    const state = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(" ");
    lines.push(`${"  ".repeat(d)}${role || "node"}: ${name}${value ? ` = ${JSON.stringify(value)}` : ""}${state ? ` {${state}}` : ""}`);
  }
  return lines.join("\n");
}

function tokensAnthropicImage(w, h) {
  return Math.ceil((w * h) / 750);
}

function tokensOpenAiImage(w, h) {
  return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
}

async function run(cdp, url) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Accessibility.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const t0 = performance.now();
  const loaded = cdp.once("Page.loadEventFired", 20000);
  await cdp.send("Page.navigate", { url });
  await loaded;
  const navMs = performance.now() - t0;

  const t1 = performance.now();
  const ax = await cdp.send("Accessibility.getFullAXTree");
  const axMs = performance.now() - t1;
  const text = compact(ax.nodes);

  const t2 = performance.now();
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const shotMs = performance.now() - t2;
  const png = Buffer.from(shot.data, "base64");

  const inner = await cdp.send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });

  return {
    url,
    nav_ms: Math.round(navMs),
    ax_ms: Math.round(axMs),
    shot_ms: Math.round(shotMs),
    ax_nodes: ax.nodes.length,
    ax_lines: text.split("\n").length,
    ax_chars: text.length,
    ax_tokens: Math.ceil(text.length / 4),
    inner_chars: inner.result.value.length,
    inner_tokens: Math.ceil(inner.result.value.length / 4),
    png_bytes: png.length,
    img_tokens_anthropic: tokensAnthropicImage(1280, 800),
    img_tokens_openai: tokensOpenAiImage(1280, 800),
  };
}

async function pageSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find((t) => t.type === "page");
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(50);
  }
  throw new Error("no page target");
}

const cdp = new Cdp(await pageSocket());
await cdp.ready;
const out = [];
for (const url of pages) out.push(await run(cdp, url));
console.log(JSON.stringify(out, null, 2));
cdp.ws.close();
chrome.kill("SIGKILL");
rmSync(profile, { recursive: true, force: true });
