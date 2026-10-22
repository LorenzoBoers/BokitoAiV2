"""Migrate simple raise HTTPException in services/ to AppError hierarchy.

Only rewrites string-detail raises with status 400/401/403/404.
Skips dict details and uncommon status codes.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "app" / "services"

MAP = {
    404: ("NotFoundError", "not_found"),
    403: ("ForbiddenError", "forbidden"),
    401: ("UnauthorizedError", "unauthorized"),
    400: ("AppError", "app_error"),
}

# raise HTTPException(status_code=404, detail="...")
# raise HTTPException(status_code=404, detail='...')
PATTERN = re.compile(
    r"""raise\s+HTTPException\(\s*status_code\s*=\s*(?P<code>400|401|403|404)\s*,\s*detail\s*=\s*(?P<q>['\"])(?P<msg>(?:\\.|(?!\2).)*)(?P=q)\s*\)""",
    re.MULTILINE,
)


def needed_imports(text: str, names: set[str]) -> str:
    if "from app.exceptions import" in text:
        # extend existing import
        def repl(m: re.Match[str]) -> str:
            existing = {p.strip() for p in m.group(1).split(",")}
            merged = sorted(existing | names)
            return f"from app.exceptions import {', '.join(merged)}"

        new_text, n = re.subn(
            r"from app\.exceptions import ([^\n]+)",
            repl,
            text,
            count=1,
        )
        if n:
            return new_text
    # insert after future / docstring block — before first from/import of app.
    lines = text.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("from __future__"):
            insert_at = i + 1
            continue
        if line.startswith("from app.") or line.startswith("import app"):
            insert_at = i
            break
        if line.startswith(("import ", "from ")) and insert_at == 0:
            insert_at = i
    # prefer after third-party imports: find last non-app import
    last_non_app = insert_at
    for i, line in enumerate(lines):
        if line.startswith("from app.") or line.startswith("import app"):
            break
        if line.startswith(("import ", "from ")):
            last_non_app = i + 1
    insert_at = last_non_app
    while insert_at < len(lines) and lines[insert_at].strip() == "":
        insert_at += 1
    # back up to after blank following imports
    names_sorted = ", ".join(sorted(names))
    stmt = f"from app.exceptions import {names_sorted}\n"
    # if previous line isn't blank, add blank
    out = lines[:insert_at]
    if out and out[-1].strip() != "":
        out.append("\n")
    out.append(stmt)
    if insert_at < len(lines) and lines[insert_at].strip() != "":
        out.append("\n")
    out.extend(lines[insert_at:])
    return "".join(out)


def transform(text: str) -> tuple[str, int, set[str]]:
    used: set[str] = set()
    count = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal count
        code = int(m.group("code"))
        msg = m.group("msg")
        cls, default_code = MAP[code]
        used.add(cls)
        count += 1
        if cls == "AppError":
            return f'raise AppError("{msg}", code="{default_code}", status_code={code})'
        return f'raise {cls}("{msg}")'

    new = PATTERN.sub(sub, text)
    if count == 0:
        return text, 0, set()
    # drop unused HTTPException import if no longer referenced
    if "HTTPException" in new and not re.search(r"\bHTTPException\b", new.replace("from fastapi import", "").split("\n", 1)[-1] if False else new):
        pass
    if not re.search(r"\bHTTPException\b", re.sub(r"from fastapi import[^\n]+", "", new)):
        new = re.sub(
            r"from fastapi import ([^\n]+)\n",
            lambda m: _clean_fastapi_import(m.group(1)),
            new,
            count=1,
        )
    new = needed_imports(new, used)
    return new, count, used


def _clean_fastapi_import(names: str) -> str:
    parts = [p.strip() for p in names.split(",") if p.strip() and p.strip() != "HTTPException"]
    if not parts:
        return ""
    return f"from fastapi import {', '.join(parts)}\n"


def main() -> None:
    total = 0
    files = 0
    for path in sorted(ROOT.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if "raise HTTPException" not in text:
            continue
        new, count, _ = transform(text)
        if count == 0 or new == text:
            continue
        path.write_text(new, encoding="utf-8", newline="\n")
        files += 1
        total += count
        print(f"{path.relative_to(ROOT.parent.parent).as_posix()}: {count}")
    print(f"done files={files} raises={total}")


if __name__ == "__main__":
    main()
