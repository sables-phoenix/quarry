import pathlib
import sys


def strip_strings(line: str) -> str:
    out = []
    in_string = False
    escaped = False
    for c in line:
        if in_string:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            else:
                out.append(c)
    return "".join(out)


def strip_js(line: str) -> str:
    out = []
    quote = None
    escaped = False
    for c in line:
        if quote:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == quote:
                quote = None
        else:
            if c in ("\"", "'", "`"):
                quote = c
            else:
                out.append(c)
    return "".join(out)


def main() -> int:
    bad = []
    for path in sorted(pathlib.Path("src").rglob("*.rs")):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            code = strip_strings(line)
            if "//" in code or "/*" in code:
                bad.append(f"{path}:{number}: {line.strip()}")
    for path in sorted(list(pathlib.Path("browser/src").rglob("*.ts")) + list(pathlib.Path("browser/test").rglob("*.ts"))):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            code = strip_js(line)
            if "//" in code or "/*" in code:
                bad.append(f"{path}:{number}: {line.strip()}")
    if bad:
        print("\n".join(bad))
        print("comments are not allowed in src")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
