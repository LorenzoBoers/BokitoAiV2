"""One-off helper: patch remaining credentials_json reads to use crypto helpers.
Run from repo root with apps/api venv if needed. Safe to re-run (idempotent checks).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "app"

PATCHES = {
    "services/calendar_sync.py": [
        (
            "creds = _parse_json(conn.credentials_json)",
            "from app.services.crypto import get_connection_credentials\n    creds = get_connection_credentials(conn)",
        ),
    ],
}

# Manual targeted replacements for known files
FILE_PATCHES: list[tuple[str, str, str]] = [
    (
        "routers/integrations.py",
        'creds = _json.loads(conn.credentials_json or "{}")',
        "from app.services.crypto import get_connection_credentials, set_connection_credentials\n                creds = get_connection_credentials(conn)",
    ),
    (
        "routers/integrations.py",
        'conn.credentials_json = _json.dumps({"mock": True})',
        'set_connection_credentials(conn, {"mock": True})',
    ),
    (
        "channels/whatsapp.py",
        'data = json.loads(account.credentials_json or "{}")',
        "from app.services.crypto import get_connection_credentials\n        data = get_connection_credentials(account)",
    ),
    (
        "channels/slack.py",
        'data = json.loads(account.credentials_json or "{}")',
        "from app.services.crypto import get_connection_credentials\n        data = get_connection_credentials(account)",
    ),
    (
        "routers/email.py",
        'creds = json.loads(account.credentials_json or "{}")',
        "from app.services.crypto import get_connection_credentials\n        creds = get_connection_credentials(account)",
    ),
    (
        "services/module_connections.py",
        "creds = _parse_json(conn.credentials_json)",
        "from app.services.crypto import get_connection_credentials\n        creds = get_connection_credentials(conn)",
    ),
    (
        "modules/accounting/router.py",
        "credentials = _parse_json(conn.credentials_json)",
        "from app.services.crypto import get_connection_credentials\n        credentials = get_connection_credentials(conn)",
    ),
    (
        "modules/banking/router.py",
        "creds = _parse_json(conn.credentials_json)",
        "from app.services.crypto import get_connection_credentials\n    creds = get_connection_credentials(conn)",
    ),
]


def main() -> None:
    for rel, old, new in FILE_PATCHES:
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        if old not in text:
            print(f"SKIP (not found): {rel} :: {old[:50]}")
            continue
        if new in text and old not in text:
            print(f"SKIP (done): {rel}")
            continue
        path.write_text(text.replace(old, new), encoding="utf-8")
        print(f"OK: {rel}")


if __name__ == "__main__":
    main()
