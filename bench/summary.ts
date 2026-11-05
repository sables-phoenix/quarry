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
const klawva = JSON.parse(readFileSync(new URL("./browser/klawva-quarry.json", import.meta.url), "utf8")) as { first: { tokens: number; median_ms: number }; replay: { tokens: number; median_ms: number } };
const klawvaSite = load("./browser/klawva.json");

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

## browser, 19 local flows

| metric | value |
| --- | --- |
| flows | ${fixtures.summary.flows} |
| pass | ${fixtures.summary.ok} |
| first run tokens | ${fixtures.summary.first_total} |
| replay tokens | ${fixtures.summary.replay_total} |
| screenshot per step tokens | ${fixtures.summary.screenshot_total} |

## browser, 10 real flows

| metric | value |
| --- | --- |
| flows | ${real.summary.flows} |
| pass | ${real.summary.ok} |
| median | ${real.summary.median_ratio}x |
| total | ${real.summary.total_ratio}x |
| range | ${real.summary.min_ratio}x to ${real.summary.max_ratio}x |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | ${klawva.first.tokens} | ${klawva.first.median_ms} ms | 5 |
| replay | ${klawva.replay.tokens} | ${klawva.replay.median_ms} ms | 5 |

chrome devtools baseline on the same flow: ${(klawvaSite as any).exact_o200k?.chrome_devtools?.tokens ?? "see klawva.json"} tokens, ${(klawvaSite as any).exact_o200k?.chrome_devtools?.median_ms ?? "?"} ms.

## caveats

- the 10 real-flow baselines are chars divided by 4 estimates. the klawva comparison is exact on both sides.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen.
- browser screenshot tokens use the 1,366-token frame formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
`;

writeFileSync(new URL("./SUMMARY.md", import.meta.url), md);
console.log("wrote bench/SUMMARY.md");
