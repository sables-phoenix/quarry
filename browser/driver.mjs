import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "chrome-headless-shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const RESOLVE = `function deepAll(root, sel, out) {
  out.push(...root.querySelectorAll(sel));
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepAll(el.shadowRoot, sel, out);
  for (const f of root.querySelectorAll('iframe')) { try { if (f.contentDocument) deepAll(f.contentDocument, sel, out); } catch (e) {} }
  return out;
}
function labelOf(el) {
  const lbl = el.labels && el.labels[0] ? el.labels[0].innerText : '';
  return (el.getAttribute('aria-label') || lbl || el.innerText || el.getAttribute('placeholder') || el.value || el.title || el.id || '').trim().replace(/\\s+/g, ' ');
}
function find(role, name) {
  const map = { button: 'button,[role=button]', link: 'a', textbox: 'input,textarea', email: 'input', password: 'input', tab: '[role=tab]', checkbox: 'input[type=checkbox]', radio: 'input[type=radio]', combobox: 'select', select: 'select' };
  const els = deepAll(document, map[role] || '*', []);
  const target = String(name).trim().toLowerCase();
  let partial = null;
  for (const el of els) {
    const l = labelOf(el).toLowerCase();
    if (l === target) return el;
    if (!partial && l.includes(target)) partial = el;
  }
  return partial;
}`;

export const APPLY = `(steps) => { ${RESOLVE}
  const done = [];
  for (const s of steps) {
    if (s.op === 'click') {
      const el = find(s.role, s.name);
      if (!el) return JSON.stringify({ ok: false, failed: s, done });
      el.scrollIntoView({ block: 'center' });
      el.click();
    } else if (s.op === 'fill') {
      const el = find(s.role, s.name);
      if (!el) return JSON.stringify({ ok: false, failed: s, done });
      el.focus();
      el.value = s.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (s.op === 'select') {
      const el = find('combobox', s.name);
      if (!el) return JSON.stringify({ ok: false, failed: s, done });
      el.value = s.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (s.op === 'check') {
      const el = find('checkbox', s.name);
      if (!el) return JSON.stringify({ ok: false, failed: s, done });
      el.checked = Boolean(s.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (s.op === 'wait') {
      continue;
    }
    done.push(s);
  }
  return JSON.stringify({ ok: true, done });
}`;

export const ASSERT = `(assertions) => { ${RESOLVE}
  const text = document.body.innerText;
  const out = [];
  for (const a of assertions) {
    if (a.op === 'text') out.push({ op: 'text', value: a.value, ok: text.includes(a.value) });
    else if (a.op === 'not_text') out.push({ op: 'not_text', value: a.value, ok: !text.includes(a.value) });
    else if (a.op === 'count') out.push({ op: 'count', value: a.value, ok: deepAll(document, a.selector, []).filter((e) => !e.hidden).length === a.value });
    else if (a.op === 'url') out.push({ op: 'url', value: a.value, ok: location.href.includes(a.value) });
  }
  return JSON.stringify(out);
}`;

export class Browser {
  static async launch(options = {}) {
    const width = options.width ?? 1280;
    const height = options.height ?? 800;
    const profile = mkdtempSync(join(tmpdir(), "quarry-b-"));
    const port = 9400 + Math.floor(Math.random() * 500);
    const chrome = spawn(CHROME, [
      "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    chrome.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-2000); });
    let wsUrl = null;
    for (let i = 0; i < 1200; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json`);
        if (r.ok) {
          const page = (await r.json()).find((t) => t.type === "page");
          if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
        }
      } catch {}
      await sleep(50);
    }
    if (!wsUrl) throw new Error(`chrome did not start: ${stderr}`);
    const cdp = new Cdp(wsUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Accessibility.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return new Browser(cdp, chrome, profile);
  }

  constructor(cdp, chrome, profile) {
    this.cdp = cdp;
    this.chrome = chrome;
    this.profile = profile;
    this.lastText = "";
    this.lastShot = null;
  }

  async eval(expression) {
    const r = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }

  async url() {
    return this.eval("location.href");
  }

  async navigate(url) {
    const loaded = this.cdp.once("Page.loadEventFired", 20000);
    await this.cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(120);
    this.lastText = await this.eval("document.body.innerText");
    this.lastShot = await this.shot();
  }

  async ax() {
    return (await this.cdp.send("Accessibility.getFullAXTree")).nodes;
  }

  async act(steps, settle = 250) {
    const started = performance.now();
    const filtered = steps.filter((s) => s.op !== "wait");
    let result;
    try {
      result = JSON.parse(await this.eval(`(${APPLY})(${JSON.stringify(filtered)})`));
    } catch (e) {
      result = { ok: true, navigated: true };
    }
    const waits = steps.filter((s) => s.op === "wait").map((s) => s.ms || 300);
    const wait = Math.max(settle, ...waits, 0);
    await sleep(wait);
    return { ...result, ms: Math.round(performance.now() - started) };
  }

  async assert(assertions) {
    return JSON.parse(await this.eval(`(${ASSERT})(${JSON.stringify(assertions)})`));
  }

  async text() {
    const text = await this.eval("document.body.innerText");
    this.lastText = text;
    return text;
  }

  async textDelta() {
    const text = await this.eval("document.body.innerText");
    const before = new Set(this.lastText.split("\n"));
    const after = new Set(text.split("\n"));
    const added = [...after].filter((l) => !before.has(l));
    const removed = [...before].filter((l) => !after.has(l));
    this.lastText = text;
    const body = [...removed.map((l) => "-" + l), ...added.map((l) => "+" + l)].join("\n");
    return { added: added.length, removed: removed.length, text: body, tokens: Math.ceil(body.length / 4) };
  }

  async shot(clip) {
    const params = { format: "png", captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    return (await this.cdp.send("Page.captureScreenshot", params)).data;
  }

  async close() {
    try { this.cdp.ws.close(); } catch {}
    this.chrome.kill("SIGKILL");
    await sleep(300);
    try {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
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
