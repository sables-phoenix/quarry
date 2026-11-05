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

one flow on `https://klawva.xyz`: employees, cv tailor, hire, fill the brief, select 24 hours, stop before payment. same steps and waits on both arms, separate browser instances.

| arm | tokens | tool time | model calls |
| --- | --- | --- | --- |
| chrome devtools mcp, snapshot per step | 4,851 | 9.9 s | 11 |
| quarry, first run | 826 | 9.2 s | 8 |
| quarry, replay | 10 | 9.0 s | 0 |

first run: 5.9x fewer tokens and about even on tool time. replay: 485x fewer tokens and zero model calls. with a 1.5 s model call the end-to-end estimate is 26.4 s for devtools, 21.2 s for the first quarry run, and 9.0 s for replay.

the replay time is about the same because the waits dominate. its win is tokens and model calls.

evidence: `bench/klawva.json` and `bench/klawva-checkout.png`. no payment was made.

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
