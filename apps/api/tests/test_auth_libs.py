"""Hashes and tokens made by the old passlib/python-jose stack stay valid."""

import jwt

from app.services import auth

# Generated with passlib CryptContext(bcrypt) and python-jose before the swap.
PASSLIB_SHORT = "$2b$12$0K/LjmGk3OWkDn6JcpGhjuOGdF6sMX7qEMZRxTaLrIYbduTY6Fz9O"  # "bokito-pass"
PASSLIB_LONG = "$2b$12$y8NM1rPMWfM.oj3ok0yfNevdFpOyKVKp3Bag/OHoyPBh9eIbyUnca"  # "x" * 100
JOSE_TOKEN = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiJ1MSIsInRlbmFudF9pZCI6InQxIiwiZXhwIjo0MDcwOTA4ODAwLCJ0eXBlIjoiYWNjZXNzIn0."
    "IaiTYU6owtXYy9iQG--KF3rcRH6Q1Vqb90nKpPWilPE"
)
JOSE_SECRET = "fixture-secret-0123456789abcdef0123"


def test_existing_passlib_hashes_verify():
    assert auth.verify_password("bokito-pass", PASSLIB_SHORT)
    assert not auth.verify_password("wrong", PASSLIB_SHORT)
    # >72 bytes: passlib truncated silently; we truncate explicitly.
    assert auth.verify_password("x" * 100, PASSLIB_LONG)


def test_new_hash_roundtrip_and_empty_hash():
    h = auth.hash_password("nieuw-wachtwoord")
    assert h.startswith("$2b$")
    assert auth.verify_password("nieuw-wachtwoord", h)
    assert not auth.verify_password("x", "")
    assert not auth.verify_password("x", "not-a-hash")


def test_jose_token_decodes_with_pyjwt():
    payload = jwt.decode(JOSE_TOKEN, JOSE_SECRET, algorithms=["HS256"])
    assert payload["sub"] == "u1" and payload["type"] == "access"
