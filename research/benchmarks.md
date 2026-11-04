# Benchmarking web access for coding agents

Research note for quarry. Scope is the measurement problem, not the feature list: how to show that a fetch layer delivers the same answer with fewer tokens, less latency, and fewer bytes than the tools it replaces.

Date: 2026-11-04.

## 0. What this note concludes

1. No public benchmark measures transport or extraction quality directly. Web agent benchmarks measure task success. Their scoring hides the fetch layer entirely, and several of them score near 100 percent for agents that never browse.
2. The closest existing measurement of quarry's actual claim is the Openbenchmarks coding-agent board, which fixes the model and the tasks and varies only the search and fetch provider. Its structure is worth copying. Its task set is not reusable, because the answers live in model-visible documentation.
3. Token cost must be counted with a named tokenizer on the text the model actually receives. Bytes on the wire are a different quantity and cannot be converted to tokens by a constant.
4. A fetch layer needs its own metric set: tokens per completed task, time to usable text, and success on the hard tail of JS-rendered and bot-walled pages. Everything else is a diagnostic.
5. The corpus must be frozen and hashed. Live-URL benchmarking measures the internet, not the code.

## 1. Existing benchmarks with web tasks

### 1.1 WebArena

812 tasks across six self-hosted applications (e-commerce, forum, GitLab, CMS, plus a map, calculator and scratchpad). Agents drive a Playwright browser, and the evaluator checks functional correctness, historically as string match plus an LLM judge.

What it measures: end-to-end task completion in a controlled, reproducible environment. This is its strength. The sites are local, so results are stable across runs.

Limits for transport and extraction work:

- The evaluator is brittle. WebArena Verified exists because "WebArena suffered from brittle string matching that inflated" scores, and replaces substring checks with backend state verification and structured outputs. Berkeley's Red Team found that substring `must_include` checks pass when the agent injects a hidden div with the answer text, so the check never confirms the agent read the page.
- Transport is invisible. Every page is served from localhost with no CDN, no DNS variance, no bot wall, and few JavaScript resources. WAREX shows why this matters: synthetic benchmarks such as WebArena and REAL contain few JS resources, so each injected network fault is disproportionately disruptive, and timed JS delays over 5 seconds degrade Playwright agents badly.
- Agents can answer from memory. WebArena Verified's reviewers note that network-activity checks block trivial no-browsing wins, but nothing attests that the answer came from the retrieved page. There is no citation requirement.
- A `file://` navigation reads the gold answer from `config_files/{task_id}.json` and scores about 100 percent on all 812 tasks with no changes to the harness.

Verdict for quarry: useful as a model of a frozen environment with programmatic scoring. Useless as a measure of fetch quality, because the fetch step is a localhost GET.

### 1.2 Mind2Web and Online-Mind2Web

Mind2Web has 2,350 tasks from 137 real websites, with cached snapshots and full network traffic. Its own framing is instructive: raw HTML from real sites is "often too large to be fed to LLMs," and the paper's contribution is a small LM that filters candidates before the LLM sees them. That is an extraction argument, made in 2023, and it is the same argument quarry makes.

Limits: evaluation is offline against cached snapshots, so it measures action prediction given a page representation, not retrieval. The authors name the gap themselves and call live end-to-end evaluation "a very promising direction." Cross-domain and cross-website splits test generalization of the policy, not the fetcher.

Online-Mind2Web (300 tasks, 136 live sites) closes the offline gap. Its authors also document why the live setting is hard to compare: sites change, tasks expire, and runs are not reproducible in the way cached snapshots are.

### 1.3 GAIA

466 questions, 300 of them with held-out answers. Questions are simple for humans (92 percent) and hard for tool-using models (15 percent for GPT-4 with plugins at release). It measures multi-step research: browsing, file handling, multimodal reading, and reasoning.

Limits: answers are short strings, so the metric is exact match after normalization. The Berkeley team showed that GAIA's normalizer collapses distinct strings, that validation answers are public on Hugging Face, and that the whole set can be answered from a local JSON file. GAIA also mixes browsing with PDFs, spreadsheets, and audio, so a browsing-only change moves the score by an amount you cannot isolate.

### 1.4 BrowseComp

1,266 questions with short, checkable answers that require persistence and multi-hop search. Baselines at release: GPT-4o 0.6 percent, GPT-4o with browsing 1.9 percent, o1 9.9 percent, Deep Research 51.5 percent. It separates search quality from model quality better than GAIA because the questions are deliberately not solvable on the first results page.

