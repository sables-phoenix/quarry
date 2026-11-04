# html to text for coding agents

research note for quarry, 2026-11-04

## 0. Scope and method

This covers seven extraction systems (Readability.js, trafilatura, Goose/goose3, newspaper3k/4k, Postlight Parser, Jina Reader, Firecrawl), the published accuracy benchmarks, and what happens on the way from HTML to markdown to a chunk with a citation.

Three kinds of evidence appear below, and they are not interchangeable:

1. **Published benchmarks.** ScrapingHub's article benchmark (181 article pages), trafilatura's own test set (990 mixed documents), and WCXB (2,008 pages across 7 page types). Metrics differ, corpora differ, so cross-table comparisons are invalid.
2. **My measurements.** 8 live pages fetched 2026-11-04, counted with `o200k_base` via js-tiktoken, Readability with default options, Turndown with `fenced`/`atx` (no GFM plugin, which is the common default), mdream in `minimal` mode on Readability's content HTML. One run, small n, pages change. Treat as an order-of-magnitude check on vendor claims, not a leaderboard.
3. **Source reading.** Readability.js at `main` (2,812 lines), goose3 `extractors/content.py`, newspaper `extractors.py`, Postlight `scoring/score-content.js`, Firecrawl `apps/api/package.json`.

## 1. How the systems work

| System | Main-content detection | Boilerplate removal | Languages | Output | Status |
| --- | --- | --- | --- | --- | --- |
| Readability.js | Scores `<p>`, `<pre>`, `td`, headings by commas + text length, propagates to ancestors with `1 / (level * 3)` decay, multiplies by `1 - linkDensity`, picks top candidate, merges siblings | Curated `unlikelyCandidates` regex (`-ad-`, `comment`, `sidebar`, `footer`, ...), `UNLIKELY_ROLES`, class/id weights ±25, conditional cleaning by link density and comma count | Language-agnostic; comma regex covers Latin, Arabic, CJK; class/id regexes are English-only | HTML (caller converts), plain text | Active, used by Firefox Reader View |
| trafilatura | Rule-based cascade: DOM pruning, XPath content patterns, then fallbacks (readability-lxml, jusText), `baseline()` tries embedded JSON, `<article>`, paragraphs, schema.org, raw body | Explicit discard lists, link-density and text-density thresholds, duplicate segment removal, comment extraction | Language-agnostic heuristics plus optional language detection; metadata patterns per language | txt, markdown, JSON, CSV, XML, TEI | Active, best documented benchmarks |
| Goose / goose3 | Paragraph stopword counts with positional boost (`1/n * 50`), negative scoring for the last 25% of nodes when >15, propagates to parents with `1.5 / (depth + 0.5)`, then sibling harvesting | "Known article tags" extraction, high-link-density rejection, sibling score thresholds | ~40 stopword lists (ar, be, bg, da, de, el, en, ..., zh) | Text + limited markup | Active (goose3 3.1.22) |
| newspaper3k / 4k | A port of Goose's algorithm: stopword scoring, boost, parent/grandparent propagation, top node | Same family as Goose; also `post_cleanup`, known bad tags | 36 stopword lists | Text, some HTML | 3k legacy, 4k the maintained successor |
| Postlight Parser | Scores `p` and `pre`, parent gets full score, grandparent half, runs the pass twice, hNews selectors get +80, merges siblings above `max(10, 0.25 * topScore)` | `stripUnlikelyCandidates`, class/id weighting, link-density bonus ±20 during sibling merge | Stopword-free (no language model); per-domain custom extractors | HTML, markdown, text | Dormant, last commit 2023-03-15 |
| Jina Reader | Server-side fetch + headless browser, then reader-style main content extraction; optional ReaderLM-v2 (1.54B) for HTML to markdown | Removes nav/header/footer/ads, `X-Remove-Selector`, `X-Target-Selector` | Language-agnostic, no translation, `X-Locale` for rendered locale | Markdown (Turndown under the hood), JSON, text | Commercial, OSS service code, models CC-BY-NC |
| Firecrawl | Own pruning pipeline behind `onlyMainContent` (used in their benchmark as `onlyMainContent: true`), `includeTags`/`excludeTags` overrides | Same knob; JSON-LD/microdata used for structured fields | Language-agnostic; `location.languages` affects fetch headers | Markdown, HTML, JSON, links, screenshots | OSS core (AGPL) + cloud |

