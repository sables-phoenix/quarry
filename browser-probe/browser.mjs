import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CHROME = process.env.CHROME || "chrome-headless-shell";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
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

const FINGERPRINT = `(() => {
  const q = (s) => document.querySelectorAll(s).length;
  return JSON.stringify({
    url: location.href,
    title: document.title,
    text: document.body.innerText.length,
    controls: q('a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch]'),
    dialogs: q('dialog[open]'),
    alerts: [...document.querySelectorAll('[role=alert]')].filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).join(' | '),
  });
})()`;

const ACTIONS = (limit) => `(() => {
  const vh = innerHeight, vw = innerWidth;
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || r.width === 0 || r.height === 0) continue;
    if (el.disabled) continue;
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const name = (el.getAttribute('aria-label') || label || el.innerText || el.getAttribute('placeholder') || el.value || el.title || el.id || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    if (!name) continue;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    out.push({ role: type && role === 'input' ? type : role, name });
    if (out.length >= ${limit}) break;
  }
  return JSON.stringify(out);
})()`;

const FIND = `(role, name) => {
  const sel = role === 'link' ? 'a' : role === 'button' ? 'button,[role=button]' : role === 'textbox' || role === 'email' || role === 'password' ? 'input' : '*';
  const norm = (s) => (s || '').trim().replace(/\\s+/g, ' ').toLowerCase();
  const target = norm(name);
  const all = [...document.querySelectorAll(sel)];
  let best = null;
  for (const el of all) {
    const lbl = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const label = norm(el.getAttribute('aria-label') || lbl || el.innerText || el.getAttribute('placeholder') || el.value || el.title || el.id);
    if (!label) continue;
    if (label === target) { best = el; break; }
    if (!best && label.includes(target)) best = el;
  }
  if (!best) return null;
  best.scrollIntoView({ block: 'center' });
  return best;
}`;

const APPLY = `(steps) => {
  const find = ${FIND};
  const done = [];
  for (const s of steps) {
    if (s.op === 'click') {
      const el = find(s.role, s.name);
      if (!el) return JSON.stringify({ ok: false, failed: s, done });
      el.click();
      done.push(s);
    } else if (s.op === 'fill') {
      const el = find(s.role, s.name);
      if (!el) return JSON.stringify({ ok: false, failed: s, done });
      el.focus();
      el.value = s.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      done.push(s);
    }
  }
  return JSON.stringify({ ok: true, done });
}`;

const ASSERT = `(assertions) => {
  const text = document.body.innerText;
  const out = [];
  for (const a of assertions) {
    if (a.op === 'text') out.push({ ok: text.includes(a.value), kind: 'text', value: a.value });
    else if (a.op === 'url') out.push({ ok: location.href.includes(a.value), kind: 'url', value: a.value });
    else if (a.op === 'count') out.push({ ok: document.querySelectorAll(a.selector).length === a.value, kind: 'count', value: a.value });
  }
  return JSON.stringify(out);
}`;

export class Browser {
  static async launch({ width = 1280, height = 800 } = {}) {
    const profile = mkdtempSync(join(tmpdir(), "quarry-b-"));
    const port = 9400 + Math.floor(Math.random() * 400);
    const started = performance.now();
    const chrome = spawn(CHROME, [
      "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    chrome.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-2000); });
    let wsUrl;
    for (let i = 0; i < 1200; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json`);
        if (r.ok) {
          const page = (await r.json()).find((t) => t.type === "page");
          if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
        }
      } catch {}
      await sleep(25);
    }
    if (!wsUrl) throw new Error(`chrome did not start: ${stderr}`);
    const cdp = new Cdp(wsUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const bootMs = performance.now() - started;
    return new Browser(cdp, chrome, profile, bootMs);
  }

  constructor(cdp, chrome, profile, bootMs) {
    this.cdp = cdp;
    this.chrome = chrome;
    this.profile = profile;
    this.bootMs = bootMs;
    this.state = null;
    this.lastShot = null;
    this.lastText = "";
  }

  async eval(expression) {
    const r = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }

  async navigate(url) {
    const loaded = this.cdp.once("Page.loadEventFired", 20000);
    await this.cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(80);
    this.state = null;
    this.lastShot = null;
  }

  async fingerprint() {
    const raw = await this.eval(FINGERPRINT);
    const hash = createHash("sha1").update(raw).digest("hex").slice(0, 12);
    this.state = hash;
    return { hash, raw: JSON.parse(raw), tokens: Math.ceil(raw.length / 4) };
  }

  async actions(limit = 40) {
    const raw = await this.eval(ACTIONS(limit));
    return { list: JSON.parse(raw), tokens: Math.ceil(raw.length / 4) };
  }

  async text() {
    const raw = await this.eval("document.body.innerText");
    this.lastText = raw;
    return { text: raw, tokens: Math.ceil(raw.length / 4) };
  }

  async textDelta() {
    const raw = await this.eval("document.body.innerText");
    const before = new Set(this.lastText.split("\n"));
    const after = new Set(raw.split("\n"));
    const added = [...after].filter((l) => !before.has(l));
    const removed = [...before].filter((l) => !after.has(l));
    this.lastText = raw;
    const joined = [...removed.map((l) => "-" + l), ...added.map((l) => "+" + l)].join("\n");
    return { added: added.length, removed: removed.length, text: joined, tokens: Math.ceil(joined.length / 4) };
  }

  async shot(clip) {
    const params = { format: "png", captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await this.cdp.send("Page.captureScreenshot", params);
    return r.data;
  }

  async act(steps, settle = 200) {
    const t0 = performance.now();
    const raw = await this.eval(`(${APPLY})(${JSON.stringify(steps)})`);
    await sleep(settle);
    const ms = performance.now() - t0;
    return { ...JSON.parse(raw), ms: Math.round(ms) };
  }

  async assert(assertions) {
    const raw = await this.eval(`(${ASSERT})(${JSON.stringify(assertions)})`);
    return JSON.parse(raw);
  }

  async imageDelta() {
    const before = this.lastShot;
    const after = await this.shot();
    this.lastShot = after;
    if (!before) return { changed: -1, tokens: 1366, full: true };
    const diff = JSON.parse(await this.eval(DIFF(before, after)));
    if (diff.changed > 0 && diff.ratio < 0.35) {
      const crop = await this.shot(diff.box);
      return {
        changed: diff.changed,
        ratio: diff.ratio,
        box: diff.box,
        bytes: Buffer.from(crop, "base64").length,
        tokens: Math.ceil((diff.box.width * diff.box.height) / 750),
        full: false,
      };
    }
    return { changed: diff.changed, ratio: diff.ratio || 0, tokens: 1366, full: true };
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

const DIFF = (before, after) => `(async () => {
  const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
  const a = await load(${JSON.stringify(before)});
  const b = await load(${JSON.stringify(after)});
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const cv = new OffscreenCanvas(w, h); const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(a, 0, 0); const da = cx.getImageData(0, 0, w, h).data;
  cx.clearRect(0, 0, w, h); cx.drawImage(b, 0, 0); const db = cx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1, changed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2]) > 24) {
      changed++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return JSON.stringify({ changed: 0 });
  return JSON.stringify({ changed, ratio: changed / (w*h), box: { x: minX, y: minY, width: maxX-minX+1, height: maxY-minY+1 } });
})()`;
