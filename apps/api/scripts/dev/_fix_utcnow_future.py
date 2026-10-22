"""Move leading `from app.core.time import utcnow` below docstring + __future__."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "app"
MARKER = "from app.core.time import utcnow"


def relocate(text: str) -> str | None:
    lines = text.splitlines(keepends=True)
    if not lines:
        return None
    # Find first utcnow import that appears before any __future__
    future_i = next((i for i, l in enumerate(lines) if l.startswith("from __future__")), None)
    utcnow_i = next((i for i, l in enumerate(lines) if l.rstrip("\r\n") == MARKER), None)
    if utcnow_i is None:
        return None
    if future_i is not None and utcnow_i > future_i:
        return None  # already after __future__
    # Also fix when there is no __future__ but utcnow precedes the module docstring
    if future_i is None:
        doc_i = next(
            (i for i, l in enumerate(lines) if l.lstrip().startswith(('"""', "'''"))),
            None,
        )
        if doc_i is None or utcnow_i > doc_i:
            return None

    # Remove utcnow line (+ one following blank if it only existed as separator)
    removed = lines.pop(utcnow_i)
    if utcnow_i < len(lines) and lines[utcnow_i].strip() == "":
        lines.pop(utcnow_i)

    # Recompute insert index after removal
    future_i = next((i for i, l in enumerate(lines) if l.startswith("from __future__")), None)
    if future_i is not None:
        insert_at = future_i + 1
        while insert_at < len(lines) and lines[insert_at].startswith("from __future__"):
            insert_at += 1
        # keep one blank after futures if present
        if insert_at < len(lines) and lines[insert_at].strip() == "":
            insert_at += 1
    else:
        # after module docstring
        insert_at = 0
        if insert_at < len(lines) and lines[insert_at].lstrip().startswith(('"""', "'''")):
            quote = '"""' if '"""' in lines[insert_at] else "'''"
            if lines[insert_at].count(quote) >= 2 and lines[insert_at].strip() != quote:
                insert_at += 1
            else:
                insert_at += 1
                while insert_at < len(lines) and quote not in lines[insert_at]:
                    insert_at += 1
                if insert_at < len(lines):
                    insert_at += 1
        if insert_at < len(lines) and lines[insert_at].strip() == "":
            insert_at += 1

    # Avoid duplicate
    if any(l.rstrip("\r\n") == MARKER for l in lines):
        return "".join(lines)
    lines.insert(insert_at, removed if removed.endswith("\n") else removed + "\n")
    return "".join(lines)


def main() -> None:
    fixed: list[str] = []
    for path in sorted(ROOT.rglob("*.py")):
        original = path.read_text(encoding="utf-8")
        updated = relocate(original)
        if updated is not None and updated != original:
            path.write_text(updated, encoding="utf-8")
            fixed.append(str(path.relative_to(ROOT.parent)))
    print(f"fixed {len(fixed)}")
    for p in fixed:
        print(p)


if __name__ == "__main__":
    main()