### Readability.js, in enough detail to reimplement

The scoring core is short and worth copying:

- Base tag scores: `div` +5, `pre`/`td`/`blockquote` +3, `ol`/`ul`/`li`/`dl`/`form` −3, `h1`–`h6`/`th` −5, then class/id weight ±25 for matches on the positive and negative regexes.
- Per scored block: 1 point base, 1 point per comma, up to 3 points for length (`len / 100`), skipped if under 25 characters.
- Propagation: parent gets the full score, grandparent half, further ancestors `score / (level * 3)`.
- Final candidate score: `contentScore * (1 - linkDensity)`.
- If the result is under `CHAR_THRESHOLD = 500` characters, it retries with flags dropped: first stop stripping unlikely candidates, then stop weighting classes, then stop conditional cleaning. A page that only parses after the third retry is usually a layout page, not an article.
- It keeps `pre` and data tables during conditional cleaning, which is why code survives better here than in most competitors.

Weakness for our use case: the whole method assumes one article-shaped node. A docs page split across `<main>` plus a right-hand "On this page" rail, or a forum where `class="comment"` is the content, fails in predictable ways (see §2).

### trafilatura, in enough detail to trust the numbers

trafilatura is the only one of the group that documents its cascade. Extraction tries the rule-based main extractor, then falls back to readability-lxml, then jusText. `baseline()` is the last resort: embedded JSON in scripts or attributes (schema.org, Discourse), then `<article>`, then text paragraphs, then schema.org teaser, then the raw body text. In balanced mode a short extraction covering little of the page is retried with recall settings.

Two consequences matter: it never returns nothing on a page with text (good for agents), and its precision/recall are tunable (`favor_precision`, `favor_recall`, `fast`). The 2026 numbers in §2 are the standard profile, which is the balanced default.

## 2. Accuracy: what the benchmarks actually say

### ScrapingHub article benchmark (latest run, 181 article pages)

F1, with bootstrap SD:

| System | F1 | Precision | Recall |
| --- | --- | --- | --- |
| rs_trafilatura | 0.970 ± 0.004 | 0.951 | 0.990 |
| go_trafilatura | 0.960 ± 0.007 | 0.940 | 0.980 |
| trafilatura 2.0.0 | 0.958 ± 0.006 | 0.938 | 0.978 |
| newspaper4k 0.9.3.1 | 0.949 ± 0.008 | 0.964 | 0.934 |
| readability_js 0.6.0 | 0.947 ± 0.005 | 0.914 | 0.982 |
| readability-lxml 0.8.4.1 | 0.922 ± 0.013 | 0.913 | 0.931 |
| goose3 3.1.20 | 0.896 ± 0.015 | 0.940 | 0.856 |
| justext 3.0.2 | 0.804 ± 0.018 | 0.858 | 0.756 |
| html2text 2025.4.15 | 0.662 ± 0.016 | 0.499 | 0.983 |
| beautifulsoup (all text) | 0.665 ± 0.015 | 0.499 | 0.994 |

The 2019 commercial baselines remain the ceiling on this corpus: AutoExtract 0.970, Diffbot 0.951.

### trafilatura's own evaluation (990 documents, 2,951 text + 2,966 boilerplate segments, 2026-10-02)

| System | Precision | Recall | F1 |
| --- | --- | --- | --- |
| trafilatura 2.3.0 standard | 0.906 | 0.946 | 0.926 |
| trafilatura 2.3.0 precision | 0.924 | 0.921 | 0.922 |
| magic-html 0.1.8 | 0.887 | 0.891 | 0.889 |
| justext custom | 0.864 | 0.859 | 0.862 |
| readability-lxml 0.9 | 0.892 | 0.817 | 0.853 |
| news-please | 0.932 | 0.757 | 0.836 |
| goose3 3.1.22 | 0.936 | 0.713 | 0.810 |
| boilerpy3 | 0.818 | 0.796 | 0.807 |
| newspaper4k | 0.878 | 0.739 | 0.803 |
| inscriptis (all text) | 0.534 | 0.991 | 0.694 |
| html2text | 0.525 | 0.900 | 0.663 |

