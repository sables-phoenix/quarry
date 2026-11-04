#!/usr/bin/env python3
import json
import statistics
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "target" / "release" / "quarry"

URLS = [
    "https://docs.rs/serde/latest/serde/",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
    "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
    "https://nodejs.org/api/fs.html",
    "https://www.typescriptlang.org/docs/handbook/2/generics.html",
    "https://sqlite.org/lang_select.html",
]


def jina(url):
    started = time.perf_counter()
    req = urllib.request.Request("https://r.jina.ai/" + url, headers={"User-Agent": "quarry-bench/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", "replace")
    except Exception as e:
        return {"error": str(e)[:160]}
    ms = (time.perf_counter() - started) * 1000
    return {"chars": len(body), "tokens": (len(body) + 3) // 4, "ms": ms}


def quarry(url):
    started = time.perf_counter()
    proc = subprocess.run(
        [str(BIN), "fetch", url, "--json", "--max-chars", "1000000"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    ms = (time.perf_counter() - started) * 1000
    if proc.returncode != 0:
        return {"error": proc.stderr.strip()[:160]}
    doc = json.loads(proc.stdout)
    return {"chars": doc["chars"], "tokens": doc["tokens_est"], "ms": ms}


def main():
    rows = []
    for url in URLS:
        q = quarry(url)
        j = jina(url)
        row = {"url": url, "quarry": q, "jina": j}
        if "error" not in q and "error" not in j:
            row["token_ratio"] = round(j["tokens"] / max(q["tokens"], 1), 2)
            row["ms_ratio"] = round(j["ms"] / max(q["ms"], 1), 2)
        rows.append(row)
        print(json.dumps(row)[:300], flush=True)
    ok = [r for r in rows if "token_ratio" in r]
    summary = {
        "urls": len(rows),
        "ok": len(ok),
        "median_token_ratio": round(statistics.median([r["token_ratio"] for r in ok]), 2) if ok else None,
        "median_ms_ratio": round(statistics.median([r["ms_ratio"] for r in ok]), 2) if ok else None,
        "quarry_tokens": sum(r["quarry"]["tokens"] for r in ok),
        "jina_tokens": sum(r["jina"]["tokens"] for r in ok),
    }
    (ROOT / "bench" / "external.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
