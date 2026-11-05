# browser bench

the real-flow baselines are exact o200k token counts from snapshots captured on 2026-11-05 with chrome devtools mcp, three snapshots per task, saved and tokenized. the values live in `real-flows.ts` as constants because the capture needs a live browser and a human-run session. this file records the provenance.

- 10 tasks on 4 pages: mdn, react docs, github, wikipedia.
- each task: initial snapshot, snapshot after the first click, snapshot after the second click.
- tokenizer: o200k_base on the full snapshot text.
- one capture run per task.
- the screenshot row in `fixtures.json` is the 1,366-token frame formula, not a capture.

the quarry arm is measured by `real-flows.ts` and checks the returned state payload, not the page DOM.