Read the precision/recall split, not just F1. Goose is the most precise (0.936) and the least complete (0.713). All-text converters have near-perfect recall and coin-flip precision: great if you only care that the answer is somewhere in the context, terrible if you pay per token.

### WCXB: the genre spread (2,008 pages, 7 types, held-out test set)

Overall F1: rs-trafilatura 0.859, MinerU-HTML 0.827, trafilatura 0.791, dom-smoothie 0.762, ReaderLM-v2 0.741.

| Page type | trafilatura | Readability | rs-trafilatura | MinerU-HTML |
| --- | --- | --- | --- | --- |
| Article | 0.926 | 0.825 | 0.932 | 0.928 |
| Documentation | 0.888 | 0.736 | 0.931 | 0.838 |
| Service | 0.763 | 0.604 | 0.843 | 0.824 |
| Forum | 0.585 | 0.466 | 0.792 | 0.794 |
| Listing | 0.589 | 0.496 | 0.704 | 0.710 |
| Product | 0.567 | 0.407 | 0.670 | 0.619 |
| Collection | 0.553 | 0.445 | 0.713 | 0.506 |

This is the most useful table in the literature for an agent tool. A documentation page is where a coding agent spends its life, and the article-trained systems lose 4 points (trafilatura) to 9 points (Readability) there while losing 30+ points on forums. The two neural extractors do not rescue it: a 1.5B model trained on articles scores 0.417 on collections.

### Reading the numbers honestly

- Article benchmarks saturate. Everything credible lands between 0.89 and 0.97 F1. A percent of F1 is not a product decision.
- Same tool, different corpus: trafilatura scores 0.958 on ScrapingHub's article set and 0.791 on WCXB's mixed set. If a vendor quotes one number, ask which pages.
- Benchmarks measure text overlap with a human annotation, not whether the thing an agent needed survived. A page can score 0.93 and still have lost the one code block with the argument name in it.
- Readability's 0.947 on articles and 0.466 on forums is the same algorithm. The failure is structural, not a tuning problem.

## 3. How much do you actually save

### My 8-page measurement (o200k_base tokens, 2026-11-04)

| Page | Raw HTML | Readability text | Plain text (all) | Turndown md | md cut vs HTML | Readability cut |
| --- | --- | --- | --- | --- | --- | --- |
| Wikipedia: Markdown | 100,762 | 4,908 | 13,858 | 14,106 | 86.0% | 95.1% |
| docs.python.org `json` | 32,975 | 6,027 | 7,772 | 12,736 | 61.4% | 81.7% |
| MDN: Using Fetch | 48,979 | 4,476 | 8,955 | 6,377 | 87.0% | 90.9% |
| GitHub: mozilla/readability | 120,208 | 1,379 | 4,261 | 2,360 | 98.0% | 98.9% |
| PEP 8 | 34,262 | 9,391 | 10,779 | 18,071 | 47.3% | 72.6% |
| Postgres `SELECT` | 30,289 | 11,657 | 14,273 | 14,377 | 52.5% | 61.5% |
| Cloudflare blog index | 73,983 | 270 | 8,963 | 342 | 99.5% | 99.6% |
| HN front page | 11,709 | 1,105 | 3,599 | 5,119 | 56.3% | 90.6% |

Summary: markdown cuts a median 73.7% of raw HTML tokens (mean 73.5%, range 47.3–99.5%). Readability's plain text cuts a median 90.7% (range 61.5–99.6%). The difference is mostly link URLs and table pipes that markdown keeps and text drops.

Markdown versus plain text, per page, ranges 0.04x to 1.68x, median 1.00x. It is not automatically the cheaper format. On code-heavy docs it costs 1.64x (python docs) and 1.68x (PEP 8) more than flattened text, because that is the price of keeping fences, indentation, and code. On the Cloudflare index it costs 0.04x because Readability found 270 tokens of "main content" and the markdown was empty-ish.

### Firecrawl's 15-page benchmark (vendor, but with a stated method)

4,103,706 GPT tokens as raw HTML against 190,817 as markdown with `onlyMainContent: true`, a 21.5x reduction. Median per page 19x, range 2.6x (Hacker News front page) to 283x (Vercel homepage). Holds across tokenizers: 20.8x on Claude, 22.5x on Gemini. Five of the 15 pages exceed 200k tokens as HTML; none do as markdown.

