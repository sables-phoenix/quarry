import json
import re
import sys
import urllib.request

LOCK = "Cargo.lock"
API = "https://api.osv.dev/v1/querybatch"


def packages():
    text = open(LOCK).read()
    out = []
    for name, version in re.findall(r'name = "([^"]+)"\nversion = "([^"]+)"', text):
        out.append((name, version))
    return out


def query(batch):
    body = json.dumps(
        {"queries": [{"package": {"ecosystem": "crates.io", "name": n}, "version": v} for n, v in batch]}
    ).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def main():
    deps = packages()
    findings = []
    for i in range(0, len(deps), 100):
        batch = deps[i : i + 100]
        result = query(batch)
        for (name, version), res in zip(batch, result.get("results", [])):
            for vuln in res.get("vulns", []):
                findings.append(
                    {
                        "package": name,
                        "version": version,
                        "id": vuln.get("id"),
                        "summary": (vuln.get("summary") or "")[:160],
                        "severity": [
                            s.get("type")
                            for s in vuln.get("severity", [])
                        ],
                    }
                )
    print(json.dumps({"dependencies": len(deps), "vulnerabilities": findings}, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
