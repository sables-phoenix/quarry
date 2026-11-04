# security

## reporting

open a private security advisory on the repository, or email the maintainer listed in the commit history. do not file a public issue for a live vulnerability.

## threat model

quarry runs locally and fetches urls an agent chooses. the agent may be steered by untrusted page content, so the fetch path treats every url as hostile.

- schemes are limited to http and https.
- private, loopback, link-local, unique-local, and unspecified addresses are refused before the request, and literal private hosts are refused again on redirect.
- `QUARRY_ALLOW_PRIVATE=1` disables the address guard. use it only for local development.
- responses are capped at 5 MB and requests time out at 25 seconds.
- no javascript runs. no cookies are stored. no credentials are read.
- the cache writes decoded bodies and metadata under the user cache directory, keyed by a sha-256 of the url.

## residual risk

- dns rebinding can defeat a resolve-then-connect check. a hostname can resolve to a public address during the guard and a private one at connect time. the redirect check narrows this, it does not remove it.
- a page can contain prompt injection. quarry returns page text, not instructions, and the calling agent must treat it as data.
- the mcp server trusts its local caller. do not expose it over a network socket.

## known advisories

`cargo tree -i fxhash` shows `fxhash 0.2.1` through `scraper -> selectors`. RUSTSEC-2025-0057 marks it unmaintained, not vulnerable. it is a hash map implementation used while parsing selectors, with no reported memory safety issue. replacing it means replacing the selector engine. accepted for now and rechecked with `python3 scripts/osv_audit.py`.