The gap between their 21.5x and my 3.8x median is not a contradiction, it is sampling. Their set includes Stripe's API reference (1.35M tokens of HTML, 111x) and two marketing SPAs. My set is docs and article pages that ship less inline script and state. For a coding agent that fetches docs all day, **expect 2x to 6x, not 20x**, unless the page is a JS app that serializes its whole state into the document.

### What drives the reduction

The win decomposes into two stages, and the second is much smaller than people expect. Across my 8 pages:

- Visible text after stripping tags is a median 20.9% of the raw HTML token count (range 3.5% on the GitHub page to 47.1% on the Postgres docs). Markup, inline CSS, SVG, `<script>` bodies, and serialized state are the other ~79%.
- Main-content extraction then keeps a median 42.7% of that visible text (range 3.0% on the Cloudflare index, where Readability found almost nothing, to 87.1% on PEP 8).

Multiply the two and you get the ~90% median cut above. So "boilerplate removal" is worth roughly half the visible text, not 90% of the page. The 20x headline numbers come from script-heavy pages where stage one does almost all the work. A page's `raw_html_tokens / visible_text_tokens` ratio tells you which regime you are in: above 20 means script and state dominate, between 3 and 6 means you are on a real article or docs page and extraction buys a modest, honest win.

## 4. Markdown conversion: what survives

