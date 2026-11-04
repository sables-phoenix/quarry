# browser verification

status: prototype. the code is in `browser-probe/`, not in the rust binary yet. every number below was measured on this machine on 2026-11-04.

## the finding that changed the design

the obvious plan was to send the accessibility tree instead of screenshots, because text should be cheaper than pixels. that plan is wrong on real pages.

| page | chrome devtools mcp snapshot | full a11y tree, compacted | screenshot at 1280x800 |
| --- | --- | --- | --- |
| mdn http caching | 18,841 tokens | 39,363 tokens | 1,366 tokens |
| react usestate | 16,039 tokens | 56,611 tokens | 1,366 tokens |
| github rust repo | not measured | 9,605 tokens | 1,366 tokens |
| local login form | 70 tokens | 116 tokens | 1,366 tokens |

measured with `chrome-devtools` mcp `take_snapshot`, and with a cdp probe that serializes the full accessibility tree. screenshot tokens use the anthropic formula, width times height divided by 750. openai tiles land at 1,105 for the same frame.

a full accessibility tree is 7 to 41 times more expensive than a screenshot on documentation pages. that is why agents that dump the a11y tree feel slow and expensive, and why agents that take a screenshot every step also feel expensive. neither is the right default.

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

the new part is the ladder itself: a state fingerprint is the default observation, text delta is the second, a cropped pixel diff is the third, and a full frame is the last resort. a recorded flow replays without a model, and the run reports a delta instead of a transcript. that is the concept worth testing.

## flow benchmark

four flows on a local fixture site. one run each.

| flow | screenshot per step | delta ladder | replay | ladder win | replay win |
| --- | --- | --- | --- | --- | --- |
| login | 5,464 | 191 | 10 | 28.6x | 546x |
| increment twice | 4,098 | 131 | 10 | 31.3x | 410x |
| filter a list | 2,732 | 496 | 10 | 5.5x | 273x |
| visual chart | 2,732 | 264 | 10 | 10.3x | 273x |

`screenshot per step` charges 1,366 tokens for a full frame after every action, which is what a visual agent does today. `delta ladder` is the first run with observation. `replay` is the recorded script returning only assertion results.

the tool time is similar across all three arms, 150 to 460 ms, because the browser work is the same. the wall clock win is the model round trip that replay removes. that was not measured here and should be.

a deliberately broken login page is caught by replay: `replay_catches_regression` is true, and the failure report costs 79 tokens instead of a full page dump.

## against chrome devtools mcp on the same fixture

the same login flow, driven by the `chrome-devtools` mcp server that ships with this environment, with a snapshot after each action:

| arm | tokens |
| --- | --- |
| devtools mcp, snapshot per step | 236 |
| devtools mcp, snapshot plus screenshot per step | 4,334 |
| delta ladder | 191 |
| replay | 10 |

on a tiny local form the snapshot-only baseline is already cheap, so the ladder wins by 1.2x, not 28x. the screenshot arm is the one that loses by 22.7x. on a real page the snapshot arm collapses: mdn is 18,841 tokens per snapshot, versus roughly 567 for the ladder on the same page.

the honest rule: the ladder wins when the page is large, when the step is visual, or when the flow repeats. it does not win much on a small form with a dom-only agent.

## formal model

`formal/Replay.tla` models the protocol: idle, observing, acting, verifying, passed, failed. it checks four invariants with tlc across both a passing and a failing assertion set.

- a pass requires every assertion satisfied
- a full-frame observation requires a crop attempt first
- at most four observations per run
- a failure implies a false assertion

both configurations pass. this is a model of the policy, not a proof of the implementation.

## what is not built

- the browser driver is node. it is not in the rust binary and does not ship in the mcp server yet.
- locators use role plus visible name. no shadow dom, iframes, or file uploads.
- the pixel threshold is a fixed sum of channel differences. antialiasing can produce false changes.
- no network assertions, no console error assertions, no accessibility audit assertions.
- four fixture flows and four real pages. not a general benchmark.

## next

1. port the driver into the rust binary as a second mode with a warm browser.
2. add `browser_record`, `browser_replay`, and `browser_diff` to the mcp server.
3. benchmark against playwright mcp on the same four flows, including model round trips.
4. make the observation budget a parameter and measure the token and accuracy curve.
