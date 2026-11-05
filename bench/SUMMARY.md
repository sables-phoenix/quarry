# bench summary

all token counts use the o200k tokenizer on the returned text. no `chars / 4` estimates.

## text

| metric | value |
| --- | --- |
| pages | 20 |
| median vs visible text | 1.06x |
| median vs raw html | 16.18x |
| total vs visible text | 1x |
| cold p50 | 120 ms |
| warm p50 | 17 ms |

## selection

| metric | value |
| --- | --- |
| cases | 10 |
| recall | 1 |
| median | 4.86x |
| total | 9.25x |

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
| median | 21.6x |
| total | 16.7x |
| range | 10.2x to 31.7x |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | 454 | 2134 ms | 5 |
| replay | 1 | 2139 ms | 5 |

chrome devtools baseline on the same flow: 4164 tokens, 2734 ms.

## caveats

- the 10 real-flow baselines are chars divided by 4 estimates. the klawva comparison is exact on both sides.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen.
- browser screenshot tokens use the 1,366-token frame formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
