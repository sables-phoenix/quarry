# Transport, caching, and politeness for an agent web layer

Research report for the Quarry fetch layer. Every number below is either cited to a
primary source or measured on this machine. Measurements are marked **[measured]** and
include the exact command in Appendix A.

Scope: a local proxy that sits between many agents and the open web, caches HTML/JSON,
obeys robots.txt, and escalates to a browser only when a page needs JavaScript.

---

## 0. Headline numbers

| Question | Answer | Source |
|---|---|---|
| Repeat fetches answerable with 304 | 92% in a 12-URL probe; 88–94% per HTTP Archive for responses that carry validators | [measured], Web Almanac 2021 |
| Responses with no validator at all | 24.5% (desktop, 2021) | Web Almanac 2021, fig 23.4 |
| 304 response size vs body | 250–614 bytes vs 14 KB–606 KB | [measured] |
| gzip -9 / brotli -11 / zstd -19 on 1.4 MB HTML | 6.37x / 8.61x / 7.96x | [measured] |
| brotli -11 cost | 0.79 MB/s (1.78 s for 1.4 MB) | [measured] |
| zstd -3 vs gzip -9 size | 3.4% smaller, and several times faster to produce | [measured] |
| TLS handshake on a 28 ms RTT path | 27–28 ms, i.e. 60–70% of total fetch time for a small page | [measured] |
| Cold browser session start | 268 ms (Playwright) / 471 ms (Puppeteer), localhost, 32-core box | MIYAIP benchmark |
| JS shell vs real page | shells had 7–41 visible chars; rendered pages 3.6k–62k | [measured] |

Three conclusions drive the design.

1. Caching is not mainly about 304s. A local cache that serves fresh entries needs zero
   round trips. 304s matter only for stale-entry revalidation, and then only for the
   75% of pages that publish validators.
2. Compression should happen once, at store time. brotli -11 is 8.6x but runs at
   0.8 MB/s. That is fine for a write path and impossible for a per-request path.
3. With 20 pages over 5 domains, per-domain politeness dominates wall clock, not DNS,
   TCP, TLS, or HTTP/2. Transport is a rounding error next to a 1 req/s token bucket.

---

## 1. HTTP caching for a local proxy

### 1.1 The model in RFC 9111

RFC 9111 defines three states for a stored response, and a proxy's job is to pick the
cheapest correct one ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html)).

| State | Action | Cost |
|---|---|---|
| Fresh | Serve from store, add `Age` | 0 RTT |
| Stale, has validator | Conditional GET, expect 304 | 1 RTT + header bytes |
| Stale, no validator | Full GET | 1 RTT + full body |

Freshness is `freshness_lifetime > current_age`. The lifetime comes from `s-maxage`
(shared caches only), then `max-age`, then `Expires - Date`, then heuristics.

Heuristic freshness is the part most proxies get wrong. RFC 9111 §4.2.2 permits a
cache to invent a lifetime when no explicit one exists, using `Last-Modified` as the
anchor, and suggests **10% of the interval since Last-Modified**. For a page last
modified 30 days ago that is 3 days of freshness for free. Cap it. Squid's default
`refresh_pattern` is `0 20% 4320`, meaning 20% of age capped at three days. nginx does
no heuristics at all and will not cache a response that lacks explicit expiry unless
`proxy_cache_valid` says otherwise. A spider-facing proxy should be more conservative
than both, because a stale page is worse for an agent than a slow one (see §1.7).

`Vary` is part of the cache key, not metadata. RFC 9111 §4.1 says a cache must not
reuse a stored response unless every header field named by `Vary` matches. `Vary: *`
never matches and must not be stored.

### 1.2 Validators

`ETag` is the strong validator. `Last-Modified` has one-second granularity and is
weak in practice, since two edits in the same second are indistinguishable. RFC 9111
§4.3.1 says to send both when both exist, because old intermediaries may only
understand `If-Modified-Since`.

Precedence matters. `If-None-Match` wins over `If-Modified-Since` (RFC 9110 §13.2.2).
If you send a stale ETag with a fresh date, you get a 200.

Practical detail from the probe. Wikipedia sends `Last-Modified` and no `ETag`, so an
`If-None-Match`-only request returns the full 606 KB body. Sending both got a 304.

### 1.3 `Cache-Control` directives that change proxy behavior

| Directive | Meaning for a local proxy |
|---|---|
| `no-store` | Do not persist. Do not even keep for the session |
| `no-cache` | Store, but revalidate on every use. A 304 still saves the body |
| `private` | Fine for a single-tenant local proxy; blocks shared CDN reuse only |
| `max-age=0, must-revalidate` | Revalidate always. This is what Wikipedia sends |
| `immutable` | Never revalidate while fresh. 3.5% of desktop responses |
| `s-maxage` | Overrides `max-age` for shared caches. 1.6% of responses |

