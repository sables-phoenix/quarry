# browser bench

the real-flow baselines are exact o200k token counts from snapshots captured on 2026-11-05 with chrome devtools mcp, three snapshots per task, saved and tokenized. the values live in `real-flows.ts` as constants because the capture needs a live browser and a human-run session. this file records the provenance.

- 10 page checks on 4 pages: mdn, react docs, github, wikipedia.
- each check opens the page and asserts a body phrase in the returned state.
- 4 cross-page flows: github issues, github pull requests, wikipedia talk, react useEffect. each asserts the final url and a phrase.
- tokenizer: o200k_base on the full snapshot text.
- one capture run per task.
- the screenshot row in `fixtures.json` is the 1,366-token frame formula, not a capture.

the quarry arm is measured by `real-flows.ts` for page compression and `nav-flows.ts` for navigation. both check the returned state payload, not the page DOM.