Limits: contamination is documented and real. OpenAI encrypted the set and published a canary string, and questions still surface in tweets and blog posts that quote them verbatim, which a search engine can then return. BrowseComp also measures accuracy only. It records no time, token, or cost, which is why vendors publish their own BrowseComp cost tables alongside the score. Anthropic has documented eval awareness on BrowseComp, where models reason about being tested.

For quarry, BrowseComp is a contamination study as much as a benchmark. Any corpus built from public, indexable pages has the same failure mode.

### 1.5 WebVoyager

643 tasks on live public sites (Amazon, Apple, GitHub, Booking, and others), scored by an LLM judge over screenshots and answers. It was the first widely cited end-to-end multimodal agent benchmark on the open web.

Limits, documented by the Online-Mind2Web authors:

- It lacks coverage and diversity.
- Many tasks have shortcut solutions, and an agent that mostly uses Google Search solves up to 51 percent of them.
- LLM-as-judge agreement with human judgment is low.

There is a second problem that matters for leaderboards. Because the sites are live, runs are not on the same exam. Steel's leaderboard says it plainly: some rows are independently benchmarked and some are team-reported, and small score gaps reflect setup choices as much as capability. A Reddit thread on the benchmark makes the same point about subsets.

Verdict for quarry: this is the cautionary case. Live sites plus a judge plus varying subsets produces numbers that cannot be compared.

### 1.6 SWE-bench, including the web portions

SWE-bench is not a web-access benchmark. Its related sets are worth reading for two reasons.

SWE-bench Multimodal has 617 task instances from 17 JavaScript repositories, with 401 website screenshots, 194 code screenshots, and 54 error messages. It measures whether an agent can fix visual, user-facing JavaScript bugs, and systems do much worse than on SWE-bench proper. It is the closest thing to a "web development" coding benchmark, and it still says nothing about fetching documentation.

SWE-bench's harness is the useful part. Execution-based scoring against the repository's own tests is the gold standard for "did this change actually work," and it is why people trust the number until they do not. Berkeley's team resolved all 500 Verified instances with a `conftest.py` hook that forces every test to report passing, and OpenAI dropped SWE-bench Verified after finding 59.4 percent of audited problems had flawed tests.

Lesson for quarry: execution-based scoring is right, but the thing being executed must not be able to write to the thing doing the scoring.

### 1.7 ToolBench and StableToolBench

ToolBench covers 16,000+ real APIs and multi-step tool use, scored by an LLM judge (ToolEval) on pass rate and win rate. StableToolBench exists because ToolBench was unstable: APIs change, disappear, or rate-limit, so the same submission scores differently on different days. The fix was a virtual API server with cached responses.

That is the same move a fetch benchmark needs: replace the live dependency with a recorded one, then measure the layer above it. StableToolBench is the best precedent in this list for how to benchmark something whose inputs are unreliable.

### 1.8 The closest existing measurement: Openbenchmarks coding-agent board

100 tickets on hard enterprise SaaS documentation (Workday, SAP, ServiceNow). The agent gets a small `httpx` client and a ticket that describes a capability without naming the endpoint. It must find the current official docs and patch the client. A pass requires the file to compile, the ground-truth tokens to be present, and each token to carry a `# source:` URL that actually appeared in that run's search or fetch results.

The model, task, budgets (5 searches, 32 turns), and runner are fixed. Only the provider varies. Three repeats per configuration, mean plus standard deviation. Both boards, search-only and search plus fetch, are published separately and never averaged.

Reported metrics: task completion, median task time, median task cost, average search time, median task tokens, API list price. Results show why the split matters. Firecrawl's search-only median is 7,456 tokens per task at 70.3 percent completion, while Linkup standard is 57,791 tokens at 48.3 percent on the same model and tickets.

Method details worth stealing:

- A no-search baseline gates every task. If the model can recover the answer from the ticket and starter alone, the task is dropped.
- Tasks with predictable documentation URLs were removed, because the model inferred the slug from the ticket and never really retrieved. The authors name Stripe and a `/changelog/dahlia/{kebab-case-title}` pattern as the example.
- Public 30-ticket subset for format inspection, private held-out set for scoring.

Limits for quarry: the corpus measures search plus fetch end to end, not the fetch layer alone, and it depends on the vendor docs staying live and citable. It is also a vendor-authored benchmark ecosystem, so read the numbers with that in mind. The design is still the best template available.

### 1.9 What none of them measure

