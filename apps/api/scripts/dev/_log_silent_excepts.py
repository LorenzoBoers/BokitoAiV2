"""Replace bare `except Exception: pass` with logged variants in app/."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "app"

# Match except Exception: / except Exception as e: followed only by pass (optional comment)
BLOCK = re.compile(
    r"(?P<indent>[ \t]*)except Exception(?P<as>\s+as\s+\w+)?:\n(?P=indent)(?P<body_indent>[ \t]+)pass\s*(?P<comment>#.*)?\n",
    re.MULTILINE,
)


def ensure_logger(text: str) -> str:
    if re.search(r"^logger\s*=\s*logging\.getLogger", text, re.M):
        return text
    if "import logging" not in text:
        # after future
        lines = text.splitlines(keepends=True)
        insert = 0
        for i, line in enumerate(lines):
            if line.startswith("from __future__"):
                insert = i + 1
            elif line.startswith("import ") or line.startswith("from "):
                insert = i
                break
        # find last stdlib import block start
        for i, line in enumerate(lines):
            if line.startswith("import logging"):
                return text
            if line.startswith(("import ", "from ")):
                insert = i
                break
        lines.insert(insert, "import logging\n")
        text = "".join(lines)
    # add logger after imports
    if re.search(r"^logger\s*=", text, re.M):
        return text
    lines = text.splitlines(keepends=True)
    last_import = 0
    for i, line in enumerate(lines):
        if line.startswith(("import ", "from ")) or line.strip() == "":
            if line.startswith(("import ", "from ")):
                last_import = i
            continue
        break
    insert_at = last_import + 1
    while insert_at < len(lines) and lines[insert_at].strip() == "":
        insert_at += 1
    block = "\nlogger = logging.getLogger(__name__)\n\n"
    lines.insert(insert_at, block)
    return "".join(lines)


def transform(text: str, rel: str) -> tuple[str, int]:
    count = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal count
        count += 1
        indent = m.group("indent")
        body = m.group("body_indent")
        as_clause = m.group("as") or " as exc"
        # keep name if present
        if m.group("as"):
            as_clause = m.group("as")
            var = as_clause.strip().split()[-1]
        else:
            as_clause = " as exc"
            var = "exc"
        msg = f"{rel}: swallowed exception"
        return (
            f"{indent}except Exception{as_clause}:\n"
            f"{body}logger.debug({msg!r}, exc_info={var})\n"
        )

    new = BLOCK.sub(sub, text)
    if count:
        new = ensure_logger(new)
    return new, count


def main() -> None:
    total = 0
    files = 0
    for path in sorted(ROOT.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if "except Exception" not in text or "pass" not in text:
            continue
        rel = path.relative_to(ROOT).as_posix()
        new, count = transform(text, rel)
        if count == 0:
            continue
        path.write_text(new, encoding="utf-8", newline="\n")
        files += 1
        total += count
        print(f"{rel}: {count}")
    print(f"done files={files} sites={total}")


if __name__ == "__main__":
    main()