Converters compared: Turndown (JS, still the default in Jina Reader and Firecrawl's API app, actively maintained, v7.2.5 released 2026-11-04), `turndown-plugin-gfm`/`joplin-turndown-plugin-gfm` (tables, strikethrough, task lists), node-html-markdown, html-to-markdown (Go, Johannes Kaufmann, forked by Firecrawl, tables only via the `GitHubFlavored` plugin), mdream (Rust + JS + WASM, `minimal` mode, streaming), html2text (Python), html-to-text (Python/JS text, not markdown). mdream's own comparison page still calls Turndown unmaintained, which is out of date; verify status claims before repeating them.

Speed on a 166 KB fixture, from mdream's own comparison page: mdream Rust 0.34 ms, mdream NAPI 0.52 ms, mdream JS 3.26 ms, Turndown 11.26 ms, node-html-markdown 14.31 ms, html-to-markdown (Go) ~2 ms. Vendor-run, single fixture, but the ordering matches the architecture.

### Measured fidelity on a synthetic fixture

Fixture: a fenced Python block with 4-space indentation and a `#` comment, a second block with `<span>`-based syntax highlighting (what every docs site emits), a 3-column table with a `|` inside a cell, and a nested list.

| Converter | Fence kept | Language tag | Indented code lines | Table rows | Nested list | Pipe in cell |
| --- | --- | --- | --- | --- | --- | --- |
| Turndown (default) | first block only | yes | 11 | 0 (cells split to lines) | yes | breaks columns |
| Turndown + GFM | first block only | yes | 11 | 4 | yes | breaks columns |
| mdream (minimal) | both | yes | 9 | 4 | yes | escaped |
| mdream (full) | both | yes | 9 | 4 | yes | escaped |
| html-to-text | 0 | no | 9 | 0 (`flagmeaningdefault`) | yes | n/a |

Two failures are worth naming because they hit coding agents directly.

**Highlighted code loses its fence and gets escaped.** With `<pre><span class="k">def</span> ...</pre>`, Turndown does not match its `pre > code` rule. It emits the code as a paragraph, no fence, and escapes markdown characters inside it: `return \[\]` instead of `return []`. The indentation survives as spaces, so a human reading the markdown sees roughly the right shape, while the model sees prose with backslashes and no code signal. Every docs site that uses Prism, Shiki, highlight.js, or Pygments hits this. mdream fences the same input correctly.

**Tables collapse silently.** Without the GFM plugin, Turndown turns a table into one cell per line, which reads as a vertical list with no header association: `flag`, `meaning`, `default`, `` `--fast` ``, `skip fallback | cascade`, `false`. With the plugin it produces a table, but an unescaped `|` inside a cell breaks the column count, so a parameter table with `a | b` in a description misaligns every row after it. mdream escapes it.

Other failure modes seen in the wild, consistent with these mechanics:

- `<pre>` used for ASCII diagrams and terminal output: any converter that normalizes whitespace destroys alignment. Never run whitespace collapsing inside `pre`.
- Definition lists (`<dl>/<dt>/<dd>`) have no markdown equivalent. Turndown flattens them so the term and the definition become separate paragraphs with a blank line between, losing the pairing that flag tables rely on. mdream instead passes the whole `<dl>` through as raw HTML, which is lossless but costs tokens.
- CLI flags in prose get escaped: `--fast` at the start of a line comes out as `\--fast` from Turndown's setext-heading protection. Harmless when rendered, ugly when the model copies the string.
- `<details>/<summary>`: Turndown flattens to text, so collapsed "Advanced options" content appears with no label. mdream emits `<details>`/`<summary>` as raw HTML, so the structure survives but the payload grows.
- Footnotes and reference links: markdown link syntax can add 30–80 tokens per link on a link-heavy page, which is why markdown sometimes costs more than plain text.
- Character escaping is lossy in both directions: `*`, `_`, `[`, `]`, and leading `#` inside prose get backslashes, which pollutes identifiers like `**kwargs` or `foo[bar]`.

For a coding agent the priority order is: code fences and indentation, then tables, then lists, then links, then emphasis. Most converters optimize in the reverse order.

## 5. Chunking and truncation that keep citations

### Three address spaces, and the mapping problem

Any citation has to survive three transformations:

1. **Source HTML**: byte offsets into the response body, DOM node paths, `id` attributes.
2. **Extracted text**: character offsets into the markdown or plain text actually sent to the model.
3. **Token stream**: token indices after the provider's tokenizer, which differ per provider by 1.2x to 2.65x.

Converters break the mapping between 1 and 2. Turndown and mdream do not emit source positions, and the output length is not proportional to the input length (a `<table>` of 40 nodes becomes 6 lines; a `<script>` of 200 KB becomes nothing). So you cannot recover a source offset by scaling. The only reliable approach is to record provenance **before** conversion, per block, and carry it through.

### The block record

Emit a list of blocks rather than one string, and give every block:

| Field | Purpose |
| --- | --- |
| `id` | stable per document, `b0007`, for citation and retrieval |
| `kind` | `heading`, `para`, `code`, `table`, `list`, `quote`, `caption` |
| `heading_path` | `["Install", "From source", "Requirements"]`, the breadcrumb a citation shows |
| `anchor` | nearest ancestor or self `id` attribute, e.g. `#requirements` |
| `char_start`, `char_end` | offsets into the exact string the model receives |
| `dom_path` | `main/article[1]/section[3]/pre[1]`, for re-fetch verification |
| `lang` | code fence language, from `class="language-*"`, `data-lang`, or filename |
| `text` | the block's markdown |
| `source_url` | `final_url + "#" + anchor` when an anchor exists |

Concatenating `text` in order must reproduce the payload byte for byte. That single invariant makes `char_start`/`char_end` trustworthy and lets a model quote a span that the harness can map back to a block, a heading path, and a URL fragment.

### Anchors are the cheapest citation primitive

Docs sites already ship the anchor: `<h2 id="requirements">`. It is human-visible in the URL bar, stable across re-fetches, and survives HTML-to-markdown conversion if you copy the `id` into the block record. Prefer, in order:

1. **Heading anchor** (`#requirements`): stable, readable, resolvable by a human and by a re-fetch.
2. **Block id plus heading path** (`b0012 @ Install > Requirements`): works when headings have no `id`.
3. **Character offsets into the payload**: exact for the model, useless to a human unless you also store the payload hash.
4. **DOM path**: only for verification, never for display.

Never cite line numbers in converted markdown. They shift with every converter bump and every `minimal` mode tweak.

### Consumer contracts worth matching

- Anthropic's citations API takes a plain-text document and returns `char_location` with `start_char_index`/`end_char_index` (0-indexed, exclusive end) plus `cited_text`. For custom content documents it returns block indices and does no further chunking. That is the strongest argument for the block list plus offsets shape: it maps directly onto `content_block_location` and gives per-block granularity for free.
- Citation quality is capped by chunking. If you hand the model a 40k-token page as one document, sentence chunking makes every citation a sentence, and the model has to reconstruct which section it came from. If you hand it blocks with heading paths, the citation already carries the section.
- Coding-agent benchmarks check provenance mechanically. The Openbenchmarks coding-agent board only passes a submission if the patch contains a `# source:` URL that actually appeared in that run's search or fetch results. An extraction tool that drops the final URL, or rewrites it to a canonical form that was never fetched, fails the task even with perfect text.

### Truncation policy

Order of preference, cheapest first:

1. **Select, do not truncate.** Return the outline, let the caller request sections. A 60k-token docs page usually has 3k tokens the agent needs.
2. **Drop by block class.** Boilerplate, related links, author bio, comments (unless the page is a forum), images. This is extraction, not truncation, and it is what should happen first.
3. **Keep the whole section.** If a cut is unavoidable, cut at block boundaries, never inside a `pre` or `table`. A half code block is worse than no code block: it compiles wrong and the model cannot tell.
4. **Head-and-tail only as a last resort,** with an explicit marker: `[... 12,400 tokens omitted: sections "Advanced", "Reference" ...]`. Silent truncation is the failure mode that makes agents assert things the page never said.
5. **Budget by need, not by a fixed number.** A "find the flag name" task needs the table row, not the intro. A "how do I configure X" task needs the whole config section including code.

Two heuristics that work in practice: rank sections by (heading depth, query overlap with heading path, presence of code or tables) and fill the budget in that order; and always include the page title, the first paragraph, and the last modified date, because those three answer "is this the right page and is it current".

## 6. Coding agent versus summarizer

These are different extraction targets, and optimizing for one degrades the other. A summarizer wants the thesis and the evidence. An agent wants the exact string it is about to type into a file.

| Signal | Coding agent | Summarizer |
| --- | --- | --- |
| Code blocks | Essential, with fences, language, exact indentation | Usually droppable; keep only if the point is the API shape |
| Tables | Essential (params, env vars, limits, error codes) | Sometimes; keep numbers, drop structure |
| Exact identifiers | Essential (`--favor-precision`, `X-Retrieve-Content`) | Paraphraseable |
| Version and date | Essential (is this the current API?) | Useful for freshness claims |
| Error strings | Essential (searchable, quotable) | Rarely |
| Prose transitions | Noise | Signal |
| Author, bio, related posts | Noise | Noise |
| Images and captions | Noise, unless it is a diagram of the architecture | Sometimes signal |
| Nav and sidebars | Noise, except the "On this page" list, which is a free outline | Noise |
| Comments and forum replies | Often the answer (Stack Overflow, GitHub issues) | Usually noise |
| Link URLs | Useful (the next fetch) but expensive | Mostly noise |
| Heading structure | Essential, it is the citation and the retrieval key | Useful |

The practical difference in output shape:

- **Summarizer payload**: 2k–8k tokens of clean prose, section headings, no code, no link targets.
- **Agent payload**: 2k–10k tokens, code and tables intact, links kept only when they point at docs or source, plus an outline and a `source_url` per block.

One more asymmetry: a summarizer can tolerate a missed paragraph, because the summary is judged on gist. An agent cannot tolerate a missed `--flag` or a wrong default, because it writes code that fails at runtime and the failure surfaces far from the fetch. This argues for `favor_recall` on docs pages and `favor_precision` on marketing pages, which is exactly the switch trafilatura exposes and most tools do not.

## 7. Implications for quarry

Measured targets, from the numbers above:

- **Tokens per fetch**: the median across my mixed 8-page set is 3.8x, but the per-genre spread is wide: pure docs pages gave 1.9x–2.6x, article and listing pages 6x–70x. 20x is a JS-app story. Set the benchmark target on a docs-heavy corpus, not on Stripe's API reference.
- **Fidelity**: 100% of fenced code blocks preserved with language and indentation; 100% of tables with escaped pipes; zero silent truncation.
- **Provenance**: every block carries `char_start`/`char_end`, `heading_path`, `anchor`, `source_url`. Reassembling blocks reproduces the payload exactly.
- **Latency**: extraction is not the cost. Readability-class scoring on a 150 KB page is sub-millisecond in Rust; the network and any headless render dominate. Do not trade fidelity for extraction speed.

Specific gaps in the current `src/extract.rs` and `src/model.rs`, in priority order:

1. `Doc` has `text: String` and `chars`, no blocks and no offsets. Add `blocks: Vec<Block>` with the record from §5, and compute `chars`/`tokens_est` from the concatenation.
2. `estimate_tokens(chars) = chars / 4` is a rough English-prose approximation. Measured provider spreads are 1.17x–1.65x on prose and 2.65x on structured content, and code tokenizes worse than prose, so the error is up to ~2x on code-heavy payloads. Either ship a real tokenizer or calibrate per content type and label the field as an estimate.
3. Code handling exists (`pre` → fence, `code_lang`) but only for `pre > code`. Handle `pre` with child elements (highlighted code) by taking `textContent` and preserving `\n` and leading spaces, and never escape inside a fence.
4. Tables: escape `|` in cells and emit a header separator row, or drop the table to a fenced block rather than a column-less list.
5. No `only_main_content` escape hatch. Some callers need the nav (site mapping) and some pages are collections where the "boilerplate" is the content. Expose `main_only: bool` and a `page_kind` hint.
6. No outline mode. Add `outline` (headings + anchors + token counts) and `section(anchor)` so an agent can fetch 3k tokens instead of 60k.

Benchmark plan for phase 4: a fixed corpus of 40 pages (10 docs, 10 blog/article, 5 forum, 5 product, 5 collection, 5 JS app), with gold answers expressed as required strings (a flag, an endpoint, a default, a code line) rather than full-text F1. Score: required-string recall, tokens per task, and citation resolvability (does the emitted anchor resolve on re-fetch). That measures what the agent needs, and it is cheap to run before and after.

## 8. Sources

Benchmarks and evaluation:

- trafilatura, "Benchmarks and evaluation" (2026-10-02 run, 990 documents): https://trafilatura.readthedocs.io/en/latest/evaluation.html
- ScrapingHub, article-extraction-benchmark (archived 2026, latest results incl. Rust crates): https://github.com/scrapinghub/article-extraction-benchmark
- Foley, M., "I Built a 2,000-Page Web Content Extraction Benchmark" (WCXB, 2,008 pages, 7 page types): https://murroughfoley.com/web-content-extraction-benchmark/ and https://webcontentextraction.org
- Bevendorff et al., "An Empirical Comparison of Web Content Extraction Algorithms", SIGIR 2023: https://webis.de/downloads/publications/papers/bevendorff_2023b.pdf
- Openbenchmarks, "Web Search for Coding Agents" (100 tasks, fetch board, Sept 2026): https://openbenchmarks.com/web-search-for-coding-agents
- Firecrawl, "AI Tokens: What They Are, How They're Counted" (15-page HTML vs markdown benchmark, Aug 2026): https://www.firecrawl.dev/blog/llm-tokenization-across-models

Implementations:

- Mozilla Readability.js source (scoring constants, regexes, retry flags): https://github.com/mozilla/readability/blob/main/Readability.js
- trafilatura core functions (cascade, baseline, fallbacks): https://trafilatura.readthedocs.io/en/latest/corefunctions.html
- goose3 content extractor: https://github.com/goose3/goose3/blob/master/goose3/extractors/content.py
- newspaper content extractor: https://github.com/codelucas/newspaper/blob/master/newspaper/extractors.py
- Postlight Parser scoring and sibling merge: https://github.com/postlight/parser/tree/main/src/extractors/generic/content
- Jina Reader docs (engines, Turndown options, token budget, citation links): https://jina.ai/reader/
- Jina ReaderLM-v2 (HTML to markdown model): https://arxiv.org/abs/2503.01151
- Firecrawl scrape docs (`onlyMainContent`, include/exclude selectors): https://docs.firecrawl.dev/features/scrape
- firecrawl/html-to-markdown (Go, GFM plugins): https://github.com/firecrawl/html-to-markdown
- mdream (Rust/JS/WASM converter, comparison and benchmarks): https://github.com/harlan-zw/mdream and https://mdream.dev/tools/compare
- Dripper / MinerU-HTML, token-efficient main content extraction: https://arxiv.org/abs/2511.23119

Citation mechanics:

- Anthropic citations (character indices, content block indices, chunking): https://platform.claude.com/docs/en/build-with-claude/citations

Local measurement artifacts (this note): `research/measure/measure.mjs` (HTML vs Readability vs markdown tokens), `research/measure/fidelity.mjs` (code/table/list fidelity). Run with `npm i jsdom @mozilla/readability turndown turndown-plugin-gfm mdream html-to-text js-tiktoken` in that directory. Results are one run on live pages; re-run before trusting them after a converter upgrade.
