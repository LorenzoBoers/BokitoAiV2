#!/usr/bin/env python3
"""Stream one Mistral turn with reasoning_effort=high from the prod API container."""
import os

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
MODEL = os.environ.get("MISTRAL_MODEL", "mistral-medium-latest")

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, os
from openai import AsyncOpenAI

async def main():
    key = os.environ.get("MISTRAL_API_KEY", "")
    print("key set:", bool(key))
    client = AsyncOpenAI(api_key=key, base_url="https://api.mistral.ai/v1")
    stream = await client.chat.completions.create(
        model="{MODEL}",
        messages=[{{"role": "user", "content": "Wat is 17 * 23? Antwoord kort."}}],
        max_tokens=2048,
        stream=True,
        extra_body={{"reasoning_effort": "high"}},
    )
    kinds = {{}}
    n = 0
    async for chunk in stream:
        if not chunk.choices:
            continue
        c = chunk.choices[0].delta.content
        k = type(c).__name__
        kinds[k] = kinds.get(k, 0) + 1
        if n < 3 and isinstance(c, list):
            print("list sample:", repr(c)[:300])
            n += 1
    print("content types:", kinds)

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err[-2000:])
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
