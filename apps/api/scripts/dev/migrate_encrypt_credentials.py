"""Encrypt legacy plaintext credentials_json on ChannelAccount + IntegrationConnection.

Usage (from apps/api):
  .venv/Scripts/python.exe -m scripts.dev.migrate_encrypt_credentials
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Allow running as module
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


async def main() -> None:
    from sqlalchemy import select

    from app.db.session import async_session_factory
    from app.models.channel import ChannelAccount
    from app.models.integration import IntegrationConnection
    from app.services.crypto import (
        get_connection_credentials,
        is_encrypted_credentials,
        set_connection_credentials,
    )

    async with async_session_factory() as session:
        accounts = (await session.execute(select(ChannelAccount))).scalars().all()
        conns = (await session.execute(select(IntegrationConnection))).scalars().all()
        n_acc = 0
        n_conn = 0
        for account in accounts:
            if is_encrypted_credentials(account.credentials_json):
                continue
            creds = get_connection_credentials(account)
            if not creds:
                continue
            set_connection_credentials(account, creds)
            session.add(account)
            n_acc += 1
        for conn in conns:
            if is_encrypted_credentials(conn.credentials_json):
                continue
            creds = get_connection_credentials(conn)
            if not creds:
                continue
            set_connection_credentials(conn, creds)
            session.add(conn)
            n_conn += 1
        await session.commit()
        print(f"encrypted channel_accounts={n_acc} integration_connections={n_conn}")


if __name__ == "__main__":
    asyncio.run(main())
