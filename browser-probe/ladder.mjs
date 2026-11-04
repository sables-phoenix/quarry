import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "chrome-headless-shell";
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), "quarry-cdp2-"));
const chrome = spawn(CHROME, [
  "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function pageSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (r.ok) {
        const page = (await r.json()).find((t) => t.type === "page");
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(50);
  }
  throw new Error("no page target");
}

const FINGERPRINT = `(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const interactive = q('a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],[contenteditable]');
  return JSON.stringify({
    url: location.href,
    title: document.title,
    text_chars: document.body.innerText.length,
    interactive,
    forms: q('form'),
    dialogs: q('dialog[open]'),
    alerts: [...document.querySelectorAll('[role=alert]')].filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).join(' | '),
  });
})()`;

const ACTIONS = `(() => {
  const vh = innerHeight, vw = innerWidth;
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],[contenteditable]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || r.width === 0 || r.height === 0) continue;
    if (el.disabled) continue;
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    if (!name) continue;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    out.push({ role: type && role === 'input' ? type : role, name, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    if (out.length >= 40) break;
  }
  return JSON.stringify(out);
})()`;

async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function navigate(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired", 20000);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(100);
}

function tok(chars) { return Math.ceil(chars / 4); }

async function shot(cdp, clip) {
  const params = { format: "png", captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await cdp.send("Page.captureScreenshot", params);
  return r.data;
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

const scenarios = [
  { name: "login", url: "http://127.0.0.1:8899/login.html", before: null, act: `document.getElementById('email').value='ada@example.com';document.getElementById('password').value='correct-horse';document.getElementById('go').click();` },
  { name: "increment", url: "http://127.0.0.1:8899/dashboard.html", act: `document.getElementById('inc').click()` },
  { name: "dialog", url: "http://127.0.0.1:8899/dashboard.html", act: `document.getElementById('open').click()` },
  { name: "filter", url: "http://127.0.0.1:8899/list.html", act: `const q=document.getElementById('q');q.value='item 4';q.dispatchEvent(new Event('input',{bubbles:true}))` },
  { name: "chart", url: "http://127.0.0.1:8899/visual.html", act: `document.getElementById('b').click()` },
  { name: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", act: `document.querySelector('a[href="#validation"]')?.click()` },
];

const start = performance.now();
let wsUrl;
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(50);
}
const bootMs = performance.now() - start;

const cdp = new Cdp(await pageSocket());
await cdp.ready;
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const results = [];
for (const s of scenarios) {
  await navigate(cdp, s.url);
  const t0 = performance.now();
  const fpBefore = await evaluate(cdp, FINGERPRINT);
  const actions = await evaluate(cdp, ACTIONS);
  const textBefore = await evaluate(cdp, "document.body.innerText");
  const imgBefore = await shot(cdp);
  const observeMs = performance.now() - t0;

  const t1 = performance.now();
  await evaluate(cdp, s.act);
  await sleep(250);
  const actMs = performance.now() - t1;

  const t2 = performance.now();
  const fpAfter = await evaluate(cdp, FINGERPRINT);
  const textAfter = await evaluate(cdp, "document.body.innerText");
  const postMs = performance.now() - t2;

  const imgAfter = await shot(cdp);
  const diff = JSON.parse(await evaluate(cdp, DIFF(imgBefore, imgAfter)));
  let cropTokens = 0, cropBytes = 0;
  if (diff.changed > 0) {
    const crop = await shot(cdp, diff.box);
    cropBytes = Buffer.from(crop, "base64").length;
    cropTokens = Math.ceil((diff.box.width * diff.box.height) / 750);
  }

  const beforeLines = new Set(textBefore.split("\n"));
  const afterLines = new Set(textAfter.split("\n"));
  const onlyAfter = [...afterLines].filter((l) => !beforeLines.has(l));
  const onlyBefore = [...beforeLines].filter((l) => !afterLines.has(l));

  results.push({
    name: s.name,
    url: s.url,
    observe_ms: Math.round(observeMs),
    act_ms: Math.round(actMs),
    post_ms: Math.round(postMs),
    fingerprint_tokens: tok(fpBefore.length),
    actions_count: JSON.parse(actions).length,
    actions_tokens: tok(actions.length),
    text_tokens: tok(textBefore.length),
    image_tokens: 1366,
    diff_changed_px: diff.changed,
    diff_ratio: diff.ratio ? Number(diff.ratio.toFixed(4)) : 0,
    diff_box: diff.box || null,
    crop_bytes: cropBytes,
    crop_tokens: cropTokens,
    text_delta_tokens: tok(onlyAfter.join("\n").length + onlyBefore.join("\n").length),
    text_delta_lines: onlyAfter.length + onlyBefore.length,
  });
}

console.log(JSON.stringify({ boot_ms: Math.round(bootMs), results }, null, 2));
cdp.ws.close();
chrome.kill("SIGKILL");
try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
