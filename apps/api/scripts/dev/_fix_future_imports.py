"""Put future import first (after docstring), then utcnow, then the rest."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FUTURE = "from __future__ import annotations"
UTCNOW = "from app.core.time import utcnow"


def reorder(text: str) -> str:
    lines = text.splitlines(keepends=True)
    has_future = any(ln.strip() == FUTURE for ln in lines)
    has_utcnow = any(ln.strip() == UTCNOW for ln in lines)
    body = [ln for ln in lines if ln.strip() not in (FUTURE, UTCNOW)]

    i = 0
    while i < len(body) and body[i].strip() == "":
        i += 1

    docstring: list[str] = []
    if i < len(body) and body[i].lstrip().startswith(('"""', "'''")):
        q = '"""' if '"""' in body[i] else "'''"
        docstring.append(body[i])
        i += 1
        if body[i - 1].count(q) < 2:
            while i < len(body):
                docstring.append(body[i])
                if q in body[i]:
                    i += 1
                    break
                i += 1

    rest = body[i:]
    while rest and rest[0].strip() == "":
        rest.pop(0)

    out: list[str] = []
    out.extend(docstring)
    if docstring:
        out.append("\n")
    if has_future:
        out.append(FUTURE + "\n\n")
    if has_utcnow:
        out.append(UTCNOW + "\n\n")
    out.extend(rest)
    return "".join(out)


def main() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "app", "--select", "F404", "--output-format=json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    data = json.loads(proc.stdout or "[]")
    paths = sorted({Path(d["filename"]) for d in data})
    print("files", len(paths))
    for path in paths:
        text = path.read_text(encoding="utf-8")
        new = reorder(text)
        if new != text:
            path.write_text(new, encoding="utf-8", newline="\n")
            print("fixed", path.relative_to(ROOT).as_posix())
    print("done")


if __name__ == "__main__":
    main()
