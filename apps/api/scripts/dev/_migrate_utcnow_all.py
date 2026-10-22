"""Replace datetime.utcnow() with app.core.time.utcnow across apps/api/app."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "app"
SKIP = {"core/time.py"}
IMPORT = "from app.core.time import utcnow"


def ensure_import(text: str) -> str:
    if IMPORT in text:
        return text
    # After module docstring if present
    m = re.match(r'\A(\s*"""[\s\S]*?"""\n)', text)
    if m:
        rest = text[m.end() :]
        if rest.startswith("from __future__"):
            # after future import
            fm = re.match(r"(from __future__ import annotations\n)", rest)
            if fm:
                return m.group(1) + fm.group(1) + "\n" + IMPORT + "\n" + rest[fm.end() :]
        return m.group(1) + "\n" + IMPORT + "\n" + rest
    if text.startswith("from __future__"):
        fm = re.match(r"(from __future__ import annotations\n)", text)
        if fm:
            return fm.group(1) + "\n" + IMPORT + "\n" + text[fm.end() :]
    return IMPORT + "\n" + text


def main() -> None:
    total = 0
    files = 0
    for path in sorted(ROOT.rglob("*.py")):
        rel = path.relative_to(ROOT).as_posix()
        if rel in SKIP:
            continue
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        text = raw.decode("utf-8")
        n = text.count("datetime.utcnow()")
        if not n:
            continue
        text = text.replace("datetime.utcnow()", "utcnow()")
        text = ensure_import(text)
        path.write_text(text, encoding="utf-8", newline="\n")
        total += n
        files += 1
        print(f"{n:3d} {rel}")
    print(f"TOTAL {total} in {files} files")


if __name__ == "__main__":
    main()
