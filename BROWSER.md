# browser verification

token counts use o200k on the returned text. image tokens use the width times height formula.

limits: `limits.md`.

status: shipped as `browser/`, a node package and mcp server. the rust binary keeps the text layer. every number below was measured on this machine on 2026-11-04.

## the finding that changed the design

the obvious plan was to send the accessibility tree instead of screenshots, because text should be cheaper than pixels. that plan is wrong on real pages.

| page | chrome devtools snapshot | quarry state | screenshot at 1280x800 |
| --- | --- | --- | --- |
| mdn http caching | 22,960 tokens | 13,285 tokens | 1,366 tokens |
| react usestate | 20,672 tokens | 23,705 tokens | 1,366 tokens |
| github rust repo | 15,987 tokens | 2,364 tokens | 1,366 tokens |
| wikipedia https | 45,652 tokens | 20,938 tokens | 1,366 tokens |

measured with `chrome-devtools-mcp` `take_snapshot` at the default verbosity, and with `browser_state`. screenshot tokens use the anthropic formula, width times height divided by 750. openai tiles land at 1,105 for the same frame.

the chrome snapshot is 7 to 23 times more expensive than a screenshot on these pages. that is why agents that dump the a11y tree feel slow and expensive, and why agents that take a screenshot every step also feel expensive. neither is the right default.

## what is cheap

four measurements, same pages:

| observation | tokens | notes |
| --- | --- | --- |
| state fingerprint | 32 to 46 | url, title, text length, control count, open dialogs, visible alerts |
| viewport action list | 27 to 521 | visible buttons, links, inputs, capped at 40 |
| text delta | 0 to 155 | only lines added or removed since the last step |
| image crop | 1 to 1,366 | bounding box of changed pixels, full frame only when the change covers it |

the fingerprint is the default observation. most steps in a verification flow change nothing, so most steps should cost about 40 tokens.

## the concept: delta verification

a verification run is a recorded script plus two kinds of evidence.

1. record the flow once: locators, actions, and assertions.
2. on every later run, replay the script with no model in the loop.
3. observe only deltas: text lines that changed, dom assertions that flipped, pixels that moved.
4. escalate observation only when the cheap layer is ambiguous: fingerprint, then actions, then text delta, then cropped image, then the full frame.

the model writes the test once. reruns are deterministic, cheap, and produce a diff a human can read.

## what is new here

each piece exists somewhere. playwright records traces and replays them. percy and applitools diff screenshots in ci. stagehand and browserbase cache actions. chrome devtools mcp exposes an accessibility snapshot. none of them combine the pieces into one per-step observation protocol with a token budget.

shipped: the scoped state, deltas, replay, assertions, the fingerprint, and the cropped-image diff. `browser_fingerprint` returns the default observation, `browser_look` returns a full frame on the first call and a crop when the change is small.

the new part is the ladder itself: a state fingerprint is the default observation, text delta is the second, a cropped pixel diff is the third, and a full frame is the last resort. a recorded flow replays without a model, and the run reports a delta instead of a transcript. the ladder ships in `browser/src/session.ts` and `browser/src/mcp.ts`.

## flow benchmark

four fixture flows, one run each. the current numbers are in `bench/browser/ladder.json`.

| metric | value |
| --- | --- |
| flows | 4 |
| ladder tokens | 7,454 |
| full frame per step | 10,928 |
| crops | 3 |

`full frame per step` charges 1,366 tokens for a full frame after every action, which is what a visual agent does today. the ladder uses a fingerprint, then a text delta, then a crop when the pixel diff is small. image tokens use the area formula, not a tokenizer.

## against chrome devtools mcp on the same fixture

the fixture ladder is cheap on both sides. the real page comparison is the one that matters: a default chrome devtools snapshot of mdn is 22,960 tokens. the measured scoped state is 13,285 to 15,780 tokens across captures, a 1.5x to 1.7x win. react is the loss: 20,672 against 23,705.

the honest rule: the ladder wins when the page is large, when the step is visual, or when the flow repeats. it does not win on open-ended exploration: in the open model run quarry finished 1 of 3 against chrome devtools 3 of 3, and was slower.

## real pages

the current numbers are in `bench/SUMMARY.md`, `bench/browser/real-flows.json`, and `bench/browser/nav-flows.json`. the compression sample is ten page checks on four pages; the navigation sample is four cross-page flows. one capture each, exact o200k on both sides.

## formal model

`formal/Replay.tla` models the protocol: idle, observing, acting, verifying, passed, failed. it checks four invariants with tlc across both a passing and a failing assertion set.

- a pass requires every assertion satisfied
- a full-frame observation requires a crop attempt first
- at most four observations per run
- a failure implies a false assertion

both configurations pass. this is a model of the policy, not a proof of the implementation.

## what is not built

- the browser driver is node. it ships as `browser/dist/cli.js`; it is not in the rust binary.
- locators use role plus visible name. no shadow dom, iframes, or file uploads.
- the pixel threshold is a fixed sum of channel differences. antialiasing can produce false changes.
- no network assertions, no console error assertions, no accessibility audit assertions.
- four fixture flows and four real pages. not a general benchmark.

## next

1. port the driver into the rust binary as a second mode with a warm browser.
2. add `browser_record`, `browser_replay`, and `browser_diff` to the mcp server.
3. benchmark against playwright mcp on the same four flows, including model round trips.
4. make the observation budget a parameter and measure the token and accuracy curve.
