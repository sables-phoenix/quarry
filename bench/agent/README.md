# model-driven benchmark

status: measured on 2026-11-05 with `opencode-go/glm-5.3-flash`.

the scripted benches measure what each tool returns. this one measures a model choosing the actions.

## method

- task: hire the Klawva Cv Tailor and stop at checkout before paying.
- two arms: quarry-browser tools and chrome-devtools tools.
- guided: the model gets the steps and must execute them. 3 runs per arm.
- open: the model gets only the goal. 1 run per arm.
- measures: wall clock, opencode session cost, input tokens, cache reads, success.
- runs happen in a temp project with a custom agent. shell, read, edit, and web tools are disabled. mcp tools are reached through code mode.

## guided results

| arm | wall, median | cost, median | input tokens, median | success |
| --- | --- | --- | --- | --- |
| quarry | 17.7 s | $0.00181 | 6,768 | 3/3 |
| chrome devtools | 49.0 s | $0.00901 | 24,638 | 3/3 |

quarry: 2.8x faster, 5.0x cheaper, 3.6x fewer input tokens.

## open results

| arm | wall | cost | input tokens | success |
| --- | --- | --- | --- | --- |
| quarry | 15.6 s | $0.00288 | 10,373 | 1/1 |
| chrome devtools | 119.5 s | $0.01368 | 32,569 | 1/1 |

quarry: 7.7x faster, 4.7x cheaper.

## what changed the result

the first quarry run took 54.8 s and $0.024 with the old terse tool descriptions. the model spent most of it discovering the step shapes. expanding the descriptions with examples cut the run to 17.7 s and $0.0018. tool descriptions mattered more than the observation format.

## caveats

- one task, one model, one machine.
- the guided prompt lists the steps, so it measures execution and tool ergonomics, not planning.
- the open quarry run recalled a recorded flow from supermemory. the chrome run did not. that favors quarry.
- costs come from the opencode session info, not a billing export.

raw data: `results.json`.
