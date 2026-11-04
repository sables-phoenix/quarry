#!/usr/bin/env python3
import json
import re
import statistics
import subprocess
import sys
import time
import urllib.request
import zlib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "target" / "release" / "quarry"
OUT = ROOT / "bench"

CORPUS = [
    "https://docs.rs/serde/latest/serde/",
    "https://react.dev/reference/react/useState",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
    "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
    "https://nextjs.org/docs/app/building-your-application/routing",
    "https://nodejs.org/api/fs.html",
    "https://www.postgresql.org/docs/current/sql-select.html",
    "https://kubernetes.io/docs/concepts/overview/",
    "https://go.dev/doc/effective_go",
    "https://docs.python.org/3/library/asyncio.html",
    "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
    "https://www.rust-lang.org/",
    "https://en.wikipedia.org/wiki/HTTPS",
    "https://www.rfc-editor.org/rfc/rfc9110.html",
    "https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api",
    "https://web.dev/articles/rendering-performance",
    "https://docs.docker.com/engine/network/",
    "https://grafana.com/docs/grafana/latest/datasources/prometheus/",
    "https://sqlite.org/lang_select.html",
    "https://www.typescriptlang.org/docs/handbook/2/generics.html",
]

UA = "Mozilla/5.0 (compatible; quarry-bench/0.1)"


class TextOnly(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "template", "svg"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "template", "svg") and self.skip > 0:
            self.skip -= 1

    def handle_data(self, data):
        if self.skip == 0:
            self.parts.append(data)


def tokens(chars):
    return (chars + 3) // 4


def fetch_baseline(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate"})
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read()
        enc = resp.headers.get("Content-Encoding", "")
        if enc == "gzip":
            raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
        elif enc == "deflate":
            raw = zlib.decompress(raw)
        ctype = resp.headers.get("Content-Type", "")
        status = resp.status
    ms = (time.perf_counter() - started) * 1000
    html = raw.decode("utf-8", "replace")
    parser = TextOnly()
    parser.feed(html)
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return {
        "status": status,
        "ctype": ctype,
        "bytes": len(raw),
        "html_chars": len(html),
        "text_chars": len(text),
        "ms": ms,
    }


def fetch_quarry(url, cache_dir):
    started = time.perf_counter()
    proc = subprocess.run(
        [str(BIN), "--cache-dir", str(cache_dir), "fetch", url, "--json", "--max-chars", "1000000"],
        capture_output=True,
        text=True,
        timeout=40,
    )
    ms = (time.perf_counter() - started) * 1000
    if proc.returncode != 0:
        return {"error": proc.stderr.strip()[:200], "ms": ms}
    doc = json.loads(proc.stdout)
    return {
        "status": doc["status"],
        "bytes_body": doc["bytes_body"],
        "chars": doc["chars"],
        "tokens": doc["tokens_est"],
        "ms": ms,
        "internal_ms": doc["fetched_ms"],
        "cache": doc["cache"],
        "needs_browser": doc["needs_browser"],
    }


def main():
    OUT.mkdir(exist_ok=True)
    cache = Path("/tmp/quarry-bench-cache")
    subprocess.run(["rm", "-rf", str(cache)], check=False)
    rows = []
    for url in CORPUS:
        row = {"url": url}
        try:
            row["baseline"] = fetch_baseline(url)
        except Exception as e:
            row["baseline"] = {"error": str(e)[:160]}
        row["quarry_cold"] = fetch_quarry(url, cache)
        row["quarry_warm"] = fetch_quarry(url, cache)
        base = row["baseline"]
        q = row["quarry_cold"]
        if "error" not in base and "error" not in q:
            row["ratio_text"] = round(base["text_chars"] / max(q["chars"], 1), 2)
            row["ratio_html"] = round(base["html_chars"] / max(q["chars"], 1), 2)
            row["ratio_bytes"] = round(base["bytes"] / max(q["bytes_body"], 1), 2)
        rows.append(row)
        print(json.dumps({k: row[k] for k in row if k != "baseline" or True})[:300], flush=True)

    ok = [r for r in rows if "ratio_text" in r]
    summary = {
        "pages": len(rows),
        "ok": len(ok),
        "median_ratio_text": round(statistics.median([r["ratio_text"] for r in ok]), 2) if ok else None,
        "median_ratio_html": round(statistics.median([r["ratio_html"] for r in ok]), 2) if ok else None,
        "median_ratio_bytes": round(statistics.median([r["ratio_bytes"] for r in ok]), 2) if ok else None,
        "total_baseline_text_chars": sum(r["baseline"]["text_chars"] for r in ok),
        "total_quarry_chars": sum(r["quarry_cold"]["chars"] for r in ok),
        "cold_ms_p50": round(statistics.median([r["quarry_cold"]["ms"] for r in rows if "ms" in r["quarry_cold"]]), 1),
        "warm_ms_p50": round(statistics.median([r["quarry_warm"]["ms"] for r in rows if "ms" in r["quarry_warm"]]), 1),
        "needs_browser": sum(1 for r in rows if r["quarry_cold"].get("needs_browser")),
        "errors": [r["url"] for r in rows if "error" in r["quarry_cold"]],
    }
    if ok:
        summary["total_ratio"] = round(
            summary["total_baseline_text_chars"] / max(summary["total_quarry_chars"], 1), 2
        )
    (OUT / "results.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    sys.exit(main())
