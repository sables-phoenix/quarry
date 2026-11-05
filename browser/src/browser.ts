import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";

import type { Step, Assertion } from "./types.js";
export type { Step, Assertion };

export class BrowserError extends Data.TaggedError("BrowserError")<{ message: string; cause?: unknown }> {}

const chromeBinary = () => {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ["chrome-headless-shell", "chromium", "google-chrome", "chromium-browser"]) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (found) return found;
    } catch {
      continue;
    }
  }
  return "chrome-headless-shell";
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export const FILL_FORM = `(values) => { ${RESOLVE}
  const els = deepAll(document, 'input,textarea', []).filter((el) => {
    const type = String(el.type || '').toLowerCase();
    return !el.disabled && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'image', 'reset'].includes(type) && el.getBoundingClientRect().width > 0;
  });
  const fields = els.map(labelOf);
  const count = Math.min(values.length, els.length);
  for (let index = 0; index < count; index++) {
    const el = els[index];
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, String(values[index])); else el.value = String(values[index]);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return JSON.stringify({ filled: count, fields });
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

export const DIFF = `(args) => new Promise((resolve) => {
  const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
  Promise.all([load(args.before), load(args.after)]).then(([a, b]) => {
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
    if (maxX < 0) return resolve(JSON.stringify({ changed: 0, ratio: 0, box: null }));
    resolve(JSON.stringify({ changed, ratio: changed / (w * h), box: { x: minX, y: minY, width: maxX-minX+1, height: maxY-minY+1 } }));
  }).catch(() => resolve(JSON.stringify({ changed: -1, ratio: 1, box: null })));
})`;

const WAIT_FOR = `(condition) => {
  if (condition.selector) return Boolean(document.querySelector(condition.selector));
  if (condition.text) return document.body.innerText.includes(condition.text);
  return true;
}`;

const ASSERT = `(assertions) => { ${RESOLVE}
  const text = document.body.innerText;
  const out = [];
  for (const a of assertions) {
    if (a.op === 'text') out.push({ op: 'text', value: a.value, ok: text.includes(a.value) });
    else if (a.op === 'not_text') out.push({ op: 'not_text', value: a.value, ok: !text.includes(a.value) });
    else if (a.op === 'count') out.push({ op: 'count', value: a.value, ok: deepAll(document, a.selector, []).filter((e) => !e.hidden).length === a.value });
    else if (a.op === 'url') out.push({ op: 'url', value: a.value, ok: location.href.includes(a.value) });
    else if (a.op === 'exists' || a.op === 'present' || a.op === 'visible') {
      const target = String(a.name ?? a.value ?? '');
      out.push({ op: a.op, value: target, ok: target !== '' && text.includes(target) });
    }
  }
  return JSON.stringify(out);
}`;

type CdpResult = Record<string, unknown>;

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void }>();
  private events = new Map<string, Array<(params: unknown) => void>>();
  readonly ready: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("websocket error"));
    });
    this.ws.onmessage = (message: MessageEvent) => {
      const msg = JSON.parse(String(message.data)) as { id?: number; result?: CdpResult; error?: { message?: string }; method?: string; params?: unknown };
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message ?? "cdp error"));
        else pending.resolve(msg.result ?? {});
      } else if (msg.method) {
        const listeners = this.events.get(msg.method) ?? [];
        this.events.set(msg.method, []);
        for (const listener of listeners) listener(msg.params);
      }
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method: string, timeout = 15000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), timeout);
      const listener = (params: unknown) => {
        clearTimeout(timer);
        resolve(params);
      };
      this.events.set(method, [...(this.events.get(method) ?? []), listener]);
    });
  }

  isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws.close();
  }
}

export class Browser {
  readonly cdp: Cdp;
  private readonly chrome: ChildProcess;
  private readonly profile: string;

  private constructor(cdp: Cdp, chrome: ChildProcess, profile: string) {
    this.cdp = cdp;
    this.chrome = chrome;
    this.profile = profile;
  }

  static launch(options: { width?: number; height?: number } = {}): Effect.Effect<Browser, BrowserError> {
    const width = options.width ?? 1280;
    const height = options.height ?? 800;
    const attempt = async (): Promise<Browser> => {
      const profile = mkdtempSync(join(tmpdir(), "quarry-b-"));
      const port = 9400 + Math.floor(Math.random() * 500);
      const chrome = spawn(chromeBinary(), [
        "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const spawnState: { error: Error | null } = { error: null };
      chrome.on("error", (error) => {
        spawnState.error = error;
      });
      chrome.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      let wsUrl: string | null = null;
      for (let i = 0; i < 1200; i++) {
        if (spawnState.error) throw new Error(`chrome failed to start: ${spawnState.error.message}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json`);
          if (response.ok) {
            const page = (await response.json() as Array<{ type: string; webSocketDebuggerUrl: string }>).find((target) => target.type === "page");
            if (page) {
              wsUrl = page.webSocketDebuggerUrl;
              break;
            }
          }
        } catch {}
        if (chrome.exitCode !== null) throw new Error(`chrome exited with ${chrome.exitCode}: ${stderr}`);
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
    };
    return Effect.tryPromise({ try: attempt, catch: (error) => new BrowserError({ message: `launch: ${String(error)}`, cause: error }) });
  }

  private wrap<A>(label: string, run: () => Promise<A>): Effect.Effect<A, BrowserError> {
    return Effect.tryPromise({ try: run, catch: (error) => new BrowserError({ message: `${label}: ${String(error)}`, cause: error }) });
  }

  evalJs(expression: string): Effect.Effect<unknown, BrowserError> {
    return this.wrap("eval", async () => {
      const result = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as { exceptionDetails?: { text?: string }; result?: { value?: unknown } };
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "page exception");
      return result.result?.value;
    });
  }

  url(): Effect.Effect<string, BrowserError> {
    return this.evalJs("location.href").pipe(Effect.map((value) => String(value)));
  }

  navigate(url: string): Effect.Effect<void, BrowserError> {
    return this.wrap("navigate", async () => {
      const loaded = this.cdp.once("Page.loadEventFired", 20000);
      const result = (await this.cdp.send("Page.navigate", { url })) as { errorText?: string };
      if (result.errorText) throw new Error(`navigate: ${result.errorText}`);
      await loaded;
      await sleep(120);
    });
  }

  ax(): Effect.Effect<unknown[], BrowserError> {
    return this.wrap("ax", async () => {
      const tree = await this.cdp.send("Accessibility.getFullAXTree") as { nodes?: unknown[] };
      return tree.nodes ?? [];
    });
  }

  act(steps: Step[], settle = 250): Effect.Effect<{ ok: boolean; failed?: Step; navigated?: boolean; ms: number }, BrowserError> {
    return this.wrap("act", async () => {
      const started = performance.now();
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index]!;
        const next = steps[index + 1];
        if (step.op === "wait") {
          await sleep(step.ms ?? 300);
          continue;
        }
        if (step.op === "wait_for") {
          const deadline = Date.now() + (step.timeout ?? 5000);
          let ready = false;
          while (Date.now() < deadline) {
            ready = Boolean(await this.evalRaw(`(${WAIT_FOR})(${JSON.stringify(step)})`));
            if (ready) break;
            await sleep(100);
          }
          if (!ready) return { ok: false, failed: step, ms: Math.round(performance.now() - started) };
          continue;
        }
        let parsed: { ok: boolean; failed?: Step; navigated?: boolean };
        try {
          parsed = JSON.parse(String(await this.evalRaw(`(${APPLY})(${JSON.stringify([step])})`))) as typeof parsed;
        } catch (error) {
          const message = String(error);
          if (/Execution context was destroyed|Target closed|Cannot find context|detached/i.test(message)) {
            parsed = { ok: true, navigated: true };
          } else {
            return { ok: false, failed: step, ms: Math.round(performance.now() - started) };
          }
        }
        if (!parsed.ok) return { ...parsed, ms: Math.round(performance.now() - started) };
        if (next?.op !== "wait_for") await sleep(settle);
      }
      return { ok: true, ms: Math.round(performance.now() - started) };
    });
  }

  private async evalRaw(expression: string): Promise<unknown> {
    const result = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as { exceptionDetails?: { text?: string }; result?: { value?: unknown } };
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "page exception");
    return result.result?.value;
  }

  assert(assertions: Assertion[]): Effect.Effect<Array<{ op: string; value: unknown; ok: boolean }>, BrowserError> {
    return this.wrap("assert", async () => JSON.parse(String(await this.evalRaw(`(${ASSERT})(${JSON.stringify(assertions)})`))) as Array<{ op: string; value: unknown; ok: boolean }>);
  }

  fillForm(values: string[]): Effect.Effect<{ filled: number; fields: string[] }, BrowserError> {
    return this.wrap("fillForm", async () => JSON.parse(String(await this.evalRaw(`(${FILL_FORM})(${JSON.stringify(values)})`))) as { filled: number; fields: string[] });
  }

  screenshot(clip?: { x: number; y: number; width: number; height: number }): Effect.Effect<string, BrowserError> {
    return this.wrap("screenshot", async () => {
      const params: Record<string, unknown> = { format: "png", captureBeyondViewport: false };
      if (clip) params.clip = { ...clip, scale: 1 };
      const result = (await this.cdp.send("Page.captureScreenshot", params)) as { data?: string };
      if (!result.data) throw new Error("empty screenshot");
      return result.data;
    });
  }

  imageDiff(before: string, after: string): Effect.Effect<{ changed: number; ratio: number; box: { x: number; y: number; width: number; height: number } | null }, BrowserError> {
    return this.evalJs(`(${DIFF})(${JSON.stringify({ before, after })})`).pipe(
      Effect.map((value) => JSON.parse(String(value)) as { changed: number; ratio: number; box: { x: number; y: number; width: number; height: number } | null })
    );
  }

  isOpen(): boolean {
    return this.cdp.isOpen();
  }

  close(): Effect.Effect<void> {
    return Effect.promise(async () => {
      try {
        this.cdp.close();
      } catch {}
      this.chrome.kill("SIGKILL");
      await sleep(300);
      try {
        rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {}
    });
  }
}