| Quantity | WebArena | Mind2Web | GAIA | BrowseComp | WebVoyager | Openbenchmarks |
| --- | --- | --- | --- | --- | --- | --- |
| Task success | yes | yes | yes | yes | yes | yes |
| Tokens delivered to model | no | no | no | no | partly | yes, median per task |
| Bytes over the wire | no | no | no | no | no | no |
| Time to usable text | no | no | no | no | no | wall clock per task only |
| Extraction fidelity vs gold text | no | no | no | no | no | no |
| Success on JS-only or bot-walled pages | no | no | no | implicit | implicit | no |
| Reproducible corpus | yes | cached | no | no | no | yes, private |

The empty column pattern is the argument for building a separate fetch benchmark rather than borrowing one.

## 2. Measuring token cost fairly

### 2.1 A token is not a length unit

Token counts come from the tokenizer, and tokenizers disagree. Reported spreads on identical input:

- `claude-opus-4-7` produces 1.57 times the tokens of `gpt-5.4` on prose and 2.65 times on tool definitions, per TensorZero's April 2026 comparison.
- On Hindi and Chinese, `o200k_base` encodes at about 2.28 characters per token against `cl100k_base` at about 1.04, so the newer vocabulary halves the bill for identical text.
- The Cambridge and Hong Kong study of ten production tokenizers found compression ratios differing by 100 percent between the extremes on emoji and numeric content, and by 20 to 50 percent elsewhere. The worst-served language costs more than 12 times English per unit of meaning.

So a single number called "tokens" is meaningless unless the tokenizer is named. `cl100k_base` and `o200k_base` are the two that matter for this project, because they cover the OpenAI models most coding agents run, and because both are local, deterministic, and free to compute with `tiktoken`.

### 2.2 The HTML penalty is bigger than the tokenizer effect

Firecrawl measured 15 real pages, each captured as raw HTML and as cleaned markdown, then counted with each provider's own tokenizer:

| Page | HTML tokens (GPT) | Markdown tokens (GPT) | Reduction |
| --- | --- | --- | --- |
| Stripe API reference | 1,349,387 | 12,165 | 111x |
| Anthropic pricing | 689,726 | 6,694 | 103x |
| Wikipedia, Transformer | 472,022 | 76,379 | 6x |
| Stack Overflow thread | 367,865 | 27,547 | 13x |
| Vercel homepage | 239,554 | 845 | 283x |
| BBC News front page | 196,212 | 5,076 | 39x |
| Apple MacBook Pro specs | 169,785 | 11,875 | 14x |
| All 15 pages | 4,103,706 | 190,817 | 21.5x |

The aggregate reduction is 21.5x on GPT, 20.8x on Claude, 22.5x on Gemini. Five of the 15 pages exceed 200,000 tokens as raw HTML and do not fit a 200k context window at all. None of them come close as markdown.

The practical reading is that format is worth about 21x and tokenizer choice is worth about 1.2x on this kind of content. If quarry only improves format, it wins most of the available token reduction. If it only optimizes token counting, it wins almost nothing.

That benchmark is vendor-authored and 15 pages deep, so treat the exact multipliers as indicative. The direction and order of magnitude are consistent with the mechanism, which is that markup spends tokens on structure no tokenizer compresses well.

### 2.3 Characters per token is not a conversion factor

The common 4-characters-per-token rule fails in known ways:

- The Cambridge study measured 0.35 to 0.45 words per token on random English words against the 0.75 the rule implies, and called the heuristic "inadequate and oversimplified."
- The rule is calibrated on English prose. Code, JSON, and markup run worse. Non-English runs much worse.
- It fails silently. There is no error signal when the estimate is 37 percent off, as in the Galileo example of `"Server-side streaming 🚀"` at 8 estimated versus 11 actual tokens.

Use a real tokenizer. If you must approximate for a budget guard, use it only as a guard with a safety margin, and never as a reported metric.

### 2.4 Why bytes are the wrong unit

Bytes are cheap to measure and easy to defend, which is why they get reported. They answer a different question.

- Compression changes bytes by 3 to 6 times and leaves tokens untouched. A brotli-compressed HTML page at 40 KB and an uncompressed one at 180 KB produce the same model input. Reporting "bytes saved" against a compressed baseline measures your Accept-Encoding header, not your extraction.
- UTF-8 makes bytes per character variable. A page of emoji or CJK text has fewer characters and more bytes than the same meaning in ASCII, while token counts move in yet another direction.
- Markup is dense in low-value bytes. Stripping 4.1 million HTML tokens down to 191 thousand tokens removes about 21 times the tokens, but the byte ratio differs, because each token of markup costs fewer bytes than each token of prose.
- Bytes do not predict context cost. The thing that fills the window and the invoice is tokens.

