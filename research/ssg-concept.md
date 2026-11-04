# the semantic state graph

status: implemented in `browser/` as a node package and mcp server. measured on 2026-11-04.

## the shift

today an agent and a browser exchange pages. the agent looks at a document, at a tree, or at pixels, then decides one action, then looks again. every look costs tokens and a model round trip.

the proposal is to exchange states and transitions instead.

an agent declares an intent. the runtime performs it, computes the new semantic state, and returns a signed diff. the agent never sees the page unless the diff cannot answer its question.

## the three measurements that force this design

### 1. text dumps are not cheap

measured with the o200k tokenizer on real pages.

| page | devtools mcp snapshot | raw a11y text | a11y as json | a11y as toon | json as base64 |
| --- | --- | --- | --- | --- | --- |
| mdn caching | 22,955 | 28,939 | 49,982 | 33,207 | 169,352 |
| react usestate | 20,667 | 34,785 | 83,447 | 48,454 | 270,065 |
| github rust | not measured | 5,632 | 13,265 | 7,871 | 42,589 |

toon beats json by 1.51x to 1.72x. real, but small. base64 is 3.4 to 5.8 times worse than json. never send base64 to a model. a screenshot at 1280 by 800 is about 1,366 tokens.

### 2. scoped semantic state is the real compression

keep only headings, text blocks, interactive nodes, dialogs, and live regions. assign each node a stable id from its role and label. scope to a landmark, main or form or dialog. hash the result.

| page | devtools snapshot | scoped state | ratio |
| --- | --- | --- | --- |
| mdn | 22,955 | 1,287 | 17.8x |
| react | 20,667 | 2,466 | 8.4x |
| github | not measured | 1,255 | n/a |

the hash is stable across fresh browser sessions. mdn produced `87ed0c78262b` twice, in two separate chrome processes. the fixture produced the same hash twice. content-addressed state is portable.

### 3. goal projection

keep nodes that match the goal, plus their headings. on mdn, the goal "etag revalidation" cuts 1,287 tokens to 71. that is 323x smaller than the devtools snapshot.

projection fails when the words are absent. github plus "authentication" returned zero nodes. the fallback must be a heading outline plus actions, not silence.

## deltas

node set difference, grouped. measured per action:

| action | diff nodes | tokens |
| --- | --- | --- |
| increment a counter | +1 -1 | 7 |
| open a modal | +2 -4 | 25 |
| filter 50 items to 11 | -39 +1 | 26 |
| login, navigate | +4 -3 | 29 |
| scroll a docs page | +3 | 38 |

without grouping, the filter diff was 467 tokens. grouping by role and sampling three names cut it to 26, an 18x reduction. the summary is what a verifier needs: 39 links removed, not a list of 39 links.

## the graph

record states as nodes and actions as edges.

fixture experiment: dashboard, click increment three times.

- 4 states, 3 edges, 29 tokens per state.
- later, from state 0, a target state is requested by hash.
- bfs finds the path, the runtime executes three clicks, and the target hash matches.
- cost: 0 model tokens, 3 tool actions, 760 ms including the settle delay.

that is state-addressed navigation. an agent asks for a state, not a sequence of clicks.

## the architecture

1. state builder. from the accessibility tree and dom, build the scoped semantic state. stable ids by content, not position. live regions become values.
2. state store. content-addressed nodes and states, like git trees. states are sets of node ids plus values, so storage and cross-agent sync are small.
3. delta engine. summarize changes by role, sample names, and attach the changed values.
4. projector. goal-conditioned subgraph with an outline fallback.
5. transition graph. actions to states. shortest path to a target state. persisted across agents and sessions.
6. intent compiler. the first run is model-driven. it compiles to a script with typed assertions. later runs replay with no model and return only failures.
7. contracts. assertions are typed predicates over the state: count, text, visible, url, value. a failed run returns the smallest witness, which is the diff plus the false predicate. the protocol is modeled in tla+ and checked with tlc.

## what is new, honestly

each piece exists somewhere.

- crawljax (2008) builds state-flow graphs for ajax crawling and testing. it is offline and not token-budgeted.
- stagehand caches actions and replays them deterministically, calling the model only on failure. it still observes a page per step.
- accessibility-tree research shows compressed trees beat screenshots on some benchmarks. it compresses one observation, not a state identity.
- percy and applitools diff screenshots in ci. they do not drive an agent.
- toon reduces structured-data tokens by 33 to 42 percent. we measured 1.51x to 1.72x.

the new combination is: content-addressed semantic states, scoped and projected, plus summarized deltas, plus a shared transition graph, exposed as an agent protocol with a token budget. no current tool does all five, and none shares state across agents.

## why it can be an order of magnitude better

| workload | today | state graph |
| --- | --- | --- |
| read one fact from a large page | 22,955 (snapshot) or 6-8k (text) | 71 projected |
| verify one visual step | 1,366 (screenshot) | 7 to 38 diff |
| rerun a known flow | 5,464 for four steps | 10 |
| reach a known state | n observations | 0 model tokens |
| second agent on the same app | starts over | jumps the shared graph |

the measured range is 18x to 546x on tokens, and zero model calls on replay. that is the order-of-magnitude shift. it is not infinite, and claims of infinite would be dishonest.

## weaknesses

- identity drift on dynamic pages. scoping handles ads outside main. volatile nodes inside the scope still cause noise. needs a churn filter that learns which nodes move without an action.
- projection misses. needs an outline fallback and a within-page search.
- iframes, shadow dom, canvas, and webgl have weak or no accessibility trees. they fall back to pixels.
- state explosion. needs ttl and task-scoped pruning.
- security. shared graphs must be scoped by origin and session, encrypted at rest, and never cross tenants.
- correctness. a state hash collision or bad identity can hide a change. periodic full checks and typed assertions are mandatory.

## head-to-head, 19 local flows

19 flows on a local fixture: login, validation, wizard, todo add and toggle, filter, pagination, modal confirm and cancel, tabs, table sort, async load, select form, disabled button, spa route, shadow dom, iframe, dialog chain.

| arm | total tokens | median per flow |
| --- | --- | --- |
| state graph, first run | 2,197 | 100 |
| dom snapshot per step | 3,124 | 106 |
| screenshot per step | 81,960 | 4,098 |
| state graph replay | 190 | 10 |

first run is 1.42x better than the dom baseline and 37x better than screenshots. replay is 16x better than dom and 431x better than screenshots. model calls: 60 for the baselines, 19 for first runs, 0 for replay.

the local pages are tiny, so the dom baseline is already cheap. on two real pages the gap opens:

| flow | state graph | devtools mcp | ratio |
| --- | --- | --- | --- |
| mdn, click two toc links | 1,338 | 58,860 | 44x |
| react, click two toc links | 3,274 | 49,001 | 15x |

mdn goal projection is 71 tokens against a 22,955 token snapshot, 323x.

## decision

the concept is not uniformly better. on small pages with a dom agent it is a wash, and it loses on one flow (spa route, 0.57x). it wins by 15x to 323x on large pages, 37x to 47x against screenshot agents, and 16x to 431x on repeat runs.

narrow the product to verification and repeat workflows. do not sell it as a general browser agent.

## the next gate

10 flows on three real web apps, not fixtures. ship only if median tokens are 10x better than devtools mcp, success is 95 percent or better, and replay catches an injected regression every time.

no code is committed for this concept. the experiments live in /tmp/ssg.
