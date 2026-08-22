"""One-off: create the EU R2 bucket + S3 credentials. Writes .env.r2 (gitignored)."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
BUCKET = "bokito-uploads"


def _load_token() -> str:
    token = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
    if token:
        return token
    env = ROOT / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("CLOUDFLARE_API_TOKEN="):
            return line.split("=", 1)[1].strip()
        if line.startswith("CF_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("CLOUDFLARE_API_TOKEN missing")


def main() -> None:
    token = _load_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    with httpx.Client(timeout=30.0) as client:
        accounts = client.get("https://api.cloudflare.com/client/v4/accounts", headers=headers)
        accounts.raise_for_status()
        payload = accounts.json()
        if not payload.get("success"):
            raise SystemExit(f"accounts failed: {payload}")
        account = payload["result"][0]
        account_id = account["id"]
        print(f"account={account.get('name')} id={account_id[:6]}...")

        buckets = client.get(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets",
            headers={**headers, "cf-r2-jurisdiction": "eu"},
        )
        print(f"list_buckets_eu status={buckets.status_code}")
        existing = []
        if buckets.status_code == 200 and buckets.json().get("success"):
            existing = [b.get("name") for b in buckets.json().get("result", {}).get("buckets", [])]
        print(f"existing_eu={existing}")

        if BUCKET not in existing:
            created = client.post(
                f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets",
                headers={**headers, "cf-r2-jurisdiction": "eu"},
                json={"name": BUCKET, "locationHint": "weur"},
            )
            print(f"create_bucket status={created.status_code} success={created.json().get('success')}")
            if not created.json().get("success"):
                print(created.json().get("errors"))
                raise SystemExit("bucket create failed")
        else:
            print("bucket already exists")

        groups = client.get(
            "https://api.cloudflare.com/client/v4/user/tokens/permission_groups",
            headers=headers,
        )
        print(f"permission_groups status={groups.status_code}")
        r2_groups = []
        if groups.status_code == 200 and groups.json().get("success"):
            for g in groups.json()["result"]:
                name = (g.get("name") or "").lower()
                if "r2" in name:
                    r2_groups.append({"id": g["id"], "name": g["name"]})
        print("r2_groups=" + json.dumps(r2_groups))

        write_ids = [
            g["id"]
            for g in r2_groups
            if "write" in g["name"].lower() or g["name"].lower() in ("workers r2 storage write", "object read & write")
        ]
        if not write_ids:
            write_ids = [g["id"] for g in r2_groups if "read" in g["name"].lower() and "write" in g["name"].lower()]
        if not write_ids:
            raise SystemExit("no R2 write permission group found — token may lack Admin Read")

        # Prefer account-owned token; fall back to user token.
        token_body = {
            "name": "bokito-uploads-s3",
            "policies": [
                {
                    "effect": "allow",
                    "permission_groups": [{"id": gid} for gid in write_ids],
                    "resources": {
                        f"com.cloudflare.edge.r2.bucket.{account_id}_eu_{BUCKET}": "*",
                    },
                }
            ],
        }
        created_token = client.post(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/tokens",
            headers=headers,
            json=token_body,
        )
        if created_token.status_code >= 400 or not created_token.json().get("success"):
            print(f"account_token status={created_token.status_code} errors={created_token.json().get('errors')}")
            created_token = client.post(
                "https://api.cloudflare.com/client/v4/user/tokens",
                headers=headers,
                json=token_body,
            )
        print(f"create_token status={created_token.status_code} success={created_token.json().get('success')}")
        if not created_token.json().get("success"):
            print(created_token.json().get("errors"))
            raise SystemExit("token create failed")
        result = created_token.json()["result"]
        access_key = result["id"]
        secret = hashlib.sha256(result["value"].encode("utf-8")).hexdigest()
        endpoint = f"https://{account_id}.eu.r2.cloudflarestorage.com"
        out = ROOT / ".env.r2"
        out.write_text(
            "\n".join(
                [
                    "STORAGE_BACKEND=s3",
                    f"STORAGE_S3_BUCKET={BUCKET}",
                    "STORAGE_S3_REGION=auto",
                    f"STORAGE_S3_ENDPOINT={endpoint}",
                    f"STORAGE_S3_ACCESS_KEY={access_key}",
                    f"STORAGE_S3_SECRET_KEY={secret}",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        print(f"wrote {out.name} endpoint_host={account_id[:6]}...eu.r2")


if __name__ == "__main__":
    main()