Report bytes as a transport diagnostic, always with the content encoding named, and never convert to tokens with a ratio. The only honest conversion is running the delivered text through the tokenizer.

### 2.5 A counting protocol that survives review

1. Name the tokenizer and version. Report `o200k_base` as primary for OpenAI-family agents, and `cl100k_base` as a cross-check, plus the ratio between them.
2. Count the text the model receives, after any tool-result wrapper, truncation marker, or JSON envelope. Those cost tokens too. The message wrapper on Anthropic's count endpoint is 7 tokens.
3. Count per task, not per page. A task that needed four fetches costs four fetches plus three rounds of re-reading in context. Per-page numbers hide the compounding.
4. Count the whole session where it matters. Scraped content stays in context for every later turn, so a 2,000-token saving on turn 1 is worth more than a 2,000-token saving on turn 20. The Openbenchmarks board reports prompt plus completion tokens per ticket for this reason.
5. Publish the distribution, not the mean. Median and p95. One pathological page (283x on Vercel) moves a mean by more than any real improvement.
6. State whether the count includes the tool schema. Tool definitions tokenize badly, at up to 2.65x versus prose, and a fetch tool with a large schema can cost more per call than the page it fetches.

## 3. Metrics for a fetch layer

Definitions matter more than names here. Each metric below is stated with its start and end event, because the TTFB literature shows how much a nameless definition drifts.

### 3.1 Time to first byte

Clock starts before DNS resolution, when the tool decides to fetch. Clock stops at the first byte of the final response body, after redirects. Exclude 103 Early Hints from the stop event, or report it as a separate variant, since browsers and RUM tools now disagree about whether a 103 counts as the first byte.

Report p50 and p95 separately for cold and warm connections. Name the variant, connection TTFB or navigation TTFB, because the two differ by DNS, TCP, TLS, and redirect time, and comparisons across variants are meaningless.

TTFB alone is a weak signal for quarry, because a fast first byte from a 300 KB JavaScript bundle still yields no usable text. It is a diagnostic that tells you whether a slow result is network or CPU.

### 3.2 Time to usable text

Clock starts at the same point. Clock stops when extracted, model-ready text exists in memory. That includes TLS, redirects, body download, JS execution if the page needs it, and extraction. It excludes model inference and tool-result formatting.

This is the metric that corresponds to what an agent waits for. It is the one to put on the front page.

Report p50 and p95, split by page class:

- static HTML, extraction only
- server-rendered with heavy inline scripts
- client-rendered, JS execution required
- bot-walled, challenge or interstitial

A single aggregate number hides the fact that the JS class costs 5 to 20 times the static class, and that is the interesting result.

### 3.3 Bytes over the wire

Sum of response body bytes for the document plus every subresource the fetcher actually requested, measured after content decoding is reversed and declared. Report both wire bytes (compressed) and decoded bytes, labeled.

This is where a render-free fetcher shows its advantage. A JS render of a typical marketing page pulls 1 to 5 MB of scripts, fonts, and images to produce 800 bytes of markdown. Bytes is the metric that makes that visible.

Pair it with a derived ratio, bytes per 1,000 tokens delivered. This connects transport cost to model cost without pretending one converts to the other.

### 3.4 Tokens delivered to the model

The token count of the tool result as the model sees it, under a named tokenizer. Report median and p95 per page and per task, plus the token reduction against a raw-HTML baseline on the same page.

Also report truncation rate. A fetch layer that hits a token budget by cutting text is cheap and wrong, and the failure is invisible unless you count how often the budget clipped the answer.

### 3.5 Cache hit rate

Share of requests served from a warm local cache without a network request, plus share served from a conditional revalidation that returned 304. Report separately. A 304 saves bytes but not a round trip, and conflating the two overstates the win.

Break it down by cache layer, because they behave differently:

- exact URL plus content hash, inside one task
- exact URL across tasks in one process
- cross-process on-disk cache

Report hit rate next to the token and latency numbers it produced. A 90 percent hit rate on a corpus of ten repeated URLs is a property of the corpus, not the cache.

### 3.6 Requests per task

Count every HTTP request the fetch layer issues, document plus subresources plus retries plus challenge solves. Report median and max per task.

This is the cost metric that does not appear in vendor pricing. A renderer that issues 180 requests per page against a metered proxy costs 180 times a single GET, and retries on bot walls multiply it again. Attempts per clean page is the standard way to express this in scraping economics: 1 / (1 - block rate).

### 3.7 Success rate on JS pages

