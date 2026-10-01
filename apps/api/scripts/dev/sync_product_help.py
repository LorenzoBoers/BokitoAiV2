"""Sync docs/product-help into the packaged copy and validate the content.

Usage (from the repo root or anywhere):

    python apps/api/scripts/dev/sync_product_help.py [--check]

Copies ``docs/product-help/{en,nl}`` and ``assets/`` to
``apps/api/app/data/product_help`` (pruning stale files), and validates
frontmatter and en/nl slug parity. ``--check`` validates and diffs without
writing (CI-friendly).
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve()
API_ROOT = SCRIPT.parents[2]
REPO_ROOT = SCRIPT.parents[4]
SOURCE = REPO_ROOT / "docs" / "product-help"
TARGET = API_ROOT / "app" / "data" / "product_help"

LANGS = ("en", "nl")
SECTIONS = ("getting-started", "inbox", "ai", "govern", "integrations", "developers")
REQUIRED_KEYS = ("title", "intro", "description", "keywords", "sort")


def parse_frontmatter(raw: str) -> dict[str, str] | None:
    parts = raw.split("---", 2)
    if len(parts) < 3 or parts[0].strip():
        return None
    meta: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = value.strip()
    return meta


def validate() -> list[str]:
    errors: list[str] = []
    slugs: dict[str, dict[str, str]] = {}
    for lang in LANGS:
        lang_slugs: dict[str, str] = {}
        lang_dir = SOURCE / lang
        if not lang_dir.is_dir():
            errors.append(f"missing language folder: {lang_dir}")
            continue
        for path in sorted(lang_dir.rglob("*.md")):
            rel = path.relative_to(lang_dir)
            if len(rel.parts) != 2 or rel.parts[0] not in SECTIONS:
                errors.append(f"{lang}/{rel.as_posix()}: must live in a known section {SECTIONS}")
                continue
            slug = path.stem
            if slug in lang_slugs:
                errors.append(f"{lang}/{rel.as_posix()}: duplicate slug '{slug}' (also in {lang_slugs[slug]})")
            lang_slugs[slug] = rel.parts[0]
            meta = parse_frontmatter(path.read_text(encoding="utf-8"))
            if meta is None:
                errors.append(f"{lang}/{rel.as_posix()}: missing frontmatter")
                continue
            for key in REQUIRED_KEYS:
                if not meta.get(key):
                    errors.append(f"{lang}/{rel.as_posix()}: missing frontmatter key '{key}'")
        slugs[lang] = lang_slugs

    if all(lang in slugs for lang in LANGS):
        en, nl = slugs["en"], slugs["nl"]
        for slug in sorted(set(en) - set(nl)):
            errors.append(f"parity: '{slug}' exists in en/ but not nl/")
        for slug in sorted(set(nl) - set(en)):
            errors.append(f"parity: '{slug}' exists in nl/ but not en/")
        for slug in sorted(set(en) & set(nl)):
            if en[slug] != nl[slug]:
                errors.append(f"parity: '{slug}' is in section '{en[slug]}' (en) but '{nl[slug]}' (nl)")
    return errors


def tree_markdown(root: Path) -> dict[str, str]:
    if not root.is_dir():
        return {}
    return {
        p.relative_to(root).as_posix(): p.read_text(encoding="utf-8")
        for p in sorted(root.rglob("*.md"))
        if p.relative_to(root).parts[0] in LANGS
    }


def tree_assets(root: Path) -> dict[str, bytes]:
    folder = root / "assets"
    if not folder.is_dir():
        return {}
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(folder.rglob("*"))
        if p.is_file() and p.suffix.lower() in {".png", ".webp"}
    }


def tree(root: Path) -> dict[str, str | bytes]:
    merged: dict[str, str | bytes] = {}
    merged.update(tree_markdown(root))
    merged.update(tree_assets(root))
    return merged


def sync(check_only: bool) -> bool:
    source_tree = tree(SOURCE)
    target_tree = tree(TARGET)
    if source_tree == target_tree:
        print(f"packaged copy up to date ({len(source_tree)} files)")
        return True
    if check_only:
        for missing in sorted(set(source_tree) - set(target_tree)):
            print(f"MISSING in packaged copy: {missing}")
        for stale in sorted(set(target_tree) - set(source_tree)):
            print(f"STALE in packaged copy: {stale}")
        for name in sorted(set(source_tree) & set(target_tree)):
            if source_tree[name] != target_tree[name]:
                print(f"OUT OF DATE: {name}")
        print("run without --check to fix")
        return False
    for lang in LANGS:
        dest = TARGET / lang
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(SOURCE / lang, dest)
    dest_assets = TARGET / "assets"
    if dest_assets.exists():
        shutil.rmtree(dest_assets)
    src_assets = SOURCE / "assets"
    if src_assets.is_dir():
        shutil.copytree(src_assets, dest_assets)
    print(f"synced {len(source_tree)} files to {TARGET}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate and diff without writing")
    args = parser.parse_args()

    errors = validate()
    if errors:
        print("validation failed:")
        for err in errors:
            print(f"  - {err}")
        return 1
    ok = sync(check_only=args.check)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
