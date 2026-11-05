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

## browser, 10 page checks on 4 pages

| metric | value |
| --- | --- |
| checks | 10 |
| pages | 4 |
| pass | 10 |
| median | 5.3x |
| total | 4.7x |
| range | 2.6x to 16.5x |

## browser, cross-page flows

| metric | value |
| --- | --- |
| flows | 4 |
| pass | 4 |

## observation ladder

| metric | value |
| --- | --- |
| flows | 4 |
| ladder tokens | 3357 |
| full frame per step | 10928 |
| crops | 2 |

## klawva hiring flow, quarry arms

| arm | tokens | tool time | runs |
| --- | --- | --- | --- |
| first run | 624 | 2132 ms | 5 |
| replay | 1 | 1919 ms | 5 |

chrome devtools baseline on the same flow: 4164 tokens, 2734 ms.

## model-driven, open-ended

one task, one model, no steps given, 3 runs per arm. supermemory disabled on both arms.

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | 180.0 s | $0.028355 | 49019 | 1/3 |
| chrome devtools | 20.0 s | $0.005274 | 18725 | 3/3 |

chrome wins the open-ended task. quarry timed out twice at checkout.

## model-driven, known flow

same task, steps supplied, 3 runs per arm.

| arm | wall, median | cost, median | success |
| --- | --- | --- | --- |
| quarry | 12.5 s | $0.001953 | 3/3 |
| chrome devtools | 49.0 s | $0.009008 | 3/3 |

## text vs built-in webfetch

one question, 3 runs per arm, same model.

| arm | correct | wall, median | input tokens, median | cost, median |
| --- | --- | --- | --- | --- |
| quarry | 2/3 | 8.6 s | 9085 | $0.001827 |
| opencode webfetch | 3/3 | 6.7 s | 14835 | $0.002251 |

quarry was cheaper but slower and one run answered the wrong header. this is the honest result.

## browser-only pages

| metric | value |
| --- | --- |
| pages | 3 |
| text unusable | 1 |
| quarry text tokens | 2589 |
| browser state tokens | 7484 |

only excalidraw needed a browser. linear and notion were cheaper through the text layer.

## caveats

- the 10 page checks are exact o200k for one capture run. the sample is 10 checks on 4 pages.
- the real-flow and klawva baselines were measured once through chrome devtools mcp. the quarry arms are scripted, not model-chosen. the model-driven section is a separate run.
- browser image tokens use the 1,366-token frame formula and the crop area formula, not a tokenizer.
- network latency varies. tool time is measured, model latency is not.