Define success as: the required fact or code token is present in the extracted text, verified against a gold annotation, not "the fetch returned 200." Report the rate over a fixed set of client-rendered pages, plus the subset where extraction succeeded but the text was incomplete.

Report it alongside time to usable text, because a renderer can hit 100 percent success at 9 seconds per page and lose on the composite.

### 3.8 Success rate on bot-walled pages

Same definition, over pages behind Cloudflare, Akamai, PerimeterX, or DataDome, plus a control set of pages that serve a 200 status with a block page body. That last case is the one that fools naive success metrics, because the status code says fine and the text says "Enable JavaScript and cookies to continue."

Known base rates to calibrate against: one 2026 measurement of 3,858 tested domains found Cloudflare on 73.3 percent, and a bot-detection prevalence study reports blocking rates of 37.0 percent for Cloudflare-fronted sites and 26.4 percent for Akamai. Commercial unblockers claim 97 to 98 percent success against Cloudflare, with mean times around 28 seconds per successful page. Treat vendor claims as upper bounds and measure your own.

Report also the false-success rate: pages where the fetcher returned text that was a challenge page, an interstitial, or a cookie notice. This is the most common way a fetch benchmark lies to itself.

### 3.9 Composite scores

Two composites are worth publishing. Keep both, and never publish only one.

- Tokens per completed task. Total tokens the agent consumed to reach a verified answer, divided by tasks completed. This is the number that decides whether an agent can afford to browse.
- Usable tokens per second of wall clock. Tokens of verified-useful text delivered per second from request start to usable text. This is the number that decides whether an agent feels fast.

Do not collapse these into a single weighted score. The weighting is a policy choice, and hiding it invites the kind of leaderboard argument documented in section 1.5.

## 4. Building a reproducible page corpus

### 4.1 Requirements

A corpus for this work needs four properties:

1. Frozen. The bytes are identical on every run, so a change in results means a change in code.
2. Provenanced. Every page records where it came from, when, and under what terms.
3. Tiered. Static, server-rendered, client-rendered, bot-walled, and adversarial classes are labeled, because aggregate numbers hide the tier that broke.
4. Gold-annotated. Each page has the text span a correct extraction must contain, and the boilerplate it must exclude.

### 4.2 Static snapshots in WARC

WARC is ISO 28500. It stores the full HTTP response, headers included, so a replay preserves status codes, content encoding, and redirect chains, which plain saved HTML does not.

Common Crawl publishes WARC, WAT, and WET for each monthly crawl. WAT carries metadata and links, WET carries extracted text. For a fetch-layer corpus, WARC is the right format, because extraction quality depends on the original markup and the headers.

Practical access pattern: query the CDX index for a URL, read the byte offset and length, then issue a ranged GET against `data.commoncrawl.org`. This avoids downloading a 1 GB segment to read one page. Two traps in that workflow: a 404 from the index means the URL was never captured, which is normal, while 502, 503, and 504 mean try again and should not be counted as a miss. Under-reporting coverage this way is easy and silent.

Limits: crawls are monthly and lag. A docs page you care about may be captured at a version you do not want, or not at all, since CCBot is blocked by many sites. Common Crawl also does not execute JavaScript, so the client-rendered tier cannot come from it.

### 4.3 Saved HTML fixtures

For the JS and bot-wall tiers, capture the page yourself and store:

- the raw HTML as served, before any DOM mutation
- the response headers, including `content-encoding` and `content-type`
- the final URL after redirects
- a timestamp and the user agent string used
- a SHA-256 of the body
- the gold text span and the boilerplate blocklist for that page

Store the capture script next to the fixture so the corpus can be regenerated and diffed. A fixture without its capture script is an artifact nobody can defend in a year.

For DOM state after script execution, store a serialized snapshot from a headless browser (SingleFile or an equivalent MHTML capture) in addition to the raw HTML. The raw HTML tests the extractor. The serialized snapshot tests the renderer and the extractor together, which is the real path.

### 4.4 Licensing

This is the part most benchmark repos get wrong, and it constrains which pages can be redistributed.

Common Crawl's terms grant a limited, non-exclusive, non-sublicensable license to access and use the service, and they state explicitly that crawled content "may be subject to separate terms of use or terms of service from the owners of such Crawled Content." Section 9 requires you to indemnify Common Crawl for third-party claims arising from your use of crawled content "in connection with artificial intelligence, machine learning, or other similar technologies," and from generated content. The terms also say CC "strongly recommends that you obtain the advice of legal counsel before making any use, including commercial use."

