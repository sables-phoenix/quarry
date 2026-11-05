# limits

what quarry does not do, and what the numbers do not cover.

## browser

- no javascript rendering in the text layer. client-rendered pages come back flagged, not rendered.
- no cookies, sessions, or stored credentials.
- no file uploads, cross-origin iframes, or shadow roots beyond the open root.
- locators use synthetic `click()` and value assignment, not trusted CDP input. react, vue, and autofill may ignore them.
- lexical section ranking. a question worded differently from the page can miss.
- the state drops paragraphs under 60 characters and text outside live regions. a short answer can be absent from the payload.
- `browser_look` captures the viewport only, not the full page. image tokens use a formula, not a tokenizer.
- the MCP runs one browser. a closed browser is recreated on the next call; in-flight work is lost.
- the graph is local and capped at 1,000 states.

## benchmarks

- actions are scripted, not chosen by a model.
- model latency is not measured.
- browser screenshot tokens are a formula, not a screenshot.
- the 19-flow and 10-flow runs are single runs unless the table says otherwise.
- the compression sample is 10 page checks on 4 pages. the navigation sample is 4 cross-page flows. both use one capture run.
- selection recall is a substring check on questions written with knowledge of the pages.
- network latency varies. cold numbers move run to run.

## text

- no robots.txt handling.
- the extractor is a readability-style scorer, not a browser.
- full-page extraction is a wash against visible text on documentation pages. the win is selection, not compression.
- search depends on public endpoints or user keys. a failed configured provider falls through, but results vary by day.

## status

- text layer: shipped.
- browser layer: verification and replay, alpha. not a general browser agent.
- the name is weak on crates.io and npm. the crate is `quarry-web`, the package is scoped.
