"""Bump the release version in ./VERSION.

Each production deploy runs this once, so the dev checkout stays one patch
ahead of the version just shipped. A larger step is an explicit argument:

    python scripts/bump_release_version.py           # 1.2.01 -> 1.2.02
    python scripts/bump_release_version.py 1.3.00    # set that version
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parents[1] / "VERSION"
_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def parse_version(raw: str) -> tuple[int, int, int]:
    match = _VERSION_RE.match(raw.strip())
    if not match:
        raise ValueError(f"Version must look like 1.2.01, got {raw!r}")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def format_version(major: int, minor: int, patch: int) -> str:
    return f"{major}.{minor}.{patch:02d}"


def next_patch(raw: str) -> str:
    major, minor, patch = parse_version(raw)
    return format_version(major, minor, patch + 1)


def resolve_next(current: str, argument: str | None) -> str:
    if argument is None or argument == "":
        return next_patch(current)
    parse_version(argument)
    return format_version(*parse_version(argument))


def write_version(path: Path, argument: str | None) -> tuple[str, str]:
    current = path.read_text(encoding="utf-8").strip()
    updated = resolve_next(current, argument)
    path.write_text(updated + "\n", encoding="utf-8")
    return current, updated


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    argument = args[0] if args else None
    previous, updated = write_version(VERSION_FILE, argument)
    print(updated)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"previous={previous}\nversion={updated}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc
