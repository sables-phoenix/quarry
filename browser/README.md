# quarry browser

a semantic state layer for browser agents, written in typescript on effect 4. it runs chrome over cdp, turns the page into a small scoped state, and returns deltas instead of screenshots.

## why

an accessibility snapshot of mdn is about 23,000 tokens. a screenshot is 1,366. a scoped state is about 1,288, and a delta after one click is 7 to 40. on large pages the state wins by 15x to 44x over a snapshot agent, and replay costs 10 tokens with no model call.

## what it does

- scoped state: keeps headings, text blocks, controls, dialogs, and live regions inside the main landmark.
- stable ids: a node id comes from its role and label, not its dom position, so scrolling does not change identity.
- deltas: groups added, removed, and changed nodes, and samples names for bulk changes.
- projection: returns only the nodes that match a question.
- state graph: records action edges between state hashes and can replay a shortest path to a known state with no model call.
- replay: runs a recorded flow and returns only a witness on failure.

## tools

| tool | does |
| --- | --- |
| `browser_open` | open a url and return the scoped state |
| `browser_state` | return the current state and hash |
| `browser_project` | return only nodes matching a query |
| `browser_act` | run typed steps and return the delta |
| `browser_assert` | check typed assertions |
| `browser_replay` | run a flow and return pass, or a witness |
| `browser_jump` | reach a recorded hash by the shortest known path |

## use

```bash
npm --prefix browser install
npm --prefix browser run build
node browser/dist/cli.js state https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching
node browser/dist/cli.js act https://example.com '[{"op":"click","role":"button","name":"save"}]'
node browser/dist/cli.js project https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching --query "etag"
node browser/dist/cli.js replay flow.json
node browser/dist/cli.js mcp
```

set `CHROME` to the browser binary when it is not `chrome-headless-shell` on `path`.

mcp config for opencode:

```jsonc
{
  "mcp": {
    "quarry-browser": {
      "type": "local",
      "command": ["node", "/absolute/path/to/quarry/browser/dist/cli.js", "mcp"],
      "enabled": true
    }
  }
}
```

## measured

19 local flows, first run and replay:

| arm | total tokens |
| --- | --- |
| scoped state, first run | 2,197 |
| dom snapshot per step | 3,124 |
| screenshot per step | 81,960 |
| replay | 190 |

10 real flows on 4 sites, state graph against chrome devtools mcp:

| metric | value |
| --- | --- |
| answer found | 10 of 10 |
| median token ratio | 30.3x |
| total token ratio | 23.7x |
| range | 13.8x to 43.4x |
| model calls | 30 vs 20 vs 0 on replay |

run `node bench/real-flows.mjs` from this directory after `npm run build`.

## live site: klawva

one flow on `https://klawva.xyz`: employees, cv tailor, hire, fill the brief, select 24 hours, stop before payment. 5 runs per arm, same event waits.

| arm | observation tokens, o200k | tool time, median | observations | tool calls |
| --- | --- | --- | --- | --- |
| chrome devtools mcp, snapshot per step | 4,164 | 2.73 s | 4 | 18 |
| quarry first run, batched | 454 | 2.25 s | 7 | 8 |
| quarry replay | 1 | 1.53 s | 1 | 1 |

tokens are exact counts from the o200k tokenizer on the text content field. action confirmation strings and structured content are excluded on both sides. first run is 9.17x fewer tokens than the chrome arm. replay is 4,164x fewer and 454x fewer than the first run.

model latency was not measured. no end-to-end number is claimed.

caveats. the actions were scripted, not chosen by a model. the chrome snapshots contain every control while quarry's deltas are summaries, so a real model may need more state than 454 tokens. separate browsers, one machine, one flow.

the older `chars / 4` numbers are in `bench/klawva.json` as history. evidence: `bench/klawva-checkout.png`. no payment was made.

## limits

- chrome is required. the driver is node, not the rust binary.
- no cross-origin iframes, uploads, or shadow dom beyond the open root.
- volatile nodes inside the scoped region can produce noisy deltas.
- projection returns nothing when the words are absent. use the state or an outline instead.
- the state graph is local and capped at 1,000 states.

## test

```bash
npm --prefix browser test
```

the integration test runs 19 flows twice and checks that a wrong assertion fails with a witness.
