# quarry

a web access layer for coding agents.

quarry is a single rust binary and an mcp server that sits between an agent and the web. it searches, fetches, caches, and extracts pages, then hands back only the text the agent needs. it works with opencode, claude code, codex, and any client that speaks mcp.

## why

coding agents pay for the web in tokens, round trips, and wall clock. the built-in tools mostly hand back whole pages, one url per call, with no shared cache. quarry fixes the three costs that dominate:

| cost | current tools | quarry |
| --- | --- | --- |
| tokens per page | full page or raw html | extracted text, or just the matching sections |
| repeat reads | network every time | local cache, zero network on hit |
| round trips | one search result at a time | batch and research in one call |

## measured

20 live documentation pages, fetched cold then warm. the baseline is the same page reduced to visible text with scripts and styles removed, which is what a careful fetch tool already gives an agent.

| metric | value |
| --- | --- |
| median tokens, quarry vs visible text | 1.06x fewer |
| median tokens, quarry vs raw html | 16.2x fewer |
| extracted text vs full page | 1.9x fewer on articles, 1.1x on docs |
| cold fetch, p50 | 120 ms |
| warm cache fetch, p50 | 17 ms |
| warm cache network bytes | 0 |
| ten urls, one batch call vs ten fetches | 4x faster |
| tokens vs a hosted reader (jina), median | 1.65x fewer |

full-page extraction alone is not where the win is. selection is. given one question per page, quarry returns the matching sections instead of the page:

| metric | value |
| --- | --- |
| cases | 10 |
| answer present in the returned text | 10 of 10 |
| median token reduction per question | 4.9x |
| total token reduction across the set | 9.3x |
| best case | 35x, the node.js fs page |

see `results.md` for the method and every row.

## install

```bash
cargo install --path .
```

that puts `quarry` in `~/.cargo/bin`. move it anywhere on `PATH`.

## use it as an mcp server

opencode, in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "quarry": {
      "type": "local",
      "command": ["quarry", "mcp"],
      "enabled": true
    }
  }
}
```

claude code:

```bash
claude mcp add quarry -- quarry mcp
```

codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.quarry]
command = "quarry"
args = ["mcp"]
```

## tools

| tool | what it does |
| --- | --- |
| `web_search` | ranked results with title, url, snippet |
| `web_fetch` | one url to clean text, cached |
| `web_batch` | up to 20 urls in parallel, cached |
| `web_outline` | heading tree with anchors and token counts |
| `web_section` | one section by anchor |
| `web_ask` | the sections of one page that match a question |
| `web_research` | search, fetch, and return matching sections in one call |

## cli

```bash
quarry fetch https://docs.rs/serde/latest/serde/
quarry fetch https://react.dev/reference/react/useState --links
quarry outline https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching
quarry section https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching --anchor validation
quarry ask https://nodejs.org/api/fs.html -q "read a file synchronously"
quarry batch https://a.example https://b.example --json
quarry research "how does http etag revalidation work" -k 4
quarry cache stats
quarry cache clear
```

every command takes `--json` and prints the full record, including cache state, bytes, timings, and token estimates.

## how it works

```text
request [1]
├── normalize and guard [1a] ← http and https only, private addresses refused
├── cache lookup [1b]
│   ├── fresh hit [1b1] ← zero network
│   └── stale or miss [1b2]
│       ├── conditional GET [1b2a] ← etag, if-modified-since
│       └── full GET [1b2b] ← 5 MB cap, 25 s timeout
├── content gate [1c] ← html, json, text, xml only
├── extract [1d]
│   ├── drop chrome [1d1] ← nav, footer, script, skip links
│   ├── score candidates [1d2] ← text density, link density, headings
│   └── render text [1d3] ← headings, lists, code fences, tables
└── select or return [1e] ← outline anchors, question ranking
```

the extractor is a small readability-style scorer, not a full browser. it works on server-rendered html. pages that render client side come back flagged with `needs_browser: true` instead of pretending to be empty.

## search providers

quarry uses the first key it finds, then falls back to duckduckgo lite and bing:

| provider | env |
| --- | --- |
| brave | `BRAVE_API_KEY` |
| exa | `EXA_API_KEY` |
| tavily | `TAVILY_API_KEY` |
| duckduckgo | none |
| bing | none |

## browser state

`browser/` is a shipped node package and mcp server that drives chrome over cdp and returns semantic state instead of screenshots. the design memo is in `browser.md`.

19 local flows, first run and replay:

| arm | total tokens |
| --- | --- |
| scoped state, first run | 1,842 |
| dom snapshot per step | 3,124 |
| screenshot per step | 81,960 |
| replay | 19 |

real pages, 10 flows across 4 apps, state graph against chrome devtools mcp:

| metric | value |
| --- | --- |
| flows with the answer found | 10 of 10 |
| median token ratio | 21.6x |
| total token ratio | 16.7x |
| range | 10.2x to 31.7x |
| model calls, devtools vs state graph vs replay | 30 vs 20 vs 0 |
| median tool time | 1.8 s per flow |

replay returns 1 token and zero model calls.

a live run on klawva.xyz, hiring flow up to checkout, 5 runs per arm, exact o200k tokens:

| arm | observation tokens | tool time | observations |
| --- | --- | --- | --- |
| chrome devtools mcp | 4,164 | 2.73 s | 4 |
| quarry first run | 454 | 2.25 s | 7 |
| quarry replay | 1 | 1.53 s | 1 |

actions were scripted and model latency was not measured.

details and the checkout screenshot are in `bench/browser/`.

 a changed page string is caught with a 53 token witness.

```bash
npm --prefix browser run build
node browser/dist/cli.js mcp
```

## security

- only `http` and `https` are fetched.
- private, loopback, link-local, and unique-local addresses are refused, including on redirects. set `QUARRY_ALLOW_PRIVATE=1` to opt out for local development.
- no cookies, no stored credentials, no javascript execution.
- responses are capped at 5 MB, requests at 25 seconds.
- the cache is local, keyed by url hash, and holds decoded bodies only.

## limits

- no browser rendering yet. js shells are flagged, not rendered.
- section ranking is lexical, not semantic. it fails when the question and the page use different words.
- `chars / 4` is a token estimate. it is exact enough for budgets, not for billing.
- robots.txt is not consulted. quarry fetches urls an agent asks for, one at a time, with a per-domain limit of four concurrent requests.

## verification

```bash
cargo build --release
scripts/verify.sh
```

`scripts/verify.sh` drives the real binary: cache miss then hit, ssrf refusal, batch, mcp initialize and tools, cache control, unit tests, and the benchmark gate. the project skill `.opencode/skills/verify-quarry/SKILL.md` describes the same run for an agent.

## license

mit
