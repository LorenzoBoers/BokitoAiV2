# Key rotation

**Status:** `draft` — operational runbook for engineering. Not legal advice.

## Keys in scope

| Key | Env | Used for |
|---|---|---|
| JWT signing | `JWT_SECRET` / auth settings | Access and refresh tokens |
| Credentials Fernet | `CREDENTIALS_FERNET_KEY` | OAuth and integration `credentials_json` blobs |
| Legacy Fernet | Derived from JWT when credentials key unset (dev only) | Older encrypted values |

Production boot requires `CREDENTIALS_FERNET_KEY`. Do not reuse the JWT secret as the credentials key.

## Rotate credentials Fernet key

1. Generate a new Fernet key (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
2. Deploy with **both** keys available temporarily: keep the old key readable via dual-read fallback if you still store the previous key as an alternate (current code dual-reads plaintext legacy and decrypts with the active credentials key, then JWT-derived fallback).
3. Run `python apps/api/scripts/dev/migrate_encrypt_credentials.py` so every row is re-encrypted under the active key.
4. Remove the old key from secrets after verifying decrypt on a sample of ChannelAccount and IntegrationConnection rows.
5. Record the rotation in the ops change log and `StaffAccessLog` notes if staff tenants were touched.

## Rotate JWT secret

1. Schedule a short maintenance window: active sessions invalidate.
2. Update `JWT_SECRET`, restart API workers.
3. Users sign in again. Refresh tokens issued under the old secret fail until re-login.

## Checklist after rotation

- [ ] Sample OAuth mailbox sync succeeds
- [ ] Calendar sync succeeds
- [ ] Privacy export still returns expected rows
- [ ] No plaintext `credentials_json` left (migrate script dry-run / audit query)
