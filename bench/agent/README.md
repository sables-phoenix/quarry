# model-driven benchmark

status: measured on 2026-11-05 with `opencode-go/glm-5.3-flash`.

the scripted benches measure what each tool returns. this one measures a model choosing the actions.

## method

- task: hire the Klawva Cv Tailor and stop at checkout before paying.
- two arms: quarry-browser tools and chrome-devtools tools.
- open: the model gets only the goal and a safety rule not to press pay. 3 runs per arm. supermemory disabled on both arms.
- guided: the model gets the steps. 3 runs per arm.
- measures: wall clock, opencode session cost, input tokens, success.
- runs happen in a temp project with a custom agent. shell, read, edit, and web tools are disabled. mcp tools are reached through code mode.

## open results

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | 180.0 s | $0.02836 | 49,019 | 1/3 |
| chrome devtools | 20.0 s | $0.00527 | 18,725 | 3/3 |

chrome wins the open-ended task. two quarry runs hit the 180 s timeout at checkout.

## guided results

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | 12.5 s | $0.00195 | 7,341 | 3/3 |
| chrome devtools | 49.0 s | $0.00901 | 24,638 | 3/3 |

when the steps are supplied, quarry is 3.9x faster and 4.6x cheaper. this measures execution and tool ergonomics, not planning.

## what changed the result

expanding the quarry tool descriptions with examples cut the guided run from 54.8 s and $0.024 to 12.5 s and $0.002. the open run did not get the same benefit: the model still explored the checkout form by trial and error, and two runs timed out.

## caveats

- one task, one model, one machine.
- the open run is the headline. it is also the weaker result for quarry.
- timeouts count as 180 s and as failures.
- costs come from the opencode session info, not a billing export.

raw data: `results.json` and `open-results.json`.
