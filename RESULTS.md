# results

two benchmarks, run on 2026-11-04 from a 4-core arm64 ubuntu 24.04 machine on a residential connection. every number comes from `bench/bench.py` and `bench/select.py`. raw rows are in `bench/results.json` and `bench/select.json`.

## what was measured

### full page fetch

20 documentation pages, cold then warm, against two baselines:

1. visible text: the page with scripts, styles, and tags removed, collapsed to one line. this is what a careful fetch tool already gives an agent.
2. raw html: the bytes the server returned.

quarry's row is the extracted markdown with links dropped.

### question answering

10 pages, one question each, with a required answer string. the baseline is the full page text. the quarry row is `quarry ask`, which returns the top three matching sections. a case counts as a hit only when the answer string appears in the returned text.

## full page results

| metric | value |
| --- | --- |
| pages with a usable baseline | 19 of 20 |
| median tokens, quarry vs visible text | 1.15x fewer |
| median tokens, quarry vs raw html | 13.24x fewer |
| total chars, quarry vs visible text | 1.08x fewer |
| cold fetch, p50 | 72.5 ms |
| warm cache fetch, p50 | 24.4 ms |
| warm cache network bytes | 0 |
| pages flagged as js shells | 0 |

the one missing baseline is postgresql.org, where python's tls handshake timed out. quarry fetched it fine.

full page extraction is not a token win on documentation. documentation pages are mostly content already, so removing navigation and footers only trims about 13 percent. the large reduction is against raw html, and against article-shaped pages where boilerplate dominates. wikipedia's https article went from 40,227 chars of visible text to 21,593, a 1.86x cut. react's reference page went from 26,090 to 23,673.

the win that matters for an agent is selection, not compression.

## selection results

| metric | value |
| --- | --- |
| cases | 10 |
| answer present in returned text | 10 of 10 |
| median token reduction per question | 4.83x |
| total token reduction across the set | 8.18x |
| best case | 35.4x, node.js fs |

per case:

| page | full tokens | selected tokens | ratio | answer found |
| --- | --- | --- | --- | --- |
| nodejs fs | 70,733 | 2,000 | 35.4x | yes |
| postgres select | 16,301 | 1,874 | 8.7x | yes |
| mdn caching | 8,554 | 1,215 | 7.0x | yes |
| github rest | 8,894 | 1,359 | 6.5x | yes |
| typescript generics | 5,681 | 1,163 | 4.9x | yes |
| rust ownership | 6,797 | 1,422 | 4.8x | yes |
| sqlite select | 9,213 | 1,963 | 4.7x | yes |
| docker networking | 3,214 | 1,474 | 2.2x | yes |
| web.dev rendering | 2,692 | 1,974 | 1.4x | yes |
| kubernetes overview | 2,535 | 2,004 | 1.3x | yes |

pages under 12,000 chars are returned whole. selection only pays off on large pages, and a wrong section is worse than a full page.

## how to reproduce

```bash
cargo build --release
python3 bench/bench.py
python3 bench/select.py
```

both scripts print a json summary and write their raw rows next to themselves. they use the live web, so absolute latencies move with the network. ratios are stable because both arms see the same page.

## what these numbers do not prove

- no end-to-end agent task was run. these measure the payload a tool returns, not whether an agent finishes a task faster.
- one machine, one network, one day.
- token counts are `chars / 4`, not a tokenizer. see `research/extraction.md` for why that is within about 20 percent for english prose and up to 2x off for code.
- search quality is not scored. the selection benchmark gives quarry the url directly.
- the cache benchmark measures a process that starts, reads the cache, and exits. a long-lived mcp server keeps the cache warm in memory and should be faster than 24 ms.