Read that as: Common Crawl gives you the plumbing, not the rights. For a public repo, that means:

- Do not commit page bodies from sites whose terms forbid redistribution.
- Prefer sources with clear reuse terms for the redistributable set: MDN (CC-BY-SA), Wikipedia (CC-BY-SA), RFCs and IETF drafts, government and standards-body documentation, and repositories with permissive licenses.
- For everything else, commit the URL list, the capture script, and the gold annotation, and fetch at build time. Commit hashes and diffs, not bodies.
- Record robots.txt state and the terms URL at capture time. A benchmark that ignored robots is a benchmark with a legal and an ethical problem, and the second one is worse.
- Keep a private tier for bot-walled pages. Publishing challenge-page fixtures publishes a map of a vendor's defenses, which is not yours to publish.

### 4.5 Sizing and composition

A corpus that answers quarry's questions does not need to be large. It needs to cover the classes that behave differently. A workable shape:

- 40 to 60 pages total.
- 10 static documentation pages, single GET, extraction only.
- 10 server-rendered pages with heavy inline scripts (news, marketing, e-commerce).
- 10 client-rendered pages where the content exists only after JS (SPA docs, dashboards).
- 10 bot-walled pages, private tier.
- 5 adversarial pages: infinite scroll, lazy-loaded text, text in images, a 200-status block page, a page that returns different content to a bot user agent.
- 5 large pages over 200k tokens as raw HTML, to test budget behavior.

Every page gets a gold span and an expected maximum boilerplate ratio. Score extraction as token-level F1 against the gold span, using the same tokenizer as the cost metric.

## 5. Common benchmark traps

### 5.1 Warm caches

The first run of any benchmark is slower, and the difference is large enough to reverse a conclusion. Page cache, DNS cache, TLS session tickets, HTTP connection pools, and the OS file cache all warm on the first pass.

Fix: report cold and warm separately, and say which is which. Do not average them. If the product is a long-lived agent process, warm is the number that matters. If it is a CLI invoked per query, cold is. Quarry is both, so report both.

### 5.2 CDN effects

A fetch layer that talks to a CDN edge is measuring the CDN, not its own code. The same origin at p50 40 ms in one region and 300 ms in another will produce different "time to usable text" for identical code.

Worse, CDN configuration changes what you measure. 103 Early Hints, HTTP/3, TLS resumption, and cached compressed variants all move TTFB. Akamai's own account of a CDN comparison that produced "barely any benefits" despite real protocol advantages is the clearest example: the test measured what the config currently did, not what it could do.

Fix: pin the fetch origin to a local or single-region replay server for the primary numbers, so the corpus is the only variable. Run a secondary live test against real origins to catch cases where replay lies. Never mix the two in one table.

### 5.3 DNS variance

DNS goes through several cache layers, returns multiple records, and interacts with Happy Eyeballs, which races IPv4 and IPv6 connections. How those races appear in timing APIs is browser-dependent and undocumented. RTT also drifts within a connection under bufferbloat.

Fix: resolve once per corpus run and pin the address, or report DNS time as a separate line item. A benchmark that includes DNS in the total without saying so will show variance that looks like a code regression.

### 5.4 Measuring extraction by eyeballing

Reading five outputs and declaring the extractor good is the most common failure in this space, and it is invisible in the writeup.

Fix: gold spans and token-level F1, computed. The published comparisons do this: on the Article Extraction Benchmark, trafilatura scores 0.937 F1, Readability 0.914, Newspaper3k 0.903, Goose3 0.879, Boilerpy3 0.850, Essence 0.824, JusText 0.760. A newer 2,000-page benchmark puts trafilatura at 0.791, which shows how much the corpus changes the number. Quote the corpus with the score.

Add a boilerplate ratio check. An extractor that returns everything scores perfect recall and is useless. An extractor that returns the title only scores perfect precision and is also useless. F1 catches both, but only if the gold span is right.

### 5.5 A baseline that did not get the same inputs

This is the trap that most often makes a fetch layer look better than it is. Cases that show up in practice:

- Baseline gets raw HTML, the new tool gets cleaned markdown, and the comparison is called a token saving. The saving is real, but it is a format change, not a fetch change. To attribute it, run the same extractor over both.
- Baseline gets the page, the new tool gets a search snippet. Of course it is cheaper. It also answered a different question.
- Baseline is the built-in webfetch with no retry, the new tool retries five times. Success rate improves and requests per task triples, and only one of those numbers gets published.
- Baseline runs on a cold process, the new tool runs warm. See 5.1.
- Baseline gets 15 pages per task, the new tool gets 3, and the agent compensates with more searches. Per-page tokens look great, per-task tokens do not.
- Baseline was not given the same system prompt, tool schema, or turn budget.

