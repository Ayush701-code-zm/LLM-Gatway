"""AES-256-GCM secret encryption for MFA and other stored secrets."""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from smartroute.config import settings

ALGORITHM = "aes-256-gcm"
IV_LENGTH = 12


def _derive_key() -> bytes:
    return hashlib.sha256(settings.API_KEY_ENCRYPTION_SECRET.encode()).digest()


def encrypt_secret(plaintext: str) -> str:
    iv = os.urandom(IV_LENGTH)
    aesgcm = AESGCM(_derive_key())
    encrypted = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    tag = encrypted[-16:]
    data = encrypted[:-16]
    return ".".join(
        [
            base64.b64encode(iv).decode(),
            base64.b64encode(tag).decode(),
            base64.b64encode(data).decode(),
        ]
    )


def decrypt_secret(ciphertext: str) -> str:
    parts = ciphertext.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid encrypted secret format")

    iv_b64, tag_b64, data_b64 = parts
    iv = base64.b64decode(iv_b64)
    tag = base64.b64decode(tag_b64)
    data = base64.b64decode(data_b64)

    aesgcm = AESGCM(_derive_key())
    plaintext = aesgcm.decrypt(iv, data + tag, None)
    return plaintext.decode("utf-8")


def resolve_secret(stored: str) -> str:
    if stored.startswith("whs_") or stored.startswith("whsec_"):
        return stored
    return decrypt_secret(stored)
