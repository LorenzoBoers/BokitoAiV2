"""Migrate raise HTTPException(status_code=422, detail="...") to AppError."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "app" / "services"
PATTERN = re.compile(
    r"""raise\s+HTTPException\(\s*status_code\s*=\s*422\s*,\s*detail\s*=\s*(?P<q>['\"])(?P<msg>(?:\\.|(?!\2).)*)(?P=q)\s*\)"""
)


def main() -> None:
    total = 0
    files = 0
    for path in sorted(ROOT.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if "status_code=422" not in text:
            continue

        def sub(m: re.Match[str]) -> str:
            return f'raise AppError("{m.group("msg")}", code="validation_error", status_code=422)'

        new, count = PATTERN.subn(sub, text)
        if count == 0:
            continue
        if "from app.exceptions import" in new:
            m = re.search(r"from app\.exceptions import ([^\n]+)", new)
            assert m
            names = {p.strip() for p in m.group(1).split(",") if p.strip()}
            names.add("AppError")
            new = re.sub(
                r"from app\.exceptions import ([^\n]+)",
                f"from app.exceptions import {', '.join(sorted(names))}",
                new,
                count=1,
            )
        else:
            new = "from app.exceptions import AppError\n" + new
        if not re.search(r"\bHTTPException\b", re.sub(r"from fastapi import[^\n]+\n", "", new)):
            new = re.sub(
                r"from fastapi import ([^\n]+)\n",
                lambda m: (
                    (
                        f"from fastapi import {', '.join(p.strip() for p in m.group(1).split(',') if p.strip() and p.strip() != 'HTTPException')}\n"
                    )
                    if any(p.strip() and p.strip() != "HTTPException" for p in m.group(1).split(","))
                    else ""
                ),
                new,
                count=1,
            )
        path.write_text(new, encoding="utf-8", newline="\n")
        files += 1
        total += count
        print(f"{path.relative_to(ROOT.parent.parent).as_posix()}: {count}")
    print(f"done files={files} raises={total}")


if __name__ == "__main__":
    main()
