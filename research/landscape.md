# How coding agents reach the web today

Research note, 4 Nov 2026. Every number below comes from a linked primary source unless the sentence says "inferred". Inferred means I read the docs and the behaviour follows from them, but no page states it outright.

Scope: the fetch and search paths shipped inside Claude Code, OpenAI Codex CLI, and Cursor, plus the MCP servers people bolt on. The question behind it is where a web-access layer for a coding agent would earn its place, so the note tracks coverage (can it read the page), cost (tokens and dollars), and failure modes.

---

## 1. Summary: the three largest gaps

### Gap 1. Nothing is both JS-capable and cheap

A text fetcher returns empty on client-rendered pages. A browser renders the page and then bills you for the whole DOM.

The numbers make the trade explicit.

- Anthropic prices context at roughly 2,500 tokens per 10 kB of page. A 100 kB docs page is about 25,000 tokens, and a 500 kB PDF is about 125,000 tokens ([Anthropic web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)).
- Claude Code caps a fetch at 100,000 characters per call, which is roughly 25,000 tokens ([Claude Code tools reference](https://code.claude.com/docs/en/tools)).
- Claude Code, Claude Desktop, and Cursor cap a single MCP tool response at 25,000 tokens. Jina had to add a truncation guard to fit ([Jina MCP README](https://github.com/jina-ai/MCP)).
- Browser rendering is not free either. Jina's OCR path billed 61,520 tokens for page 1 of a 20-page arXiv paper, against 13,864 tokens for the plain whole-document read ([Jina MCP README](https://github.com/jina-ai/MCP)).

So the cheap path fails on JS, and the working path costs 2 to 5 times the page. No shipping agent resolves this. Anthropic's own answer is to add a server-side code execution step that filters the page before it enters context (`web_fetch_20260209` and later), which moves the filter but does not remove the fetch cost ([Anthropic web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)).

### Gap 2. Search returns links, so reading is an N+1 loop with quadratic cost

Claude Code's WebSearch returns "result titles and URLs. It doesn't fetch the result pages" ([Claude Code tools reference](https://code.claude.com/docs/en/tools)). Every page the agent actually needs is a second call. At 25,000 tokens per page, 10 reads is 250,000 tokens before the agent writes anything.

The loop cost compounds. In an N-turn tool loop the last prompt carries N-1 turns of context, so total token spend grows as O(N²) ([agent serving cost analysis](https://blog.prompt20.com/posts/agent-serving-infrastructure/)). The only built-in brakes are a 200 WebSearch call cap per interactive session, shared across subagents, and a `max_uses` parameter that defaults to no limit on the API ([Claude Code tools reference](https://code.claude.com/docs/en/tools), [Anthropic web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)).

### Gap 3. Defaults differ by 20x and caching is arbitrary

The same page fetched through different tools comes back at wildly different lengths.

| Path | Default ceiling per call |
|---|---|
| `mcp-server-fetch` | 5,000 characters |
| Claude Code WebFetch | 100,000 characters |
| MCP responses in Claude Code, Desktop, Cursor | 25,000 tokens |
| Anthropic API `max_content_tokens` | unset unless you set it, example uses 100,000 |

Source: [mcp-server-fetch README](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch), [Claude Code tools](https://code.claude.com/docs/en/tools), [Jina MCP README](https://github.com/jina-ai/MCP), [Anthropic web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool).

Caching is equally unsettled. Claude Code caches per URL for 15 minutes. Jina caches for 5 minutes. `mcp-server-fetch` does not cache at all. Codex has a "cached" search mode served from an OpenAI-maintained index. Four tools, four answers, and none of them let the agent ask "is this the current version of the page" in a portable way.

---

## 2. Claude Code

### 2.1 WebFetch

The tool takes two inputs, a URL and a prompt describing what to extract. It fetches, converts HTML to Markdown when the server returns HTML, then runs the prompt against that content in a separate model call. Claude receives the model's answer, not the page ([Claude Code tools reference](https://code.claude.com/docs/en/tools)).

That design is lossy on purpose. Anthropic states it directly: "a result that says a page doesn't mention something may only mean the prompt didn't ask about it." The workaround they recommend is to refetch with a more specific prompt, or to use `curl` through Bash for the raw page.

Concrete limits:

| Property | Value |
|---|---|
| Max content read | 100,000 characters per call. On v2.1.290+ the result says how much went unread |
| Cache | 15 minutes per URL, tunable via `CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS` (v2.1.233+) |
| Deadline | 5 minutes including redirects, tunable via `CLAUDE_CODE_WEBFETCH_DEADLINE_MS` (v2.1.268+), `0` disables |
| Hosts refused | `localhost` and any hostname without a dot, before the request is made |
| Scheme | HTTP is upgraded to HTTPS automatically |
| Cross-host redirect | Not followed. Returns text naming the original URL and the target, so the model issues a second call |
| Headers | `User-Agent` starts with `Claude-User`. `Accept` prefers Markdown over HTML |
| Disable | `CLAUDE_CODE_DISABLE_WEB_FETCH=1` (v2.1.285+) |
| Permission | Prompts in Manual and `acceptEdits`, except allow-listed domains and a built-in set of preapproved docs domains |

Source: [Claude Code tools reference](https://code.claude.com/docs/en/tools).

**Can it POST or authenticate?** No. The tool signature is URL plus prompt. The docs describe GET with a `User-Agent` and an `Accept` header, and no parameter carries a method, body, header, or cookie. The API version of the tool returns `invalid_tool_input` for "a non-HTTP(S) scheme" and lists no method option. Inferred: there is no supported way to POST, send auth headers, or hold a session. The escape hatch both Anthropic docs point to is `curl` through Bash, which has the network access the sandbox allows.

**How it handles JS pages.** It does not execute JavaScript. Anthropic's server tool docs say the web fetch tool "currently does not support websites dynamically rendered with JavaScript" and point to a separate browser use tool. Claude Code inherits that. The real-world reports match. In [issue #8331](https://github.com/anthropics/claude-code/issues/8331) a user hit 100% failure across 30+ URLs and traced one case to GitHub Discussions loading comments through JavaScript, so the fetch saw only the initial HTML. Another commenter describes spending two extra hours because the fetched text stopped at "From the docs:" and the config block was missing.

Reverse engineering agrees with the docs. Liran Yoffe's teardown found a 900,000 ms (15 minute) URL-keyed cache and a secondary conversation on Claude Haiku that summarises the page. Their sample call used 29,439 input tokens and 710 output tokens, about $0.033 per fetch at Haiku pricing ([reverse-engineering writeup](https://medium.com/@liranyoffe/reverse-engineering-claude-code-web-tools-1409249316c3), [repo](https://github.com/LiranYoffe/reverse-engineering-claude-code-web-tools)). The current docs confirm the separate model call but do not name the model.

The practical consequence: two fetches of the same page with different prompts can produce different "facts", and neither is the page.

### 2.2 WebSearch

- Input: a query, plus `allowed_domains` or `blocked_domains`. The two lists cannot be combined in one call.
- Backend: Anthropic's search backend. Not configurable. To use another provider you add an MCP server.
- Return shape: titles and URLs only. No page text.
- Internal fan-out: up to 8 backend searches per call, refined before results return.
- Session cap: 200 calls per interactive session, counting main conversation and subagents against the same limit.
- Retry: backs off on an overloaded API, returns an error result if it still fails.

Source: [Claude Code tools reference](https://code.claude.com/docs/en/tools).

The 200 cap is a hard wall in research-heavy sessions. At the cap, searches appear as calls that did nothing and the model is told to continue with what it has.

### 2.3 The API-side tools, for contrast

Claude Code's tools are client-side wrappers. The API versions are server tools with a different parameter set.

`web_fetch` parameters ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)):

| Parameter | Effect |
|---|---|
| `max_uses` | Cap fetches per request. Failed fetches count. No default limit |
| `allowed_domains` / `blocked_domains` | Domain filter, mutually exclusive |
| `max_content_tokens` | Truncate content before context. Approximate, text only, not PDFs |
| `citations.enabled` | Off by default, unlike web search |
| `url_sources` | Turn off URL sources, or exclude named client tools |
| `use_cache` | `false` bypasses cache. Requires `web_fetch_20260309`+ |
| `response_inclusion` | `excluded` drops echoed result blocks. Requires `web_fetch_20260318`+ |

Additional hard limits: URLs over 250 characters fail with `url_too_long`. Only text, HTML, and PDF are supported. The tool only fetches URLs that already appeared in user messages, client tool results, or earlier search or fetch results, so the model cannot invent a URL and fetch it. URLs that look like they contain a credential are refused unless the credential came from the user or system prompt. Errors return HTTP 200 with an error code in the body: `url_not_accessible`, `too_many_requests`, `unsupported_content_type`, `content_too_large`, `max_uses_exceeded`, `unavailable`.

Pricing: web fetch has no additional charge beyond tokens. Web search costs $10 per 1,000 searches plus tokens ([web search docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)).

---

## 3. OpenAI Codex CLI

Codex ships a hosted `web_search` tool and no dedicated fetch tool. Page reading happens through the shell, which means `curl` governed by the sandbox network policy, or through an MCP server.

### 3.1 Search modes

`web_search` takes four values ([Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)):

| Value | Behaviour |
|---|---|
| `disabled` | Removes the tool |
| `cached` | Default. Uses an OpenAI-maintained index without external web access |
| `indexed` | Permits external access only when gated by the search index |
| `live` | Unrestricted live retrieval, same as `--search` for a single run |

`--yolo` and other full-access sandbox settings default the mode to `live`.

The default is the interesting part. A Codex session with default config does not touch the live web for search at all. It queries an index OpenAI maintains. The mode is easy to miss because the tool is present and answers normally.

### 3.2 Search parameters

```toml
[tools.web_search]
context_size = "medium"          # low | medium | high
allowed_domains = ["docs.python.org"]
location = { country = "US", region = "CA", city = "SF", timezone = "America/Los_Angeles" }
```

`context_size` controls how much search context the model gets. The reference names the three levels and does not publish token counts for them. Domain filters apply to search only. They do not restrict connectors, MCP servers, or sandboxed command traffic ([Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)).

### 3.3 How it differs from Claude Code

- No fetch tool. There is no `web_fetch` equivalent in the config reference. Reading a page means `curl`, a browser MCP server, or an MCP fetch server. Inferred from the reference listing `web_search` as the only hosted web tool.
- Search is cached by default, so freshness is opt-in. Claude Code searches live by default.
- Per-tool output budgets are configurable. `mcp_servers.<id>.tools.<tool>.output_token_limit` sets a token budget per MCP tool, "before the standard 20% serialization allowance". The default MCP tool timeout is 60 seconds and the default startup timeout is 10 seconds.
- MCP input schemas are compacted above 5,000 UTF-8 bytes per tool.
- Hook output over 2,500 tokens is written to disk and the model sees a preview instead.

Source for the last four: [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference).

That output budget is the one place among the three agents where the operator can cap a single tool response in tokens rather than characters.

---

## 4. Cursor

Cursor has two separate web paths, and in 2.x the boundaries moved.

### 4.1 Browser tool

A full browser the agent drives, described as "optimized ... to reduce token usage" ([Cursor browser docs](https://cursor.com/docs/agent/tools/browser)).

Capabilities: navigate, click, type, scroll, screenshot, read console output, inspect network traffic.

Design choices that matter for cost:

- Browser logs are written to files the agent greps and reads selectively, instead of a summary after every action.
- Screenshots go through the file reading tool so the agent sees images rather than text descriptions.
- The agent is prompted to detect a running dev server and reuse its port.

State persists per workspace: cookies, `localStorage`, `sessionStorage`, and IndexedDB survive between sessions. That is how a logged-in page stays readable, and it is the only one of the three agents with session persistence as a documented default. Playwright MCP can do it with a profile directory, but it is not the default for every user.

Security: browser tools require approval by default, with manual, allow-listed, and auto-run modes. Enterprise admins get an origin allowlist that restricts `browser_navigate` and MCP tool execution to listed origins. The docs are candid that the allowlist is best effort: link navigation, redirects, and `window.location` can all leave the allowed set.

### 4.2 Web search, and its failure

Cursor also has a web search tool, separate from the browser. It has no public doc page in the 2026 docs index. The evidence for its behaviour is a Cursor staff reply and a long-running bug thread.

In January 2026 a Cursor staff member wrote that "web search tool is broken for 4 month" and that they were "planning to ship a new agent tool soon for fetching web content" ([Cursor forum thread](https://forum.cursor.com/t/cursor-2-x-removes-useful-web-and-link-features/148088)). The linked bug report says the agent's search query is replaced by the user's raw prompt, so results do not match what the agent asked for ([bug report](https://forum.cursor.com/t/agent-cant-web-search-properly/132658)).

The same thread records the bot wall problem. Cursor's staff tested a `lore.kernel.org` link and concluded "the issue will likely persist due to a bot-protection system that prevents tools like Cursor from accessing the URL." Their advice was to paste the content or force the browser tool.

Cursor 2.x also removed `@Web`, `@Link`, and `@Code` from the prompt editor. The replacement is automatic URL detection plus the browser. Users report this made behaviour non-deterministic and raised token burn as the agent guesses intent ([same thread](https://forum.cursor.com/t/cursor-2-x-removes-useful-web-and-link-features/148088)). A URL containing `@` was not recognised as a link at all, which a staff member filed as a bug.

---

## 5. MCP servers for web access

### 5.1 `mcp-server-fetch` (the official reference server)

Package: `mcp-server-fetch`, Python, run with `uvx mcp-server-fetch` or `pip install mcp-server-fetch`. Transport is stdio. Requires MCP Python SDK 2.x (`mcp>=2.3,<3`).

One tool, `fetch` ([README](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)):

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `url` | string | required | URL to fetch |
| `max_length` | integer | 5,000 | Max characters returned |
| `start_index` | integer | 0 | Character offset, so the model can page through a long document |
| `raw` | boolean | false | Skip Markdown conversion |

Output is Markdown extracted with ReadabiliPy, which uses Mozilla Readability.js in a Node subprocess when Node is on `PATH` and a pure-Python fallback otherwise. The pure-Python path "keeps headings and text but drops link targets".

Safety and behaviour:

- Obeys `robots.txt` for tool-initiated fetches, not for prompt-initiated ones. Every redirect hop is checked too.
- Refuses private, loopback, link-local, and cloud metadata addresses, and checks each redirect hop. `--allow-private-ips` turns the guard off.
- User agent is `ModelContextProtocol/1.0 (Autonomous; +https://github.com/modelcontextprotocol/servers)` for tool calls and `... (User-Specified; ...)` for prompt calls.
- Proxy via `--proxy-url` or the standard `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` variables, with SOCKS5.
- Errors come back as tool results with `isError: true`, not protocol errors.
- Speaks both the 2026-07-28 and 2025-11-25 protocol eras, decided by the client's first request.

The 5,000 character default is the single most consequential number in this section. A 100 kB page is truncated to 5% of itself unless the model knows to page with `start_index`, and the truncation is silent in the sense that the tool does not tell the model what fraction it saw.

`@modelcontextprotocol/server-fetch` does not exist. The npm registry returns 404 for that name. The official implementation is the Python package above.

### 5.2 Firecrawl MCP

Transport: hosted Streamable HTTP at `https://mcp.firecrawl.dev/v2/mcp` (key, OAuth at `/v2/mcp-oauth`, or keyless), or a local stdio server against the cloud or a self-hosted API ([docs](https://docs.firecrawl.dev/mcp-server)).

Tool surface, by job ([tool list](https://docs.firecrawl.dev/mcp-server/tools)):

| Job | Tools |
|---|---|
| Read one page | `firecrawl_scrape` |
| Structured data | `firecrawl_scrape` with JSON format |
| Discover URLs | `firecrawl_map` |
| Search | `firecrawl_search` |
| Crawl | `firecrawl_crawl`, `firecrawl_check_crawl_status` |
| Files | `firecrawl_parse` |
| Autonomous research | `firecrawl_agent`, `firecrawl_agent_status` |
| Live page control | `firecrawl_interact`, `firecrawl_interact_stop` |
| Monitoring | `firecrawl_monitor_*` |
| Specialist indexes | `firecrawl_developer_search`, `firecrawl_gov_search`, `firecrawl_research_*` |

Keyless exposes exactly three: `firecrawl_search`, `firecrawl_scrape`, `firecrawl_parse`. The former Extract tool is deprecated in favour of Scrape with a JSON format.

Pricing ([pricing page](https://firecrawl.dev/pricing)):

| Plan | Credits/month | Price | Concurrency |
|---|---|---|---|
| Free | 1,000 | $0 | 2 |
| Hobby | 5,000 | $19/mo, $16 annual | 5 |
| Standard | 100,000 | $99/mo, $83 annual | 25 |
| Growth | 500,000 | $399/mo, $333 annual | 50 |
| Scale | 1,000,000 | $749/mo, $599 annual | 100 |

Credit costs: 1 per page scrape, 1 per PDF page, +4 for JSON format, +4 for prompt injection check, 1 per map call, 2 per 10 search results, 2 per browser minute for Interact. Failed scrapes with no result are not charged. A 403 or 404 still costs 1 credit because the error page is returned.

Rate limits ([rate limits](https://docs.firecrawl.dev/rate-limits)): Free is 10 requests/minute for `/scrape`, `/map`, and `/search`, 2/minute for `/crawl` and `/agent`, 2 concurrent browsers. Keyless is capped per IP per day by both a request count and a credit count, and the docs do not publish either number.

### 5.3 Jina Reader and the Jina MCP server

Reader is a URL prefix, not an SDK. `https://r.jina.ai/<url>` returns LLM-ready text. `https://s.jina.ai/?q=` returns the top five search results with content ([reader page](https://jina.ai/reader/)).

Headers worth knowing:

| Header | Effect |
|---|---|
| `X-Engine` | `direct` for a plain HTTP fetch, default is headless browser, `cf-browser-rendering` experimental |
| `X-Timeout` | Page load timeout in seconds |
| `X-Token-Budget` | Hard cap; the request fails if exceeded |
| `X-Target-Selector` / `X-Remove-Selector` | Keep or drop CSS selectors |
| `X-No-Cache` / `X-Cache-Tolerance` | Bypass cache, or accept content younger than N seconds |
| `X-Set-Cookie` | Forward cookies. Requests with cookies are never cached |
| `X-Retain-Images: none` | Strip images |
| `X-With-Links-Summary` | Append a links section |
| `X-Respond-With` | `readerlm-v2` for structured output, `jina-ocr-v1` for scans |
| `X-Robots-Txt` | Check robots.txt with a named bot |

Rate limits ([same page](https://jina.ai/reader/)):

| Tier | Reader RPM | Latency |
|---|---|---|
| No key | 20 | 7.9 s average |
| Free key | 500 | 7.9 s |
| Paid key | 500 | 7.9 s |
| Premium key | 5,000 | 7.9 s |

Search (`s.jina.ai`) is 100 RPM on free and paid, 1,000 on premium, and each request costs a fixed number of tokens starting at 10,000. New keys get 10M free tokens. Cache is 5 minutes per URL. Latency is the honest number here: 7.9 seconds average per read is slow enough that a 10-page research task spends over a minute waiting.

The MCP server is remote at `https://mcp.jina.ai/v1`, Streamable HTTP, 12 tools: `read_url`, `search_web`, `search_arxiv`, `search_ssrn`, `search_images`, `capture_screenshot_url`, `guess_datetime_url`, `primer`, `sort_by_relevance`, `deduplicate_strings`, `extract_pdf`, `search_jina_blog` ([MCP README](https://github.com/jina-ai/MCP)).

Two design details are worth copying:

- `read_url` accepts an array of up to 5 URLs per call and fetches them concurrently, which cuts the N+1 round trips.
- `read_url` accepts a `question` plus `topk` and `chunk_size`, and returns only the highest-scoring passages. The same page went from 83,786 bytes to 874 bytes on a Python docs page, and 69,530 to 1,195 on a Paul Graham essay.

The README also documents the guardrail that exists because of Gap 1: Claude Code, Claude Desktop, and Cursor enforce a fixed 25k token limit on MCP tool responses, so Jina truncates to fit and marks what it dropped. A rejected response loses everything, a truncated one loses part.

Their measured failure modes are the most useful part of the document. Positional questions fail because ranking matches text, not document order. A changelog query returned `6.0.0` and never `8.3.0`. Tables and fenced code are removed before ranking, so a number inside a table is unreachable. Inline code loses tokens: `curl -fsSL https://bun.sh/install | bash` came back as `curl -fsSL | bash`. Blocked pages return their login wall as content with no error: `x.com/jina_ai` returned 315 bytes of `Log inSign up ...`.

### 5.4 Tavily

Transport: remote HTTP at `https://mcp.tavily.com/mcp/` with OAuth, API key in the query string, or `mcp-remote` bridge for stdio-only clients. Local stdio via `npx -y tavily-mcp@latest` ([docs](https://docs.tavily.com/documentation/mcp)).

Five tools: `tavily_search`, `tavily_extract`, `tavily_crawl`, `tavily_map`, `tavily_research`. Keyless access covers Search and Extract only.

Defaults can be set once with a `DEFAULT_PARAMETERS` header or env var, for example `{"search_depth": "advanced", "max_results": 10}`. Remote sessions carry `X-Session-Id` automatically and forward `X-Human-Id` when the client supplies it.

Pricing ([pricing page](https://www.tavily.com/pricing)): Free "Researcher" plan 1,000 credits/month, no card. Pay as you go $0.008 per credit. Project $30/month for 4,000 credits. Credits reset on the first of the month regardless of billing date, and requests stop when credits run out.

### 5.5 Exa

Transport: hosted HTTP at `https://mcp.exa.ai/mcp`, with keyless, OAuth (`?login`), or `x-api-key` ([docs](https://docs.exa.ai/reference/exa-mcp)). Local package `exa-mcp-server` for clients without remote support.

Tools: `web_search_exa` and `web_fetch_exa` by default, `web_search_advanced_exa` when opted in, `agent_run` with auth. The `tools` query parameter replaces the default list, so an explicit list must include every tool you want.

`agent_run` is asynchronous and resumable. If a run outlasts one MCP call it returns `status: "running"` with an `id`, and the client polls with `runId`. It returns findings, sources, validated JSON when given `outputSchema`, plus usage and cost.

Pricing ([pricing](https://exa.ai/pricing)): $4 per 1,000 searches on `lite`, $7 on `auto` and `fast`, $12 to $15 on deep search, $1 per 1,000 pages for contents, $5 per 1,000 answers. Agent runs are $0.012 to $1.00 fixed-effort, or metered with a $5 default cap on `auto` and $20 on `ultra`.

Limits ([rate limits](https://exa.ai/docs/reference/rate-limits)): 10 QPS on search, answer, and chat, 5 QPS on deep search, 100 QPS on contents, 5 QPS and 50 active runs on agent endpoints. Free tier is $10 in credits monthly plus a one-time $10 bonus, and it does not accumulate.

Keyless MCP has a free rate limit and requires a direct IPv4 connection. Over IPv6 or a proxy it returns 403.

### 5.6 Brave Search MCP

Transport: stdio by default since 2.x, HTTP with `--transport http` on `127.0.0.1:8080` ([README](https://github.com/brave/brave-search-mcp-server)).

Eight tools:

| Tool | Notable parameters |
|---|---|
| `brave_web_search` | `count` 1-20 default 10, `offset` max 9, `freshness`, `goggles`, `extra_snippets` (Pro), `summary` |
| `brave_llm_context` | `maximum_number_of_urls` 1-50, `maximum_number_of_tokens` 1,024-32,768, `maximum_number_of_tokens_per_url` 512-8,192, `context_threshold_mode` |
| `brave_local_search` | Pro for full local data |
| `brave_place_search` | lat/long or location string, radius, count 1-50 |
| `brave_news_search` | `freshness` default `pd`, count 1-50 |
| `brave_video_search` | count 1-50 default 20 |
| `brave_image_search` | count 1-200 default 50. 2.x removed base64 payloads |
| `brave_summarizer` | Takes a `key` from a search with `summary: true` |

`brave_llm_context` is the interesting one for agents. It returns ranked, extracted passages rather than blue links, with a token budget the caller sets. Brave claims its own benchmark shows up to 4x lower token use versus separate search plus scrape ([Brave Search API page](https://brave.com/search/api/)).

Pricing: $5 per 1,000 requests for Search, 50 queries per second, with $5 in free credits monthly. Answers is $4 per 1,000 requests plus $5 per million input and output tokens, at 2 QPS.

Brave publishes third-party benchmark numbers that favour itself, so treat them as vendor claims: 14.89 agent quality score against Firecrawl 14.58, Exa 14.39, Tavily 13.67, and 669 ms average latency against Tavily 998, Exa 1,200, Firecrawl 1,335, all from AIMultiple ([Brave page](https://brave.com/search/api/)).

### 5.7 Playwright MCP

Transport: stdio by default, HTTP with `--port 8931` and the client pointing at `http://localhost:8931/mcp`. Docker image `mcr.microsoft.com/playwright/mcp`, headless Chromium only ([README](https://github.com/microsoft/playwright-mcp)).

The design choice is accessibility snapshots, not pixels. The agent gets a structured tree and acts on element references, so no vision model is needed and actions are deterministic.

Core tools: `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_find`, `browser_evaluate`, `browser_fill_form`, `browser_select_option`, `browser_press_key`, `browser_hover`, `browser_drag`, `browser_drop`, `browser_file_upload`, `browser_handle_dialog`, `browser_wait_for`, `browser_tabs`, `browser_resize`, `browser_navigate_back`, `browser_console_messages`, `browser_network_requests`, `browser_network_request`, `browser_emulate_media`, `browser_close`, plus `browser_run_code_unsafe` which is RCE-equivalent by their own description.

Timeouts: action 5,000 ms, navigation 60,000 ms, settle 500 ms after each action. Idle close is 1 hour for headless and never for headed unless set. `--snapshot-mode none` and `--image-responses omit` are the token-saving switches.

Notable additions in 2026: `browser_find` searches the snapshot for text or regex and returns matching nodes with context, which is cheaper than dumping the whole tree. `--mobile` emulates a phone because "mobile pages are usually lighter, which saves tokens".

The README itself says coding agents are drifting away from MCP here: "Modern coding agents increasingly favor CLI-based workflows exposed as SKILLs over MCP because CLI invocations are more token-efficient: they avoid loading large tool schemas and verbose accessibility trees into the model context." They now ship a separate Playwright CLI for that case.

Playwright MCP is explicitly not a security boundary.

### 5.8 Browserbase and Stagehand

Transport: hosted Streamable HTTP at `https://mcp.browserbase.com/mcp`, or self-hosted stdio via `npx @browserbasehq/mcp`.

The self-hosted repo is archived. The README's first line is "This repository is archived and no longer maintained", and it points at the hosted server as the recommendation ([repo](https://github.com/browserbase/mcp-server-browserbase)).

Six tools, unchanged between hosted and self-hosted:

| Tool | Input | Purpose |
|---|---|---|
| `start` | none | Create or reuse a session |
| `end` | none | Close the session |
| `navigate` | `{url}` | Go to a URL |
| `act` | `{action}` | Perform an action in natural language |
| `observe` | `{instruction}` | List actionable elements |
| `extract` | `{instruction?}` | Pull data from the page |

The tool names are coarse on purpose. Stagehand does the DOM work behind `act`, `observe`, and `extract`, so the token cost moves to Browserbase's side. Self-hosted defaults to `google/gemini-2.5-flash-lite` for Stagehand, and any other model needs `--modelName` plus `--modelApiKey`.

Flags: `--proxies`, `--verified` (Scale plan), `--keepAlive`, `--contextId`, `--persist`, viewport default 1024x768.

Pricing is not on the MCP page. Browserbase bills by browser hour on its own plans.

### 5.9 Puppeteer MCP

`@modelcontextprotocol/server-puppeteer` is deprecated. The npm registry marks the latest version, 2025.5.12, as "Package no longer supported."

It exposed `puppeteer_navigate`, `puppeteer_screenshot`, `puppeteer_click`, `puppeteer_hover`, `puppeteer_select`, `puppeteer_fill`, `puppeteer_evaluate`. `puppeteer_navigate` takes `launchOptions` and an `allowDangerous` flag that blocks `--no-sandbox` and `--disable-web-security`.

Anyone reaching for Puppeteer MCP today should use Playwright MCP or a maintained fork such as `puppeteer-mcp-server` (latest 0.7.2, not affiliated with Anthropic).

---

## 6. Comparison table

Legend: "Chars" is characters per call unless marked tokens. "JS" means it executes JavaScript. "Cache" is the default, before configuration.

| Tool | Transport | Read | Search | JS | Default ceiling | Cache | Auth / POST | Price anchor |
|---|---|---|---|---|---|---|---|---|
| Claude Code WebFetch | built-in, client | yes | no | no | 100,000 chars | 15 min | no / no | included in plan |
| Claude Code WebSearch | built-in, client | no | yes | n/a | titles + URLs, 8 backend searches/call, 200 calls/session | n/a | no / no | included in plan |
| Anthropic API `web_fetch` | server tool | yes | no | no | `max_content_tokens` unset | automatic, `use_cache` to bypass | no / no | token cost only |
| Anthropic API `web_search` | server tool | no | yes | n/a | no default `max_uses` | n/a | no / no | $10 / 1k searches |
| Codex `web_search` | hosted | no | yes | n/a | `context_size` low/medium/high | `cached` by default | no / no | included in plan |
| Codex page read | shell `curl` | yes | no | no | sandbox network policy | none | yes, via curl | n/a |
| Cursor Browser | built-in, MCP | yes | no | yes | screenshot + snapshot | session per workspace | yes, persisted cookies | included in plan |
| Cursor WebSearch | built-in | no | yes | n/a | undocumented | undocumented | n/a | included in plan |
| `mcp-server-fetch` | stdio | yes | no | no | 5,000 chars | none | no / no | free |
| Firecrawl MCP | HTTP, stdio | yes | yes | via Interact | plan dependent | yes | key or OAuth / yes | $19 to $749/mo |
| Jina Reader | HTTP prefix | yes | yes (`s.jina.ai`) | yes, headless default | `X-Token-Budget` unset | 5 min | cookies yes, POST yes | 20 RPM free |
| Jina MCP | remote HTTP | yes | yes | yes | 25k token client cap | 5 min | key optional | free tier, 10M tokens |
| Tavily MCP | HTTP, stdio | yes | yes | via crawl | undocumented | undocumented | key or OAuth | $0.008/credit |
| Exa MCP | remote HTTP | yes | yes | no | undocumented | undocumented | key or OAuth | $4 / 1k searches |
| Brave MCP | stdio, HTTP | via LLM Context | yes | no | 1,024 to 32,768 tokens (LLM Context) | `cache-control` header | key | $5 / 1k requests |
| Playwright MCP | stdio, HTTP | yes | no | yes | full snapshot unless `--snapshot-mode none` | profile on disk | yes, persistent profile | free |
| Browserbase MCP | HTTP, stdio (archived) | yes | no | yes | Stagehand-managed | session context | yes, hosted | browser hours |
| Puppeteer MCP | stdio | yes | no | yes | full page | none | launch options | free, deprecated |

---

## 7. Pain points, with the evidence

### Token bloat

- Anthropic's own estimate is 2,500 tokens per 10 kB of page. A 100 kB docs page is 25,000 tokens ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)).
- A reverse-engineered Claude Code WebFetch call used 29,439 input tokens for one page ([writeup](https://medium.com/@liranyoffe/reverse-engineering-claude-code-web-tools-1409249316c3)).
- One MCP call returned 278,649 tokens in a reported case ([writeup](https://levelup.gitconnected.com/a-single-mcp-call-returned-278-649-tokens-heres-the-proxy-i-built-to-stop-it-dfaa9b5282e0)).
- Jina documents the client-side wall: Claude Code, Claude Desktop, and Cursor reject MCP responses over 25k tokens ([Jina MCP README](https://github.com/jina-ai/MCP)).
- Tool schemas are their own tax. Jina's 12 tools cost context before the first call, which is why they added `include_tools` and `exclude_tools`. A GitHub MCP server alone can load about 50,000 tokens before the user types ([community report](https://www.reddit.com/r/mcp/comments/1t73igk/how_to_connect_100_mcp_servers_without_the/)).

### JS-rendered pages returning empty

- Claude Code issue #8331: 30+ URLs, 100% failure, traced to JavaScript-rendered GitHub Discussions. Another user reports two wasted hours and a missing config block ([issue](https://github.com/anthropics/claude-code/issues/8331)).
- Anthropic states the limitation plainly for the API tool and points to a separate browser use tool ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)).
- `mcp-server-fetch` mitigates one narrow case: it unhides a hidden container holding more text than Readability extracted, then re-runs extraction. That handles server-rendered pages with a hidden loading shell, not client-side rendering.

### Bot walls

- Cursor staff on a `lore.kernel.org` link: bot protection "prevents tools like Cursor from accessing the URL" ([forum](https://forum.cursor.com/t/cursor-2-x-removes-useful-web-and-link-features/148088)).
- Jina returns the login wall as content, not an error. `x.com/jina_ai` came back as 315 bytes of `Log inSign up ...` with `snippet_source: content` ([README](https://github.com/jina-ai/MCP)).
- Jina's policy is to respect blocks, not bypass them, and paying does not unlock more sites: "Upgrading from a free tier to a paid API key does not grant access to additional websites" ([reader FAQ](https://jina.ai/reader/)).

### Rate limits

- Jina Reader: 20 RPM with no key, 500 with a free key, 5,000 premium ([reader](https://jina.ai/reader/)).
- Firecrawl Free: 10/minute on scrape, map, and search, 2 concurrent browsers ([rate limits](https://docs.firecrawl.dev/rate-limits)).
- Exa: 10 QPS search, 5 QPS deep search, 100 QPS contents ([rate limits](https://exa.ai/docs/reference/rate-limits)).
- Brave: 50 QPS on Search, 2 QPS on Answers ([API page](https://brave.com/search/api/)).
- Claude Code: 200 WebSearch calls per interactive session, shared with subagents ([tools reference](https://code.claude.com/docs/en/tools)).
- Tavily: requests stop when the monthly credit pool empties ([pricing](https://www.tavily.com/pricing)).

### No caching, or invisible caching

- `mcp-server-fetch` has no cache. Every call is a fresh fetch.
- Claude Code caches 15 minutes per URL and the returned content "might not always reflect the latest version". A developer wrote up a case where Claude insisted a page said 101 rows when the live page said 201, because the cached copy was stale ([writeup](https://dev.classmethod.jp/en/articles/claude-web-fetch-cache/)).
- Jina caches 5 minutes and exposes `X-No-Cache` and `X-Cache-Tolerance`, which is the most control any of these gives the model.
- Codex hides the question entirely in `cached` mode, its default.
- Browserbase and Firecrawl cache on the server side with no per-request knob in the MCP tool schema.

The stale-cache failure is worse than a slow fetch because it is silent. The model reads a confident, consistent, out-of-date page and reports it as current.

### N+1 fetch loops

- Claude Code WebSearch returns titles and URLs only, so every result the agent wants to read is a second call ([tools reference](https://code.claude.com/docs/en/tools)).
- Agent loop cost scales as O(N²) because each turn resends prior context ([analysis](https://blog.prompt20.com/posts/agent-serving-infrastructure/)).
- Jina's fix is batching. `read_url` takes up to 5 URLs per call and a `question` that returns passages instead of the body, cutting a page from 83,786 bytes to 874 in their measurement ([README](https://github.com/jina-ai/MCP)).
- Jina also documents the loop failure mode for small local models: a 4,096 token window fills, the model loses the start of the task, and it loops on tool calls ([README](https://github.com/jina-ai/MCP)).

---

## 8. What this implies for a web-access layer

Four properties are missing across the board, in rough order of value.

1. **Read once, answer many.** A page should be fetched, cached with a visible timestamp, and queryable without refetching. Today each question about a page is a new fetch and a new 25k token bill.
2. **A token budget the caller sets, not the client.** Codex is the only one that lets the operator cap a tool response in tokens. Everyone else caps characters, or caps at the MCP transport, and the numbers disagree by 20x.
3. **Say what was lost.** Only Claude Code v2.1.290+ tells the model how much of a page it did not read. Silent truncation is the default everywhere else, and it produces confident wrong answers.
4. **Batch and filter before context.** Jina's array plus `question` plus `topk` is the only shipping design that attacks the N+1 problem directly. Anthropic's dynamic filtering does the same thing server-side, behind a tool version bump.

The unresolved conflict is JS rendering. Every option that renders costs either a browser session, a Stagehand call, or 40x tokens per page, and the cheap text path returns empty on exactly the pages that matter for modern docs, issue trackers, and dashboards.

---

## 9. Sources

All accessed 4 Nov 2026.

**Anthropic and Claude Code**

- Web fetch tool. https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
- Web search tool. https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Tool use with prompt caching. https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching
- Prompt caching. https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Claude Code tools reference. https://code.claude.com/docs/en/tools
- Claude Code settings. https://code.claude.com/docs/en/settings
- Claude Code issue #8331, WebFetch unable to access external docs. https://github.com/anthropics/claude-code/issues/8331
- Reverse engineering Claude Code web tools. https://medium.com/@liranyoffe/reverse-engineering-claude-code-web-tools-1409249316c3
- Reverse engineering repo. https://github.com/LiranYoffe/reverse-engineering-claude-code-web-tools
- Claude Code execution and prompts analysis. https://weaxsey.org/en/articles/2025-10-12/
- Web fetch cache staleness writeup. https://dev.classmethod.jp/en/articles/claude-web-fetch-cache/
- Firecrawl comparison post. https://www.firecrawl.dev/blog/claude-web-fetch-vs-firecrawl

**OpenAI Codex**

- Codex configuration reference. https://learn.chatgpt.com/docs/config-file/config-reference
- Codex CLI overview. https://learn.chatgpt.com/docs/codex/cli
- Codex web search modes (third party). https://you.com/resources/codex-web-search
- Codex web search vs Firecrawl. https://www.firecrawl.dev/blog/codex-web-search-using-firecrawl
- Codex issue #6031, web search docs discrepancy. https://github.com/openai/codex/issues/6031

**Cursor**

- Browser tool. https://cursor.com/docs/agent/tools/browser
- Search (code search, for contrast). https://cursor.com/docs/agent/tools/search
- Forum thread, 2.x removes @Web and @Link. https://forum.cursor.com/t/cursor-2-x-removes-useful-web-and-link-features/148088
- Bug report, agent web search uses the user prompt. https://forum.cursor.com/t/agent-cant-web-search-properly/132658

**MCP servers**

- Fetch server README. https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
- npm, `@modelcontextprotocol/server-fetch` returns 404. https://registry.npmjs.org/@modelcontextprotocol%2Fserver-fetch
- npm, `@modelcontextprotocol/server-puppeteer` deprecated. https://registry.npmjs.org/@modelcontextprotocol%2Fserver-puppeteer
- Firecrawl MCP get started. https://docs.firecrawl.dev/mcp-server
- Firecrawl MCP tools. https://docs.firecrawl.dev/mcp-server/tools
- Firecrawl MCP keyless. https://docs.firecrawl.dev/mcp-server/keyless
- Firecrawl pricing. https://firecrawl.dev/pricing
- Firecrawl rate limits. https://docs.firecrawl.dev/rate-limits
- Jina Reader. https://jina.ai/reader/
- Jina MCP server README. https://github.com/jina-ai/MCP
- Tavily MCP. https://docs.tavily.com/documentation/mcp
- Tavily pricing. https://www.tavily.com/pricing
- Exa MCP. https://docs.exa.ai/reference/exa-mcp
- Exa pricing. https://exa.ai/pricing
- Exa billing and rate limits. https://exa.ai/docs/reference/rate-limits
- Brave Search MCP README. https://github.com/brave/brave-search-mcp-server
- Brave Search API and pricing. https://brave.com/search/api/
- Playwright MCP README. https://github.com/microsoft/playwright-mcp
- Browserbase MCP README (archived). https://github.com/browserbase/mcp-server-browserbase
- Browserbase MCP docs. https://docs.browserbase.com/integrations/mcp/introduction

**Pain point and cost sources**

- Jan issue #9170, built-in fetch ignores context window. https://github.com/janhq/jan/issues/9170
- MCP response size limit discussion. https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2211
- One MCP call, 278,649 tokens. https://levelup.gitconnected.com/a-single-mcp-call-returned-278-649-tokens-heres-the-proxy-i-built-to-stop-it-dfaa9b5282e0
- Agent serving cost analysis, O(N²) context growth. https://blog.prompt20.com/posts/agent-serving-infrastructure/
- Agent loop token cost guide. https://www.augmentcode.com/guides/ai-agent-loop-token-cost-context-constraints
- Reddit, MCP context tax. https://www.reddit.com/r/mcp/comments/1t73igk/how_to_connect_100_mcp_servers_without_the/
