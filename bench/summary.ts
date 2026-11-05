import { readFileSync, writeFileSync } from "node:fs";

type Summary = Record<string, unknown>;

function load(path: string): { summary: Summary; rows?: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { summary: Summary; rows?: Array<Record<string, unknown>> };
}

const text = load("./results.json");
const select = load("./select.json");
const external = load("./external.json");
const fixtures = load("./browser/fixtures.json");
const real = load("./browser/real-flows.json");
const agent = JSON.parse(readFileSync(new URL("./agent/results.json", import.meta.url), "utf8")) as {
  guided: {
    quarry: { median_wall_ms: number; median_cost_usd: number; median_input_tokens: number; success: number };
    chrome: { median_wall_ms: number; median_cost_usd: number; median_input_tokens: number; success: number };
  };
  open: { quarry: { wall_ms: number; cost_usd: number }; chrome: { wall_ms: number; cost_usd: number } };
};
const klawva = JSON.parse(readFileSync(new URL("./browser/klawva.json", import.meta.url), "utf8")) as { chrome: { tokens: number; median_ms: number }; quarry_first: { tokens: number; median_ms: number }; quarry_replay: { tokens: number; median_ms: number } };

const md = `# bench summary

all token counts use the o200k tokenizer on the returned text. no \`chars / 4\` estimates.

## text

| metric | value |
| --- | --- |
| pages | ${text.summary.pages} |
| median vs visible text | ${text.summary.median_text_ratio}x |
| median vs raw html | ${text.summary.median_html_ratio}x |
| total vs visible text | ${text.summary.total_ratio}x |
| cold p50 | ${text.summary.cold_ms_p50} ms |
| warm p50 | ${text.summary.warm_ms_p50} ms |

## selection

| metric | value |
| --- | --- |
| cases | ${select.summary.cases} |
| recall | ${select.summary.recall} |
| median | ${select.summary.median_ratio}x |
| total | ${select.summary.total_ratio}x |

## hosted reader

| metric | value |
| --- | --- |
| pages | ${external.summary.urls} |
| median token ratio vs jina | ${external.summary.median_token_ratio}x |
| losses | ${(external.rows ?? [])
  .filter((row) => typeof row.token_ratio === "number")
  .sort((a, b) => (a.token_ratio as number) - (b.token_ratio as number))
  .slice(0, 2)
  .map((row) => `${String(row.url).replace("https://", "").split("/")[0]} ${row.token_ratio}x`)
  .join(", ")} |

## browser, 19 local flows

| metric | value |
| --- | --- |
| flows | ${fixtures.summary.flows} |
| pass | ${fixtures.summary.ok} |
| first run tokens | ${fixtures.summary.first_total} |
| replay tokens | ${fixtures.summary.replay_total} |
| screenshot formula, one frame per step | ${fixtures.summary.screenshot_total} |

## browser, 10 real flows

| metric | value |
| --- | --- |
| tasks | ${real.summary.flows} |
| pages | 4 |
| pass | ${real.summary.ok} |
| median | ${real.summary.median_ratio}x |
| total | ${real.summary.total_ratio}x |
| range | ${real.summary.min_ratio}x to ${real.summary.max_ratio}x |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | ${klawva.quarry_first.tokens} | ${klawva.quarry_first.median_ms} ms | 5 |
| replay | ${klawva.quarry_replay.tokens} | ${klawva.quarry_replay.median_ms} ms | 5 |

chrome devtools baseline on the same flow: ${klawva.chrome.tokens} tokens, ${klawva.chrome.median_ms} ms.

## model-driven

one task, one model, guided execution, 3 runs per arm.

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | ${(agent.guided.quarry.median_wall_ms / 1000).toFixed(1)} s | $${agent.guided.quarry.median_cost_usd} | ${agent.guided.quarry.median_input_tokens} | ${agent.guided.quarry.success}/3 |
| chrome devtools | ${(agent.guided.chrome.median_wall_ms / 1000).toFixed(1)} s | $${agent.guided.chrome.median_cost_usd} | ${agent.guided.chrome.median_input_tokens} | ${agent.guided.chrome.success}/3 |

open-ended, one run each: quarry ${(agent.open.quarry.wall_ms / 1000).toFixed(1)} s and $${agent.open.quarry.cost_usd}, chrome ${(agent.open.chrome.wall_ms / 1000).toFixed(1)} s and $${agent.open.chrome.cost_usd}. the quarry open run used a recorded flow from supermemory.

## caveats

- the 10 real-flow baselines are exact o200k for one capture run. the sample is 10 tasks on 4 pages.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen. the model-driven section is a separate run.
- browser screenshot tokens use the 1,366-token frame formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
`;

writeFileSync(new URL("./SUMMARY.md", import.meta.url), md);
console.log("wrote bench/SUMMARY.md");
