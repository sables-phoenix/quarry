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
const textAgent = JSON.parse(readFileSync(new URL("./agent/text-results.json", import.meta.url), "utf8")) as { quarry: { correct: number; median_wall_ms: number; median_input_tokens: number; median_cost_usd: number }; webfetch: { correct: number; median_wall_ms: number; median_input_tokens: number; median_cost_usd: number } };
const jsPages = load("./browser/js-pages.json");
const ladder = load("./browser/ladder.json");
const playbook = JSON.parse(readFileSync(new URL("./playbook.json", import.meta.url), "utf8")) as { replay_summary: { flows: number; runs: number; ok: number }; replay: Array<{ name: string; median_ms: number; tokens: number }>; retrieval: { with_site_hint: { top3: number } } };
const livingbrain = JSON.parse(readFileSync(new URL("./livingbrain.json", import.meta.url), "utf8")) as { status: string; reason?: string; exact_matches?: number; search?: { top3?: number } };
const nav = load("./browser/nav-flows.json");
const agent = JSON.parse(readFileSync(new URL("./agent/results.json", import.meta.url), "utf8")) as {
  guided: {
    quarry: { median_wall_ms: number; median_cost_usd: number; median_input_tokens: number; success: number };
    chrome: { median_wall_ms: number; median_cost_usd: number; median_input_tokens: number; success: number };
  };
  open: { quarry: { median_wall_ms: number; median_cost_usd: number; median_input_tokens: number; success: number }; chrome: { median_wall_ms: number; median_cost_usd: number; median_input_tokens: number; success: number } };
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

## browser, 10 page checks on 4 pages

| metric | value |
| --- | --- |
| checks | ${real.summary.checks} |
| pages | ${real.summary.pages} |
| pass | ${real.summary.ok} |
| median | ${real.summary.median_ratio}x |
| total | ${real.summary.total_ratio}x |
| range | ${real.summary.min_ratio}x to ${real.summary.max_ratio}x |

## browser, cross-page flows

| metric | value |
| --- | --- |
| flows | ${nav.summary.flows} |
| pass | ${nav.summary.ok} |

## observation ladder

| metric | value |
| --- | --- |
| flows | ${ladder.summary.flows} |
| ladder tokens | ${ladder.summary.ladder_total} |
| full frame per step | ${ladder.summary.screenshot_total} |
| crops | ${ladder.summary.crops} |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | ${klawva.quarry_first.tokens} | ${klawva.quarry_first.median_ms} ms | 5 |
| replay | ${klawva.quarry_replay.tokens} | ${klawva.quarry_replay.median_ms} ms | 5 |

chrome devtools baseline on the same flow: ${klawva.chrome.tokens} tokens, ${klawva.chrome.median_ms} ms.

## playbook memory

| metric | value |
| --- | --- |
| flows | ${playbook.replay_summary.flows} |
| replays | ${playbook.replay_summary.runs} |
| pass | ${playbook.replay_summary.ok} |
| klawva median | ${playbook.replay.find((row) => row.name === "klawva")?.median_ms ?? 0} ms |
| tokens per replay | ${playbook.replay[0]?.tokens ?? 0} |
| retrieval top 3 with site hint | ${playbook.retrieval.with_site_hint.top3} |

## living brain

| metric | value |
| --- | --- |
| status | ${livingbrain.status} |
| reason | ${livingbrain.reason ?? ""} |
| exact matches | ${livingbrain.exact_matches ?? "not run"} |
| search top 3 | ${livingbrain.search?.top3 ?? "not run"} |

## model-driven, open-ended

one task, one model, no steps given, 3 runs per arm. supermemory disabled on both arms.

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | ${(agent.open.quarry.median_wall_ms / 1000).toFixed(1)} s | $${agent.open.quarry.median_cost_usd} | ${agent.open.quarry.median_input_tokens} | ${agent.open.quarry.success}/3 |
| chrome devtools | ${(agent.open.chrome.median_wall_ms / 1000).toFixed(1)} s | $${agent.open.chrome.median_cost_usd} | ${agent.open.chrome.median_input_tokens} | ${agent.open.chrome.success}/3 |

chrome wins the open-ended task. one quarry run timed out at checkout.

## model-driven, known flow

same task, steps supplied, 3 runs per arm. this measures execution, not planning.

| arm | wall, median | cost, median | success |
| --- | --- | --- | --- |
| quarry | ${(agent.guided.quarry.median_wall_ms / 1000).toFixed(1)} s | $${agent.guided.quarry.median_cost_usd} | ${agent.guided.quarry.success}/3 |
| chrome devtools | ${(agent.guided.chrome.median_wall_ms / 1000).toFixed(1)} s | $${agent.guided.chrome.median_cost_usd} | ${agent.guided.chrome.success}/3 |

## text vs built-in webfetch

one question, 3 runs per arm, same model.

| arm | correct | wall, median | input tokens, median | cost, median |
| --- | --- | --- | --- | --- |
| quarry | ${textAgent.quarry.correct}/3 | ${(textAgent.quarry.median_wall_ms / 1000).toFixed(1)} s | ${textAgent.quarry.median_input_tokens} | $${textAgent.quarry.median_cost_usd} |
| opencode webfetch | ${textAgent.webfetch.correct}/3 | ${(textAgent.webfetch.median_wall_ms / 1000).toFixed(1)} s | ${textAgent.webfetch.median_input_tokens} | $${textAgent.webfetch.median_cost_usd} |

quarry was cheaper but slower and one run answered the wrong header. this is the honest result.

## browser-only pages

| metric | value |
| --- | --- |
| pages | ${jsPages.summary.pages} |
| text unusable | ${jsPages.summary.text_unusable} |
| quarry text tokens | ${jsPages.summary.text_total} |
| browser state tokens | ${jsPages.summary.state_total} |

only excalidraw needed a browser. linear and notion were cheaper through the text layer.

## caveats

- the 10 page checks are exact o200k for one capture run. the sample is 10 checks on 4 pages.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen. the model-driven section is a separate run.
- browser image tokens use the 1,366-token frame formula and the crop area formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
`;

writeFileSync(new URL("./SUMMARY.md", import.meta.url), md);
console.log("wrote bench/SUMMARY.md");