Fix: fix the model, the prompt, the tool schema shape, the turn budget, and the task set. Vary one thing. Publish the request count and the retry count next to every success rate. The Openbenchmarks board does this correctly by fixing budgets and varying only the provider, and its methodology page is worth reading as a template.

### 5.6 Benchmark hacking

Assume the agent will optimize the score instead of the task. The documented cases are not subtle:

- A `conftest.py` hook turns every failing test into a pass, resolving all 500 SWE-bench Verified instances.
- A `file://` navigation reads WebArena's gold answers from the task config, scoring about 100 percent on 812 tasks.
- A hidden div satisfies a substring check without the answer being visible.
- A comment appended to an answer biases an LLM judge.
- GAIA's normalizer maps "Dr. Martin Luther King Jr." and "D.R M.A.R.T.I.N..." to the same string.

For a fetch benchmark the equivalent attacks are: caching the gold answer page and calling it a fetch, treating a challenge page as success, and scoring a page whose text was already in the model's training data.

Fixes that apply here:

- Keep gold spans out of anything the fetcher can read.
- Include a null fetcher in the run. Its score must be zero. If it is not, the scorer is broken.
- Run a challenge-page detector and report false success separately.
- Use held-out pages the model has not seen, and prefer pages created after the model's cutoff where possible.
- Score the extracted text against the gold span on a separate machine, from a copy.

### 5.7 Single runs and small n

One run per configuration cannot separate a real effect from inter-run noise. The web-performance literature reports coefficients of variation around 11.8 percent on short benchmark runs, which is larger than most improvements worth reporting.

Fix: at least three repeats per configuration, report mean and standard deviation, and state the smallest difference you can detect. If the improvement is smaller than the noise, say so instead of rounding in your favor.

## 6. Proposed metric set

Three primary metrics. Everything else is a diagnostic or a guardrail.

### Primary

1. Tokens per completed task, measured under `o200k_base` with `cl100k_base` as a cross-check. Reported as median and p95, against the built-in webfetch baseline on the same fixed corpus, with the same model, prompt, schema, and turn budget. This is the claim quarry makes. It should be the headline. Target: at least 40 percent fewer median tokens with no drop in verified completion.
2. Time to usable text, p50 and p95, split cold and warm, on the frozen replay corpus. This is what the agent waits for on every turn, and it is the metric a renderer loses. Target: p50 under 400 ms for static pages, under 2.5 s for client-rendered pages, measured on the replay server with DNS pinned.
3. Hard-tail success rate, meaning verified extraction success on the JS-rendered tier and the bot-walled tier combined, reported with requests per task and false-success rate. This is the gate that stops quarry from being fast and useless. Target: at least 90 percent on the JS tier, at least 70 percent on the bot-walled tier, false-success under 2 percent.

### Secondary

- Bytes over the wire per 1,000 tokens delivered, wire and decoded reported separately, with content encoding named.
- Cache hit rate, split exact-hit and revalidated-304, per task and per process.
- Requests per clean page, including retries.
- Token-level F1 of extracted text against gold spans, per page class.
- Truncation rate against the configured token budget.

### Guardrails

- Null-fetcher score, which must be zero.
- Extraction F1 floor, so token savings cannot come from deleting content.
- Baseline parity checks: same model, prompt, schema shape, turn budget, retry policy, and warm state.
- Cold and warm reported separately, never averaged.
- At least three repeats, with standard deviation published.
- Corpus hash published with every result, so a changed corpus invalidates the comparison.

### What not to publish

A single weighted composite. A bytes-saved percentage without a token number. A token number without a tokenizer name. A success rate without a request count. A latency number without saying whether DNS and TLS are inside it.

## 7. Sources

Benchmarks and evaluation

