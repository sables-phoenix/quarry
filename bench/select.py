#!/usr/bin/env python3
import json
import statistics
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "target" / "release" / "quarry"

CASES = [
    ("https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", "how does etag revalidation work", "if-none-match"),
    ("https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html", "what happens when a value goes out of scope", "drop"),
    ("https://www.postgresql.org/docs/current/sql-select.html", "how do i limit the rows returned", "LIMIT"),
    ("https://nodejs.org/api/fs.html", "how do i read a file synchronously", "readFileSync"),
    ("https://www.typescriptlang.org/docs/handbook/2/generics.html", "constrain a type parameter", "extends"),
    ("https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api", "how do i authenticate a request", "token"),
    ("https://sqlite.org/lang_select.html", "how does group by work", "GROUP BY"),
    ("https://kubernetes.io/docs/concepts/overview/", "what is a pod", "pod"),
    ("https://docs.docker.com/engine/network/", "what is the default bridge network", "bridge"),
    ("https://web.dev/articles/rendering-performance", "how does the browser render a page", "render"),
]


def run(args):
    proc = subprocess.run([str(BIN)] + args, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        return None, proc.stderr.strip()[:200]
    return json.loads(proc.stdout), None


def main():
    rows = []
    for url, question, needle in CASES:
        full, err = run(["fetch", url, "--json", "--max-chars", "1000000"])
        if err:
            rows.append({"url": url, "error": err})
            continue
        picked, err = run(["ask", url, "-q", question, "--top", "3", "--json"])
        if err:
            rows.append({"url": url, "error": err})
            continue
        text = "\n".join(s["body"] for s in picked)
        found = needle.lower() in text.lower()
        rows.append(
            {
                "url": url,
                "question": question,
                "needle": needle,
                "full_chars": full["chars"],
                "full_tokens": full["tokens_est"],
                "selected_chars": sum(len(s["body"]) for s in picked),
                "selected_tokens": sum(s["tokens_est"] for s in picked),
                "ratio": round(full["chars"] / max(sum(len(s["body"]) for s in picked), 1), 2),
                "found": found,
                "sections": [s["anchor"] for s in picked],
            }
        )
    ok = [r for r in rows if "error" not in r]
    summary = {
        "cases": len(rows),
        "ok": len(ok),
        "recall": round(sum(1 for r in ok if r["found"]) / max(len(ok), 1), 2),
        "median_ratio": round(statistics.median([r["ratio"] for r in ok]), 2) if ok else None,
        "total_full_tokens": sum(r["full_tokens"] for r in ok),
        "total_selected_tokens": sum(r["selected_tokens"] for r in ok),
    }
    if ok:
        summary["total_ratio"] = round(
            summary["total_full_tokens"] / max(summary["total_selected_tokens"], 1), 2
        )
    out = ROOT / "bench" / "select.json"
    out.write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(json.dumps(summary, indent=2))
    for r in ok:
        mark = "hit " if r["found"] else "miss"
        print(f"{mark} {r['ratio']:>5.1f}x  {r['selected_tokens']:>6} of {r['full_tokens']:>7} tokens  {r['url']}")


if __name__ == "__main__":
    main()
