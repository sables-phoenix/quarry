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

## browser, 19 local flows

| metric | value |
| --- | --- |
| flows | 19 |
| pass | 19 |
| first run tokens | 1842 |
| replay tokens | 19 |
| screenshot per step tokens | 81960 |

## browser, 10 real flows

| metric | value |
| --- | --- |
| flows | 10 |
| pass | 10 |
| median | 19.5x |
| total | 20.5x |
| range | 12.6x to 39x |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | 454 | 2104 ms | 5 |
| replay | 1 | 1476 ms | 5 |

chrome devtools baseline on the same flow: 4164 tokens, 2734 ms.

## model-driven

one task, one model, guided execution, 3 runs per arm.

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | 17.7 s | $0.00181 | 6,768 | 3/3 |
| chrome devtools | 49.0 s | $0.00901 | 24,638 | 3/3 |

open-ended, one run each: quarry 15.6 s and $0.00288, chrome 119.5 s and $0.01368. the quarry open run used a recorded flow from supermemory.

## caveats

- the 10 real-flow baselines are chars divided by 4 estimates. the klawva comparison is exact on both sides.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen.
- browser screenshot tokens use the 1,366-token frame formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
