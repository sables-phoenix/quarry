# bench summary

all token counts use the o200k tokenizer on the returned text. no `chars / 4` estimates.

## text

| metric | value |
| --- | --- |
| pages | 20 |
| median vs visible text | 1.06x |
| median vs raw html | 16.18x |
| total vs visible text | 1x |
| cold p50 | 94 ms |
| warm p50 | 16.5 ms |

## selection

| metric | value |
| --- | --- |
| cases | 10 |
| recall | 1 |
| median | 5.75x |
| total | 10.21x |

## hosted reader

| metric | value |
| --- | --- |
| pages | 6 |
| median token ratio vs jina | 1.65x |
| losses | nodejs.org 0.71x, developer.mozilla.org 0.96x |

## browser, 19 local flows

| metric | value |
| --- | --- |
| flows | 19 |
| pass | 19 |
| first run tokens | 2821 |
| replay tokens | 19 |
| screenshot formula, one frame per step | 81960 |

## browser, 10 real flows

| metric | value |
| --- | --- |
| tasks | 10 |
| pages | 4 |
| pass | 10 |
| median | 5.4x |
| total | 4.9x |
| range | 2.6x to 15.7x |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | 624 | 2132 ms | 5 |
| replay | 1 | 1919 ms | 5 |

chrome devtools baseline on the same flow: 4164 tokens, 2734 ms.

## model-driven

one task, one model, guided execution, 3 runs per arm.

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | 12.5 s | $0.001953 | 7341 | 3/3 |
| chrome devtools | 49.0 s | $0.009008 | 24638 | 3/3 |

open-ended, one run each: quarry 17.5 s and $0.002477, chrome 119.5 s and $0.013676. the quarry open run used a recorded flow from supermemory.

## caveats

- the 10 real-flow baselines are exact o200k for one capture run. the sample is 10 tasks on 4 pages.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen. the model-driven section is a separate run.
- browser screenshot tokens use the 1,366-token frame formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
