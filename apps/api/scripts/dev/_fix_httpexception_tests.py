"""Point service-level pytest.raises(HTTPException) at AppError after migration."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "tests"

# Files that call services and assert HTTPException on service raises.
TARGETS = [
    "test_project_canvas.py",
    "test_canvas_kinds.py",
    "test_tickets.py",
    "test_ticket_work.py",
    "test_ticket_stages.py",
    "test_connection_presets.py",
    "test_platform_changes.py",
    "test_integration_catalog_db.py",
    "test_module_attach.py",
    "test_module_connection_integrity.py",
    "test_doc_ingest.py",
    "test_agent_rules.py",
    "test_prod_hardening.py",
    "test_alpaca_native.py",
    "test_king_finance_native.py",
    "test_bjorn_lunden_native.py",
    "test_tenant_providers.py",
]


def fix(text: str) -> str:
    if "pytest.raises(HTTPException)" not in text:
        return text
    text = text.replace("pytest.raises(HTTPException)", "pytest.raises(AppError)")
    # .detail -> .message for AppError (keep if still referencing dict)
    text = re.sub(
        r"(\w+)\.value\.detail\b",
        r"getattr(\1.value, 'message', None) or getattr(\1.value, 'detail', None)",
        text,
    )
    if "from app.exceptions import AppError" not in text and "AppError" in text:
        # Prefer next to existing fastapi HTTPException import
        if "from fastapi import HTTPException" in text:
            text = text.replace(
                "from fastapi import HTTPException",
                "from fastapi import HTTPException\n\nfrom app.exceptions import AppError",
                1,
            )
        else:
            text = "from app.exceptions import AppError\n" + text
    # Drop unused HTTPException import if no longer referenced
    if "HTTPException" in text and not re.search(
        r"\bHTTPException\b",
        re.sub(r"from fastapi import[^\n]+\n", "", text),
    ):
        text = re.sub(r"from fastapi import HTTPException\n\n?", "", text)
        text = re.sub(
            r"from fastapi import ([^\n]*), HTTPException([^\n]*)\n",
            r"from fastapi import \1\2\n",
            text,
        )
        text = re.sub(
            r"from fastapi import HTTPException, ([^\n]+)\n",
            r"from fastapi import \1\n",
            text,
        )
    return text


def main() -> None:
    for name in TARGETS:
        path = ROOT / name
        if not path.exists():
            print("missing", name)
            continue
        old = path.read_text(encoding="utf-8")
        new = fix(old)
        if new != old:
            path.write_text(new, encoding="utf-8", newline="\n")
            print("fixed", name)
        else:
            print("skip", name)


if __name__ == "__main__":
    main()
