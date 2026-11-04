import { Browser } from "./browser.mjs";
import { createHash } from "node:crypto";

const BASE = "http://127.0.0.1:8899";
const SCREENSHOT_TOKENS = 1366;

const FLOWS = [
  {
    name: "login",
    url: `${BASE}/login.html`,
    steps: [
      { op: "fill", role: "email", name: "email", value: "ada@example.com" },
      { op: "fill", role: "password", name: "password", value: "correct-horse" },
      { op: "click", role: "button", name: "continue" },
    ],
    asserts: [{ op: "text", value: "welcome back" }],
  },
  {
    name: "increment",
    url: `${BASE}/dashboard.html`,
    steps: [
      { op: "click", role: "button", name: "increment" },
      { op: "click", role: "button", name: "increment" },
    ],
    asserts: [{ op: "text", value: "2" }],
  },
  {
    name: "filter",
    url: `${BASE}/list.html`,
    steps: [{ op: "fill", role: "textbox", name: "filter", value: "item 4" }],
    asserts: [{ op: "count", selector: "#ul li:not([hidden])", value: 11 }],
  },
  {
    name: "chart",
    url: `${BASE}/visual.html`,
    steps: [{ op: "click", role: "button", name: "regenerate" }],
    asserts: [{ op: "image_changed" }],
  },
];

async function hashShot(b) {
  const png = await b.shot();
  return createHash("sha1").update(png).digest("hex");
}

async function armScreenshot(b, flow) {
  await b.navigate(flow.url);
  let tokens = 0;
  let ms = 0;
  let prev = await hashShot(b);
  tokens += SCREENSHOT_TOKENS;
  for (const step of flow.steps) {
    const r = await b.act([step], 150);
    ms += r.ms;
    await hashShot(b);
    tokens += SCREENSHOT_TOKENS;
  }
  const results = await b.assert(flow.asserts.filter((a) => a.op !== "image_changed"));
  if (flow.asserts.some((a) => a.op === "image_changed")) {
    const now = await hashShot(b);
    results.push({ ok: now !== prev, kind: "image", value: "changed" });
  }
  return { tokens, ms: Math.round(ms), ok: results.every((r) => r.ok), model_steps: flow.steps.length + 1 };
}

async function armLadder(b, flow) {
  await b.navigate(flow.url);
  let tokens = 0;
  let ms = 0;
  const fp = await b.fingerprint();
  const acts = await b.actions(40);
  tokens += fp.tokens + acts.tokens;
  await b.text();
  b.lastShot = await b.shot();
  const prev = createHash("sha1").update(b.lastShot).digest("hex");
  let prevUrl = fp.raw.url;
  for (const step of flow.steps) {
    const r = await b.act([step], 150);
    ms += r.ms;
    const fp2 = await b.fingerprint();
    tokens += fp2.tokens;
    const delta = await b.textDelta();
    tokens += delta.tokens;
    if (delta.tokens === 0 && fp2.raw.url === prevUrl) {
      const img = await b.imageDelta();
      tokens += img.tokens;
    }
    prevUrl = fp2.raw.url;
  }
  const results = await b.assert(flow.asserts.filter((a) => a.op !== "image_changed"));
  if (flow.asserts.some((a) => a.op === "image_changed")) {
    const now = await hashShot(b);
    results.push({ ok: now !== prev, kind: "image", value: "changed" });
  }
  return { tokens, ms: Math.round(ms), ok: results.every((r) => r.ok), model_steps: 1 };
}

async function armReplay(b, flow, steps) {
  await b.navigate(flow.url);
  const t0 = performance.now();
  const r = await b.act(steps, 250);
  const results = await b.assert(flow.asserts.filter((a) => a.op !== "image_changed"));
  const ms = performance.now() - t0;
  let tokens = 10;
  if (!r.ok || results.some((x) => !x.ok)) {
    const delta = await b.textDelta();
    tokens += delta.tokens + 50;
  }
  return { tokens, ms: Math.round(ms), ok: r.ok && results.every((x) => x.ok), model_steps: 0 };
}

const b = await Browser.launch();
const out = { boot_ms: Math.round(b.bootMs), flows: [] };

for (const flow of FLOWS) {
  const a = await armScreenshot(b, flow);
  const l = await armLadder(b, flow);
  const cRuns = [];
  for (let i = 0; i < 10; i++) cRuns.push(await armReplay(b, flow, flow.steps));
  const c = {
    tokens: cRuns[0].tokens,
    ms: Math.round(cRuns.reduce((x, r) => x + r.ms, 0) / cRuns.length),
    ok: cRuns.every((r) => r.ok),
    model_steps: 0,
    runs: cRuns.length,
  };
  out.flows.push({ name: flow.name, screenshot: a, ladder: l, replay: c });
}

const broken = await armReplay(b, { ...FLOWS[0], url: `${BASE}/login.html?break=1` }, FLOWS[0].steps);
out.replay_catches_regression = !broken.ok;
out.regression_tokens = broken.tokens;

await b.close();
console.log(JSON.stringify(out, null, 2));
