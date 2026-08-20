"""Stdlib TOTP (RFC 6238, SHA-1, 6 digits, 30s period).

Small enough that a dependency (pyotp) is not worth it. Secrets are stored
Fernet-encrypted on the User row; this module only deals with the raw
base32 secret.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

PERIOD_SECONDS = 30
DIGITS = 6


def generate_secret() -> str:
    """New 160-bit base32 secret (no padding), per RFC 4226 recommendation."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    # Re-pad: authenticator apps strip '=' from base32 secrets.
    padded = secret.strip().replace(" ", "").upper()
    padded += "=" * (-len(padded) % 8)
    key = base64.b32decode(padded)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**DIGITS)).zfill(DIGITS)


def totp_code(secret: str, at_time: float | None = None) -> str:
    counter = int((at_time if at_time is not None else time.time()) // PERIOD_SECONDS)
    return _hotp(secret, counter)


def verify_totp(secret: str, code: str, *, at_time: float | None = None, window: int = 1) -> bool:
    """Constant-time comparison over the current step +/- `window` steps
    (tolerates clock skew between server and authenticator app)."""
    if not secret or not code:
        return False
    cleaned = code.strip().replace(" ", "")
    if not cleaned.isdigit() or len(cleaned) != DIGITS:
        return False
    counter = int((at_time if at_time is not None else time.time()) // PERIOD_SECONDS)
    return any(
        hmac.compare_digest(_hotp(secret, counter + offset), cleaned)
        for offset in range(-window, window + 1)
    )


def otpauth_uri(secret: str, *, account: str, issuer: str = "Bokito") -> str:
    """otpauth:// provisioning URI understood by authenticator apps."""
    label = f"{quote(issuer)}:{quote(account)}"
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}"
        f"&algorithm=SHA1&digits={DIGITS}&period={PERIOD_SECONDS}"
    )