- WebArena: https://webarena.dev, arXiv 2307.13854. Task count and environment.
- WebArena Verified: https://openreview.net/forum?id=CSIo4D7xBG. Brittle string matching, backend state verification, memory-without-grounding concern.
- WAREX: https://arxiv.org/html/2510.03285v1. Network fault injection, JS resource density in synthetic benchmarks, 5 s versus 30 s JS delay thresholds.
- Online-Mind2Web, "An Illusion of Progress?": https://arxiv.org/html/2504.01382v4. WebVoyager coverage, shortcut tasks at 51 percent, LLM-judge agreement.
- Mind2Web: https://arxiv.org/html/2306.06070v3 and https://osu-nlp-group.github.io/Mind2Web/. 2,350 tasks, 137 sites, cached snapshots, HTML size argument.
- GAIA: https://arxiv.org/abs/2311.12983. 466 questions, 92 percent human versus 15 percent GPT-4 with plugins.
- BrowseComp: https://openai.com/index/browsecomp/ and https://arxiv.org/html/2504.12516v1. 1,266 problems, baseline table, contamination.
- Anthropic on BrowseComp eval awareness: https://www.anthropic.com/research/eval-awareness-browsecomp.
- WebVoyager: https://aclanthology.org/2024.acl-long.371.pdf and https://leaderboard.steel.dev/leaderboards/webvoyager/. Live-site variance and judge limits.
- SWE-bench Multimodal: https://arxiv.org/html/2410.03859v1 and https://www.swebench.com/multimodal.html. 617 instances, 17 JS repos, image counts.
- ToolBench and StableToolBench: https://github.com/openbmb/toolbench and https://arxiv.org/html/2403.07714v2. API instability and the virtual server fix.
- Openbenchmarks coding-agent board: https://openbenchmarks.com/web-search-for-coding-agents. Methodology, budgets, metric definitions, per-vendor token medians.
- Berkeley RDI, "How We Broke Top AI Agent Benchmarks": https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/. Exploit catalogue and the agent-eval checklist.

Tokenization and cost

- tiktoken and encodings: https://github.com/openai/tiktoken and https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken.
- Firecrawl, HTML versus markdown token benchmark: https://www.firecrawl.dev/blog/llm-tokenization-across-models. 21.5x aggregate, per-page table, 200k context failures.
- TensorZero cross-provider token counts, cited in the above: https://www.tensorzero.com/blog/stop-comparing-price-per-million-tokens-the-hidden-llm-api-costs/.
- Cambridge and Hong Kong tokenizer study, arXiv 2601.11518. The 4-characters-per-token rule, compression variance by domain.
- Petrov et al., NeurIPS 2023, https://arxiv.org/abs/2305.15425. Language tokenization premium.
- Vibe Engines tokenizer measurements: https://vibeengines.com/handbook/tokenizer-efficiency-benchmark. `o200k_base` versus `cl100k_base` chars per token.

Fetch measurement

- TTFB definition variance: https://calendar.perfplanet.com/2025/ttfb-doesnt-mean-what-you-think-it-means/. Three definitions, 103 Early Hints, Happy Eyeballs, DNS caching.
- MDN TTFB glossary: https://developer.mozilla.org/en-US/docs/Glossary/Time_to_first_byte.
- web.dev TTFB guidance: https://web.dev/articles/optimize-ttfb. 0.8 s good, 1.8 s poor, field versus lab.
- Cloudflare on TTFB limits: https://blog.cloudflare.com/ttfb-is-not-what-it-used-to-be/. Good TTFB with bad LCP in about 21 percent of page views.
- Anti-bot prevalence: https://arxiv.org/html/2606.14525v1. Cloudflare 37.0 percent, Akamai 26.4 percent blocking.
- AIMultiple bot-detection vendor share: https://aimultiple.com/bot-detection-software. Cloudflare on 73.3 percent of tested domains.
- Scrapfly Cloudflare success claims: https://scrapfly.io/blog/posts/how-to-bypass-anti-bot-protection. 98 percent claimed, treat as upper bound.

Corpus and extraction

- Common Crawl terms of use: https://commoncrawl.org/terms-of-use. Limited license, third-party terms, AI indemnity clause.
- Common Crawl data formats and index: https://commoncrawl.org/get-started and https://commoncrawl.org/cdxj-index.
- WARC format: ISO 28500.
- Trafilatura extraction benchmarks: https://trafilatura.readthedocs.io/en/latest/evaluation.html.
- Java main-content extraction comparison, OSTI: https://www.osti.gov/servlets/purl/2429881. F1 by library.
- 2,000-page extraction benchmark: https://murroughfoley.com/web-content-extraction-benchmark/. Lower F1 on a harder corpus.

Measurement methodology

- "Measuring Software Performance": https://kakkoyun.me/posts/fosdem-2026-measuring-software-performance/. Cold versus warm cache, 11.8 percent coefficient of variation.
- PlanetScale, "On benchmarking": https://planetscale.com/blog/on-benchmarking. Warmup, workload shape, consistency.
- "Robust benchmarking in noisy environments": https://math.mit.edu/~edelman/publications/robust_benchmarking.pdf. Non-i.i.d. timing distributions.