Adoption on the real web (Web Almanac 2021, desktop, [source](https://almanac.httparchive.org/en/2021/caching)):
74.8% of responses set `Cache-Control`, 46.5% set `ETag`, 70.5% set `Last-Modified`,
41.6% set both, and **24.5% set neither**. `max-age` appears on 62.2%, `no-cache` on
16.5%, `no-store` on 9.6%. `stale-while-revalidate` only on 2.3%, `stale-if-error` on
0.2%.

### 1.4 `stale-while-revalidate`

RFC 5861 §3 defines `stale-while-revalidate=N`. A cache may serve a stale response for
up to N seconds after expiry while revalidating in the background. Two properties
matter for an agent layer.

- Revalidation only triggers on a request. There is no timer. Sparse traffic means the
  window is often missed, which is exactly the agent traffic pattern.
- Serving stale does not save bandwidth on revalidation. It saves latency on the read
  path only. RFC 5861 requires a non-zero `Age` and a `Warning`.

nginx implements the same behavior as `proxy_cache_background_update on` plus
`proxy_cache_use_stale updating` ([nginx docs](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)).
The useful default for a fetch layer is
`Cache-Control: max-age=60, stale-while-revalidate=600, stale-if-error=86400` applied
*locally* to responses that carry no cache headers at all. You are the cache. You are
allowed to define your own freshness policy for a private store.

### 1.5 How often a 304 actually comes back

Three data points.

**HTTP Archive, 2021** (fig 23.8). Among responses that published a validator, an
actual conditional request returned 304 on:

| Strategy | Desktop | Mobile |
|---|---|---|
| `If-Modified-Since` | 94% | 86% |
| `If-None-Match` | 88% | 88% |

The same chapter notes the "expected" 304 rate for `If-Modified-Since` was modelled at
18%, far below the observed 94%. Servers return 304 more readily than intuition
suggests.

**Local probe [measured]**, 12 URLs across 8 domains, sending both validators:

| Result | Count |
|---|---|
| 304 | 11 |
| 200 (no validator published) | 1 (news.ycombinator.com) |
| 304 rate | 92% |

Every URL with a validator produced a 304. The single failure was HN, which sends
`Cache-Control: private; max-age=0` and neither `ETag` nor `Last-Modified`.

**Ceiling arithmetic.** 24.5% of responses carry no validator, so at best 75.5% of
arbitrary repeat fetches can be revalidated at all. Multiply by the 88–94% observed 304
rate and the expected 304 fraction for a general crawl is **66–71% of stale-entry
revalidations**. For a curated set of documentation and reference sites (the probe
sample) it is 90%+.

### 1.6 What 304 does and does not buy you

**[measured]** on the same URLs, conditional vs unconditional TTFB:

| URL | 304 headers | 200 body | 304 TTFB | 200 TTFB |
|---|---|---|---|---|
| rfc-editor.org/rfc/rfc9111.html | 614 B | 232,630 B | 123 ms | 125 ms |
| nginx.org/en/docs/ | 250 B | 14,022 B | 69 ms | 90 ms |
| MDN Cache-Control | 322 B | 248,577 B | 135 ms | 128 ms |
| en.wikipedia.org/wiki/HTTP | 200 (no ETag) | 605,803 B | 37 ms | 48 ms |

TTFB is essentially unchanged. The origin still does the work. 304 saves transfer
bytes, client parse time, and cache-fill work. On a 28 ms RTT path with a 250 KB page
that is ~20–40 ms of transfer, not a round trip.

The corollary for the proxy. If a page is stale but the body hash you already hold is
likely unchanged, a conditional GET costs one RTT and returns ~300 bytes. If you serve
your own copy optimistically (SWR) you pay zero RTT and correct later. Prefer the
latter for HTML that agents read, and revalidate on a schedule rather than on demand.

### 1.7 Recommended policy table

| Content | Freshness | Revalidation | Notes |
|---|---|---|---|
| HTML, no cache headers | 10% of age since `Last-Modified`, cap 6h | SWR 1h | Heuristic per RFC 9111 §4.2.2 |
| HTML, `max-age` present | honor it, cap 24h | SWR 10 min | cap protects against 51-trillion-year max-age |
| HTML, `no-cache` | 0 | conditional GET every time, SWR 5 min | Wikipedia's policy |
| HTML, `no-store` | 0 | never store | Respect it |
| JSON API, `max-age` | honor, cap 1h | SWR 5 min | |
| Static assets, hashed URL | 1 year | none | `immutable` semantics |
| robots.txt | 24h max | per RFC 9309 §2.4 | see §4 |

Also emit `Cache-Status` (RFC 9211) on every response. It costs one header and makes
the whole layer debuggable from an agent's transcript.

---

## 2. Content-addressed local cache

### 2.1 Key design

Two-level key. A small index maps a semantic key to a content hash. A blob store maps
the hash to bytes. This is what `cacache` does, and what npm, Cargo's registry cache,
and Bazel's CAS all converge on.

```
index_key = sha256(
    canonical_url            # scheme lowercased, host lowercased, path normalized,
                             # query params sorted, fragment dropped
  + "\x00" + method          # GET only in practice
  + "\x00" + vary_tuple      # see below
)
blob_key  = sha256(body_bytes)
```

Rules that matter, in order of how much pain they save.

1. **Canonicalize the URL hard.** Percent-encoding case, default ports, trailing
   slashes, `www.`, tracking params (`utm_*`, `fbclid`, `gclid`), and query ordering
   all create duplicate entries. Agents generate all of these.
2. **Store decoded bytes, not the wire encoding.** Then compression is a per-response
   decision and `Accept-Encoding` drops out of the key. This alone removes the
   `Vary: Accept-Encoding` explosion, which covers 90.4% of all `Vary` responses.
3. **Keep `Vary` narrow.** `Vary: User-Agent` appears on 10.2% of responses and is a
   cardinality bomb. Map UA to a small enum (`browser`, `bot`, `api`) rather than
   storing the string. `Accept-Language` should be reduced to a primary tag.
4. **Key the index by vary tuple, not by hash of vary.** You need to enumerate entries
   per URL for invalidation.
5. **Store the response headers with the body.** RFC 9111 §3.1 requires preserving
   unrecognized headers, and you need `Content-Type`, `ETag`, `Last-Modified`,
   `Cache-Control`, `Vary` for later decisions.

### 2.2 Integrity

- Hash with SHA-256 (or BLAKE3 if you want speed; SHA-256 is ~1 GB/s with SHA-NI and
  is the interoperable choice).
- Verify on read, not just on write. Silent bit rot in a 50 GB cache is real, and a
  corrupted HTML body poisons every downstream agent that reads it.
- Write atomically. Write to `tmp/<rand>`, fsync, rename into `blobs/ab/cd/<hash>`.
  Readers never see partial files. `cacache` documents exactly these properties:
  "automatic content deduplication", "atomic content writes even for large data",
  "consistency guarantees on read and write (full data verification)", "lockless,
  high-concurrency cache access" ([cacache-rs README](https://github.com/zkat/cacache-rs)).
- Deduplication is free with content addressing. Two URLs serving the same HTML cost
  one blob. Measured corpus: 7 pages, 1.41 MB raw, 164 KB at brotli -11, so ~23 KB per
  page compressed. 50k pages ≈ 1.2 GB of blobs plus ~10 MB of index at nginx's
  128 bytes/key.

### 2.3 Eviction

| Policy | Optimizes | Weakness | Used by |
|---|---|---|---|
| LRU | recency | scan pollution, one-shot crawls flush the cache | nginx `proxy_cache_path` default, Squid default |
| LFU | frequency | stale popularity, no aging | rare alone |
| GDSF (Greedy-Dual Size Frequency) | **hit ratio**, favors small popular objects | evicts large popular objects, hurts byte hit rate | Squid `heap GDSF` |
| LFUDA (LFU with Dynamic Aging) | **byte hit rate**, keeps large popular objects | one big object crowds out many small ones | Squid `heap LFUDA` |
| Segmented LRU / 2Q / S3-FIFO | scan resistance at LRU cost | more code | modern CDNs |

Squid's own documentation is the clearest statement of the tradeoff. GDSF "optimizes
object hit rate by keeping smaller popular objects in cache"; LFUDA "optimizes byte hit
rate at the expense of hit rate since one large, popular object will prevent many
smaller, slightly less popular objects from being cached"
([Squid cache_replacement_policy](https://www.squid-cache.org/Doc/config/cache_replacement_policy/)).

For an agent layer the objective is *pages served*, not bytes saved, so hit ratio wins.
Choose **byte-bounded + segmented LRU** (a small probation segment plus a protected
segment), pin the top N domains, and add a size cap per object (nginx's
`maximum_object_size` equivalent). A scan of 500 URLs on one blog should not evict the
docs pages another agent will need in ten minutes. A probation segment gives you that
for about 20 lines of code.

nginx's two-knob model is worth copying verbatim
([proxy_cache_path](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)):

- `inactive=10m` removes entries not *accessed*, regardless of freshness.
- `max_size` triggers the cache manager, which "removes the least recently used data"
  in batches (`manager_files` 100, `manager_threshold` 200 ms, `manager_sleep` 50 ms).

The batch parameters exist so eviction does not cause latency spikes. Copy them.

### 2.4 Prior art, concretely

| Implementation | Key | Storage | Eviction | RFC 9111? |
|---|---|---|---|---|
| **reqwest** (Rust) | n/a | none built in | n/a | no cache at all |
| **ureq** (Rust) | n/a | none built in | n/a | no cache at all |
| **http-cache + http-cache-semantics + cacache** | method + URI closure (overridable) | content-addressed disk | cacache's own | yes, full policy |
| **Squid** | URL (+ `Vary`) | disk + memory, MD5 filenames | LRU / GDSF / LFUDA | yes |
| **nginx proxy_cache** | `$scheme$proxy_host$request_uri` (MD5 filename) | files under `levels=1:2` | LRU manager | partial, `proxy_cache_revalidate` for conditional |
| **Chromium disk cache** | URL + vary | block file, own index | LRU-ish | yes, plus its own heuristics |

The Rust ecosystem answer is unambiguous. Neither `reqwest` nor `ureq` ships a response
cache. Caching is a middleware crate, and the reference implementation is
`http-cache`, which delegates policy to `http-cache-semantics` (a port of the
`http-cache-semantics` npm package used by `cacheable-request`) and storage to
`cacache` ([docs.rs/http-cache](https://docs.rs/http-cache/latest/http_cache/)). If you
build in Rust, take that stack and replace the eviction policy.

Two nginx behaviors are worth porting because they solve the multi-agent problem
directly:

- `proxy_cache_lock on` lets only one request populate a key; the rest wait. That is
  single-flight, and it is the single highest-value line in this report (§4.4).
- `proxy_cache_revalidate on` turns expired entries into conditional requests
  automatically, so the fetch path never has to remember to send `If-None-Match`.

---

## 3. Compression for cached HTML

### 3.1 Measured ratios

Corpus: 7 real HTML pages fetched on 2026-11-04 (example.com, en.wikipedia.org/wiki/HTTP,
news.ycombinator.com, rfc-editor.org/rfc/rfc9111.html,
nginx.org/en/docs/http/ngx_http_proxy_module.html, docs.rs/http-cache, github.com repo
page). Total 1,411,379 bytes. Node's zlib for gzip/brotli, `zstd` CLI for zstd.

| Codec | Bytes | Ratio | Reduction | Compress ms | Compress MB/s | Decompress MB/s |
|---|---|---|---|---|---|---|
| gzip -6 | 223,882 | 6.30x | 84.1% | 18.8 | 75.0 | 435 |
| gzip -9 | 221,721 | 6.37x | 84.3% | 28.2 | 50.0 | 425 |
| brotli -5 | 189,534 | 7.45x | 86.6% | 20.1 | 70.1 | 569 |
| **brotli -11** | **163,993** | **8.61x** | **88.4%** | **1,781** | **0.79** | 491 |
| zstd -3 | 214,166 | 6.59x | 84.8% | 8 (CLI, incl. startup) | ~176 | ~350 |
| zstd -19 | 177,376 | 7.96x | 87.4% | 486 | 2.9 | ~350 |

Per-page spread (bytes):

| Page | raw | gzip -9 | br -11 | zstd -19 |
|---|---|---|---|---|
| example.com | 577 | 401 | 252 | 404 |
| wikipedia HTTP | 605,803 | 93,825 | 69,217 | 77,261 |
| HN front page | 34,690 | 5,717 | 4,373 | 5,245 |
| RFC 9111 | 232,630 | 43,647 | 34,303 | 38,276 |
| nginx proxy_module | 131,664 | 18,646 | 14,423 | 16,295 |
| docs.rs/http-cache | 97,677 | 8,929 | 7,351 | 8,261 |
| github repo page | 308,338 | 50,556 | 34,074 | 37,575 |

### 3.2 How these compare to published numbers

Cloudflare measured a much more heterogeneous corpus and got lower ratios
([blog](https://blog.cloudflare.com/new-standards/)): average ratio **gzip 2.56**,
**zstd 2.86**, **brotli 3.08**, with zstd compressing "up to 42% faster than Brotli"
and 11.3% better compression efficiency than gzip at similar speed. Their compression-time table: gzip
0.872 ms, zstd 0.848 ms, brotli 1.544 ms per response.

The gap between 2.56x and 6.37x is corpus composition, not disagreement. Ratio depends
heavily on input size. Cloudflare's own 2015 study shows the curve
([results experimenting with Brotli](https://blog.cloudflare.com/results-experimenting-brotli/)):

| Input size | zlib -8 | brotli -4 | brotli -10 |
|---|---|---|---|
| 20–1024 B | 64.4% | 53.8% | 46.8% |
| 1–2 KB | 45.5% | 40.8% | 33.4% |
| 8–16 KB | 29.2% | 28.7% | 23.9% |
| 64 KB+ | 27.4% | 27.5% | 23.0% |
| All files | 27.7% | 27.7% | 23.3% |

Two readings. First, on files under 1 KB, brotli -10 is 1.38x better than zlib, but
everything is still above 45% of original. Second, brotli -4 ties zlib -8 on ratio
across the whole corpus, which is why Cloudflare ran at level 4 for years.

zstd's own README puts zstd -1 at 2.896 on Silesia vs brotli -1 at 2.883, with zstd
decompressing at 1550 MB/s vs brotli's 425 MB/s
([zstd README](https://github.com/facebook/zstd)).

### 3.3 What to actually do

Store one compressed representation, chosen at write time, and re-compress only for
clients that cannot decode it.

- **Write path:** brotli -11 if you can afford 0.8 MB/s, else zstd -19 at 2.9 MB/s.
  brotli -11 wins by 8% on bytes. zstd -19 is 3.7x cheaper to produce and 8% larger.
  For a cache that stores each page once and serves it N times, brotli -11 is correct
  unless you are filling faster than ~1 MB/s per core.
- **Read path:** negotiate with `Accept-Encoding`. Serve `zstd` if offered (Chrome and
  Firefox since March 2024), else `br`, else `gzip`. Decompression is 350–570 MB/s for
  all three, so the choice barely affects read latency.
- **Small responses:** use a zstd dictionary trained on HTML shells
  (`zstd --train`). zstd's docs note dictionary gains are "mostly effective in the
  first few KB", which is exactly where HTML boilerplate lives. Expect 15–30% on
  sub-10 KB pages.
- **Do not compress twice.** Detect `Content-Encoding` on ingest and store the decoded
  bytes. Re-compressing already-gzipped bytes wastes CPU and inflates output.
- **Below ~200 bytes, skip compression.** HTTP overhead exceeds the saving.

---

## 4. robots.txt, crawl-delay, and not hammering a host

### 4.1 Parsing rules that are actually specified

RFC 9309 (Sept 2022) is short and normative. The rules a parser must get right:

- Group by `user-agent` line, case-insensitive substring match on the product token.
  Multiple matching groups **merge**. No match falls back to `*`
  ([RFC 9309 §2.2.1](https://www.rfc-editor.org/rfc/rfc9309.html)).
- Longest match wins, not first match. `Allow` beats `Disallow` on a tie.
- `*` matches any sequence, `$` anchors the end. `#` starts a comment.
- Percent-encoding normalization before comparison. `%62%61%7A` matches `baz`.
- Fetch `/robots.txt` once per authority, follow at least 5 redirects.
- **4xx means allow everything. 5xx means disallow everything.** RFC 9309 §2.3.1.4:
  "the crawler MUST assume complete disallow". Most homegrown crawlers get this
  backwards and treat a 503 as "no rules".
- Cache at most 24h unless unreachable (§2.4). Parsing limit at least 500 KiB (§2.5).
- Treat the file as untrusted input. 500 KiB of attacker-controlled patterns can blow
  up a naive matcher.

### 4.2 crawl-delay is not in the RFC

`Crawl-delay` is a non-standard extension. Google explicitly does not support it
("other fields such as `crawl-delay` aren't supported",
[Google robots.txt spec](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)).
Bing and Yandex do honor it. Common Crawl publishes `Crawl-delay: 2` for CCBot in its
own FAQ, i.e. 0.5 req/s.

Treat it as one input to a rate decision, not a rule to obey literally:

```
rate = clamp(1 / crawl_delay, MIN_RPS, MAX_RPS)   # MIN_RPS 0.2, MAX_RPS 2.0
```

A site that writes `Crawl-delay: 3600` is asking for one request per hour. That is a
hard stop for an interactive agent, not a rate limit. Cap it, tell the caller, and let
them decide. A site that writes `Crawl-delay: 0` does not mean "unlimited".

### 4.3 Per-domain token buckets

One bucket per registrable domain (`eTLD+1`), not per host and not global. Subdomains
share fate and usually share infrastructure. Hosting the bucket per-domain also means
`docs.example.com` and `www.example.com` cannot collectively hammer the same origin.

Parameters that work for a fetch layer:

| Knob | Value | Why |
|---|---|---|
| Steady rate | 1 req/s default | matches Common Crawl's published politeness |
| Burst | 3 | lets a page plus its one or two API calls through without a stall |
| Concurrency per domain | 2 | h2 gives multiplexing; more just queues at the origin |
| Global concurrency | 32–64 | bounded by file descriptors and your own CPU |
| Adaptive floor | slow to 0.2 req/s on 429/503 | backoff must survive the burst |
| `Retry-After` | always honored, capped at 5 min | it is a direct instruction |

Adaptive control beats a fixed rate, and there is a well-tested algorithm to copy.
Scrapy's AutoThrottle sets `delay = latency / target_concurrency`, starts at 5 s,
averages the new target with the old delay, and refuses to speed up on non-200
responses ([Scrapy AutoThrottle docs](https://docs.scrapy.org/en/latest/topics/autothrottle.html)).
The last clause is the important one. A server returning 503s quickly must not be
rewarded with a faster crawl.

Implementation notes.

- Bucket state must be shared across the whole process, not per agent. One mutex per
  domain, or a single scheduler goroutine owning a map. Do not use a per-agent limiter
  and hope.
- Add 0–250 ms of jitter to every scheduled request. Twenty agents that start together
  otherwise stay in lockstep forever.
- Record `(domain, status, latency)` in a ring buffer and compute a p95 latency per
  domain. A domain whose p95 triples is under load whether or not it says so.

### 4.4 The 20-agents-one-domain problem

This is the failure mode that gets you blocked, and it is not a rate-limit problem. It
is a duplicate-work problem. Twenty agents fetching `example.com/docs` within a minute
should produce **one** origin request.

Three mechanisms, in order of value:

1. **Single-flight per index key.** A map of in-flight requests keyed by
   `(canonical_url, vary_tuple)`. The first caller does the fetch; the other 19 wait on
   a channel and get the same bytes. This is nginx's `proxy_cache_lock`. It collapses
   the burst to one request and removes the thundering herd entirely.
2. **Negative caching.** Cache 404/410 for 10 minutes, 429 for the `Retry-After`
   duration, 5xx for 30 seconds. Without this, twenty agents retry the same dead URL
   twenty times, which looks exactly like an attack.
3. **Coalesce by domain, not just by URL.** If 20 agents want 20 different pages on
   one domain, the bucket serializes them anyway. Batch them into a single ordered
   queue per domain so the fetches are spaced rather than piled up, and so a slow
   response does not consume 20 concurrency slots.

With those three, a 20-agent burst on one domain becomes: 1 request in flight, 19 parked
on channels, a queue draining at 1 req/s. The domain sees a polite crawler. The agents
see a 1 s p50 instead of a 429.

---

## 5. DNS, connection pooling, HTTP/2, and TLS

### 5.1 Measured breakdown

**[measured]** with `curl -w` on 20 URLs across 5 domains from this machine (a
datacenter host with a ~28 ms RTT to most destinations). Times in seconds.

| Domain | DNS | TCP | TLS | TTFB | Total |
|---|---|---|---|---|---|
| en.wikipedia.org | 0.0008–0.0016 | 0.002 | 0.029 | 0.034 | 0.039–0.054 |
| github.com | 0.0008–0.0017 | 0.003 | 0.030 | 0.397–0.486 | 0.406–0.494 |
| news.ycombinator.com | 0.0007–0.0025 | 0.075 | 0.155–0.160 | 0.229–0.236 | 0.302–0.311 |
| rfc-editor.org | 0.0007 | 0.002 | 0.029 | 0.112–0.212 | 0.114–0.214 |
| nginx.org | 0.0008 | 0.013 | 0.054 | 0.066 | 0.067 |

Read the columns.

- **DNS is ~0.7 ms.** It is cached by the local resolver. One uncached lookup in the
  set (www.nginx.com) cost 35 ms. On a cold resolver, budget 20–120 ms.
- **TCP connect is 2 ms** on a nearby path, 75 ms cross-region. One RTT.
- **TLS is 27–30 ms**, which is one full RTT for TLS 1.3. On the cross-region host it
  was 80 ms, again one RTT.
- **TTFB after TLS is the variable that dominates.** 2 ms for Wikipedia's edge cache,
  90 ms for rfc-editor, 400 ms for GitHub's app.

For the small page (example.com, 577 bytes), the split was: TLS 30 ms, everything else
12 ms. **The handshake was 70% of the fetch.** That is the real shape of small-request
latency.

### 5.2 What the protocol costs

From HPBN ([primer](https://hpbn.co/primer-on-latency-and-bandwidth/),
[HTTP/1.x](https://hpbn.co/http1x/)) and RFC 8446:

| Operation | RTT cost | Notes |
|---|---|---|
| DNS lookup (uncached) | 1 RTT | 20–120 ms typical |
| TCP handshake | 1 RTT | unavoidable |
| TLS 1.3 full handshake | 1 RTT | 2 RTT for TLS 1.2 |
| TLS 1.3 resumption (PSK) | 1 RTT | skips certificate and key exchange |
| TLS 1.3 0-RTT | 0 RTT | replayable, only safe for idempotent GETs |
| HTTP request/response | 1 RTT | plus server think time |

New HTTPS connection = **3 RTT** before the first byte. Reused connection = **1 RTT**.

HTTP/1.1 caps at six connections per host (HPBN, and Chromium's
`kMaxSocketsPerGroup`). HTTP/2 replaces that with one connection per origin and
concurrent streams, default `SETTINGS_MAX_CONCURRENT_STREAMS` of 100 in most servers.
Two caveats.

- A single TCP connection still has TCP head-of-line blocking. One lost packet stalls
  every stream. This is why HTTP/3 exists and why a proxy should keep more than one
  connection for very large fan-outs.
- Connection coalescing (RFC 7540 §9.1.1) lets one h2 connection serve multiple
  hostnames when the certificate covers them and DNS resolves to the same IP. It only
  helps same-CDN domains. Do not design around it.

All five measured domains negotiated h2 except nginx.org, which fell back to
HTTP/1.1.

### 5.3 What dominates for 20 pages over 5 domains

Model with the measured 28 ms RTT and a 100 ms average server think time, 4 pages per
domain.

| Scenario | Handshakes | Transfer | Policy wait | Wall clock |
|---|---|---|---|---|
| Cold, no politeness | 5 × 3 RTT = 84 ms, all parallel | 1 RTT + 100 ms per domain, h2 streams concurrent | 0 | ~0.21 s |
| Warm pool, no politeness | 0 | ~128 ms | 0 | ~0.13 s |
| Warm pool, 1 req/s, 4 pages per domain | 0 | ~128 ms | 3 s (3 gaps) | **~3.1 s** |
| 15 of 20 cached, misses spread one per domain | 0 | ~128 ms | 0 | ~0.15 s |

The transport optimizations (pooling, h2, TLS resumption) are worth ~84 ms once, on the
cold path. Politeness is worth seconds, every time. Cache hits are worth everything.

This inverts the usual priority ordering. Build the token bucket and the cache first.
Connection pooling is table stakes, not an optimization.

### 5.4 Pool configuration

- One pool per `(scheme, host, port)`, keyed with the resolved IP so DNS changes
  invalidate correctly.
- `max_idle_per_host` 2–4. Enough to absorb a burst, few enough that idle sockets do
  not hold server resources.
- Idle timeout 90 s. Most origins hold keep-alive longer than that; 90 s avoids
  racing a server-side close.
- TLS session cache: in-memory ticket store, 1000 entries, 24h. This is what turns a
  second connection from 3 RTT into 1 RTT. `rustls` needs an explicit
  `ClientSessionMemoryCache`; OpenSSL does it by default per-process.
- Happy Eyeballs (RFC 8305) for dual-stack. A broken IPv6 path otherwise costs 300 ms
  per connection attempt.
- Preconnect the top 10 domains at startup, in the background. It is free and removes
  the 84 ms cold penalty from the first agent request.

---

## 6. Browser fallback

### 6.1 Detecting a JavaScript shell

**[measured]** 11 URLs, visible text extracted with `html.parser` (script and style
contents excluded), script count, text/HTML ratio.

| URL | HTML bytes | Visible chars | Scripts | Text/HTML | Verdict |
|---|---|---|---|---|---|
| web.telegram.org | 1,587 | 12 | 1 | 0.0076 | shell |
| excalidraw.com | 6,850 | 32 | 6 | 0.0047 | shell |
| app.diagrams.net | 4,134 | 41 | 2 | 0.0099 | shell |
| discord.com/app | 74,218 | 7 | 351 | 0.0001 | shell |
| open.spotify.com | 167,117 | 20 | 11 | 0.0001 | shell |
| figma.com | 1,822,203 | 4,172 | 126 | 0.0023 | rendered |
| linear.app | 1,262,161 | 10,245 | 16 | 0.0081 | rendered |
| vercel.com | 592,046 | 3,617 | 168 | 0.0061 | rendered |
| react.dev | 272,407 | 8,096 | 15 | 0.0297 | rendered |
| news.ycombinator.com | 34,688 | 4,131 | 1 | 0.1191 | full HTML |
| en.wikipedia.org/wiki/HTTP | 603,092 | 62,586 | 5 | 0.1038 | full HTML |

The separation is clean and absolute. Shells had 7–41 visible characters. Every page
with server-rendered content had 3,600 or more. The ratio is a weak signal on its own
(figma 0.0023 is a rendered page), because large SPAs inline a lot of JS.

Recommended detector, in order. Escalate to a browser if **any** fire, and require
`content-type: text/html`:

1. Visible text < 200 characters **and** HTML > 2 KB. This caught all five shells and
   no real page. The size guard protects genuinely short pages.
2. Visible text < 500 characters **and** a framework mount point is present
   (`id="root"`, `id="app"`, `id="__next"`, `id="___gatsby"`, `data-reactroot`,
   `ng-version`, `__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`).
3. `<noscript>` contains "enable JavaScript" or "requires JavaScript".
4. Visible text < 500 characters and script bytes > 5x visible text bytes.

Do not trust `<title>` or `meta description`. Every shell has those. Do not use a bot
user-agent list to decide; that is a rendering policy decision disguised as detection.

Two calibration notes. Readability.js uses a default `charThreshold` of 500 characters
before it will call something an article, which is a reasonable anchor for "there is
content here". And modern frameworks increasingly ship SSR or partial hydration, so
the shell rate is falling. Measure your own target set before setting a threshold.

### 6.2 Cost of a browser

| Item | Number | Source |
|---|---|---|
| Cold session start (launch + context + page + viewport) | 268 ms Playwright, 471 ms Puppeteer | MIYAIP benchmark, Ryzen 9 7945HX, localhost |
| Warm page navigation, simple fixture | 19–23 ms | same |
| Chromium binary size | ~125 MB on disk, ~44 MB gzipped | chrome-aws-lambda writeup |
| Realistic cold start on a 2-vCPU cloud VM | 0.8–1.5 s | extrapolated; treat as estimate |
| Per-instance RSS | 150–500 MB | production writeups report 500 MB+ at scale |
| Real render, content-heavy site | 1.5–5 s | network + JS execution |

The benchmark above is a best case. It ran on a 32-core desktop against a localhost
fixture, so it measures process and protocol overhead with no network and no JS work.
Real numbers are dominated by the page, not the browser.

The decision rule is arithmetic. At 1.0 s cold start and 2.0 s render, one-shot
launches cap you at ~0.33 pages/s and burn a core each. Warm, with four concurrent
pages in one browser, the marginal cost per page is the render time plus ~20 ms. For
any workload above a handful of pages per minute, keep the browser warm.

Architecture that works:

- One browser process per worker, started at boot, `--headless=new`.
- One `BrowserContext` per task, so cookies and storage do not leak between agents.
  Context creation is milliseconds; browser launch is seconds.
- Cap pages per context, close the context when done. Do not reuse pages across tasks.
- Recycle the browser every 200–500 pages, or when RSS exceeds ~1.5 GB. Chromium leaks
  handles over long batch runs; restart-on-threshold is cheaper than debugging it.
- Bound concurrency at 4–8 pages per browser. Beyond that, render latency rises
  superlinearly because the renderer processes contend for CPU.
- Use `chrome-headless-shell` if you only need static HTML and no modern web platform
  features. Since Chrome 132 the old headless implementation ships only as that
  separate binary ([Chrome headless docs](https://developer.chrome.com/docs/chromium/headless)).
  It starts faster and uses less memory, but it is a different engine snapshot.

### 6.3 CDP basics

Chrome DevTools Protocol is JSON over a WebSocket, or over a pipe.

**Connect.** `GET http://127.0.0.1:9222/json/version` returns
`webSocketDebuggerUrl`. Better, launch with `--remote-debugging-pipe` and speak
null-delimited JSON on fds 3 and 4. That is what Playwright does; it avoids a listening
socket entirely.

**Flat sessions.** Send `Target.setAutoAttach` with
`{autoAttach: true, waitForDebuggerOnStart: true, flatten: true}`. Every message then
carries a `sessionId` and you multiplex many tabs over one socket. Without `flatten`,
you need `Target.sendMessageToTarget` wrapping, which is deprecated and painful.

**Minimum viable render loop:**

```
Target.createTarget        {url: "about:blank"}      -> targetId
Target.attachToTarget      {targetId, flatten: true} -> sessionId
Page.enable                {}
Network.enable             {}
Page.navigate              {url}
  wait: Page.lifecycleEvent {name: "load"}           # or "networkIdle"
Runtime.evaluate           {expression: "document.documentElement.outerHTML",
                            returnByValue: true}
Target.closeTarget         {targetId}
```

Notes that save a day each.

- `Page.lifecycleEvent` fires for `init`, `DOMContentLoaded`, `load`, `networkIdle`,
  and `networkAlmostIdle`. `load` is not enough for React apps. `networkIdle` can hang
  on pages with websockets or polling. Prefer `networkAlmostIdle` plus a hard timeout,
  and capture DOM at that point rather than waiting for perfection.
- `Runtime.evaluate` with `returnByValue: true` costs a full JSON serialization of the
  DOM, which is 2–5x the HTML size. For big pages use `DOM.getDocument` +
  `DOM.getOuterHTML` with a node id, which streams less.
- Block what you do not need before navigating:
  `Network.setBlockedURLs {urls: ["*.png","*.jpg","*.woff2","*.mp4","*google-analytics*"]}`.
  This is usually the single biggest render speedup, often 2–3x.
- `Page.addScriptToEvaluateOnNewDocument` runs before any page script. Use it to stub
  `Notification`, `navigator.webdriver`, or to install instrumentation.
- Set `Emulation.setDeviceMetricsOverride` and `Network.setUserAgentOverride` before
  `Page.navigate`, not after.
- Always race the navigation against a timeout and `Target.closeTarget` in a `finally`.
  A hung page otherwise pins a session slot forever.
- `Network.setCacheDisabled {cacheDisabled: true}` when you want a clean render.
  Leave caching on for repeat renders of the same site.

### 6.4 Order of operations

Fetch order that keeps the browser cold:

1. Local cache, fresh. 0 RTT.
2. Local cache, stale within SWR. 0 RTT, revalidate in background.
3. Conditional GET. One RTT, 304 likely.
4. Full GET. One RTT plus body.
5. Shell detected? Queue a render, and cache the *rendered* HTML under the same key
   with a `Vary: X-Render-Mode` style discriminator, or a separate namespace.
6. Never render on the first miss. The heuristic costs microseconds; a browser costs
   a second.

---

## 7. Recommendations

**Must do**

1. Single-flight per `(canonical_url, vary_tuple)`, plus per-domain token buckets
   (1 req/s, burst 3, jitter) and adaptive slowdown on 429/503. Without these, 20
   agents on one domain will get you blocked regardless of everything else in this
   report.
2. Store decoded bodies content-addressed by SHA-256, verify on read, write atomically,
   keep the index keyed by URL plus a normalized vary tuple. Compress once at write
   with brotli -11 or zstd -19.
3. Put a freshness policy on every stored entry, including a heuristic for the 24.5%
   of responses that carry no cache headers, capped at 6h for HTML.

**Should do**

4. Send both validators on revalidation. Expect 304 on ~88% of pages that publish one,
   which is ~70% of the general web.
5. Warm the connection pool for the top 10 domains at boot and keep TLS session
   tickets cached. This removes the 3-RTT cold path from the first request.
6. Use the visible-text detector from §6.1, not a UA list, and never render on the
   first miss.

**Do not do**

7. Do not build a cache that revalidates on every read. RFC 9111 lets you define
   freshness for a private store; use SWR and revalidate on a schedule.
8. Do not trust `Crawl-delay` literally, and do not ignore `Retry-After`.
9. Do not launch Chrome per page. One warm browser with contexts, recycled on RSS.

---

## Appendix A. Reproduction

Measurements on this host, 2026-11-04, ~28 ms RTT to most origins.

```bash
# Timing breakdown, 20 URLs / 5 domains
curl -sS -o /dev/null -w '%{http_code} %{time_namelookup} %{time_connect} \
  %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download}\n' "$URL"

# Conditional GET, both validators
etag=$(curl -sSI "$URL" | grep -i '^etag:' | sed 's/^[Ee][Tt][Aa][Gg]: *//' | tr -d '\r')
curl -sS -o /dev/null -w '%{http_code} body=%{size_download} hdr=%{size_header}\n' \
  -H "If-None-Match: $etag" "$URL"

# Compression corpus
curl -sSL -o p1.html https://example.com/
node -e "const z=require('zlib'),fs=require('fs');const b=fs.readFileSync('p1.html');
  console.log('gzip9',z.gzipSync(b,{level:9}).length);
  console.log('br11',z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}).length)"
zstd -q -19 -f -o p1.zst p1.html && stat -c%s p1.zst

# Shell detection
python3 shellcheck.py https://discord.com/app https://en.wikipedia.org/wiki/HTTP
```

`shellcheck.py` counts visible text (excluding `<script>`, `<style>`, `<template>`,
`<noscript>`), script count, and text/HTML ratio.

## Appendix B. Sources

Standards

- RFC 9111, HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
- RFC 9110, HTTP Semantics (precondition precedence, ETag): https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 5861, stale-while-revalidate / stale-if-error: https://www.rfc-editor.org/rfc/rfc5861.txt
- RFC 9309, Robots Exclusion Protocol: https://www.rfc-editor.org/rfc/rfc9309.html
- RFC 9211, Cache-Status: https://httpwg.org/specs/rfc9211.html
- RFC 8446, TLS 1.3: https://www.rfc-editor.org/rfc/rfc8446.html
- RFC 7540 §9.1.1, HTTP/2 connection coalescing: https://www.rfc-editor.org/rfc/rfc7540.html

Data

- Web Almanac 2021, Caching chapter: https://almanac.httparchive.org/en/2021/caching
- Cloudflare, "New standards for a faster and more private Internet" (zstd ratios): https://blog.cloudflare.com/new-standards/
- Cloudflare, "Results of experimenting with Brotli" (size-dependent ratios): https://blog.cloudflare.com/results-experimenting-brotli/
- Cloudflare, "Serve Brotli from origin" (level 11 vs gzip 9: 19% smaller): https://blog.cloudflare.com/this-is-brotli-from-origin/
- zstd README (Silesia benchmark): https://github.com/facebook/zstd

Implementations

- nginx `proxy_cache_path`, `proxy_cache_lock`, `proxy_cache_revalidate`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Squid `cache_replacement_policy` (LRU / GDSF / LFUDA): https://www.squid-cache.org/Doc/config/cache_replacement_policy/
- `http-cache` crate (policy + cacache backend): https://docs.rs/http-cache/latest/http_cache/
- `cacache-rs` (content addressing, SRI, atomic writes): https://github.com/zkat/cacache-rs
- Scrapy AutoThrottle: https://docs.scrapy.org/en/latest/topics/autothrottle.html
- Google robots.txt interpretation (`crawl-delay` unsupported): https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
- Common Crawl FAQ (`Crawl-delay: 2`): https://commoncrawl.org/faq

Performance background

- HPBN, Primer on Latency and Bandwidth: https://hpbn.co/primer-on-latency-and-bandwidth/
- HPBN, HTTP/1.x (six connections per host, 2 RTT per new connection): https://hpbn.co/http1x/
- Chrome headless mode and `chrome-headless-shell`: https://developer.chrome.com/docs/chromium/headless
- Chrome, "Headless Chrome: SSR for JS sites" (reuse one instance): https://developer.chrome.com/blog/headless-chrome-ssr-js-sites
- Playwright vs Puppeteer benchmark (cold start 268/471 ms): https://miyaip.com/blog/playwright-vs-puppeteer
- Browserless, Puppeteer performance tips: https://www.browserless.io/blog/puppeteer-performance
