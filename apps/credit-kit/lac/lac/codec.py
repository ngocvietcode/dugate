"""Payload Codec AES-256-GCM cho worker Temporal Python — cùng định dạng với apps/src/platform/codec.ts.

APPS_PAYLOAD_KEYS="id1:base64,id2:base64", APPS_PAYLOAD_KEY_ID=id1.
"""
from __future__ import annotations

import base64
import os
from typing import Iterable, Sequence

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from temporalio.api.common.v1 import Payload
from temporalio.converter import PayloadCodec

ENCODING = b"binary/encrypted"


def key_ring_from_env(env=os.environ) -> tuple[str, dict[str, bytes]]:
    raw = env.get("APPS_PAYLOAD_KEYS")
    if not raw:
        raise ValueError("thiếu APPS_PAYLOAD_KEYS (khoá mã hoá payload, lấy từ Vault/KMS)")
    keys = {}
    for part in raw.split(","):
        kid, _, b64 = part.partition(":")
        k = base64.b64decode(b64)
        if not kid or len(k) != 32:
            raise ValueError(f"khoá payload '{kid}' phải là 32 byte base64")
        keys[kid] = k
    current = env.get("APPS_PAYLOAD_KEY_ID") or next(iter(keys))
    if current not in keys:
        raise ValueError(f"APPS_PAYLOAD_KEY_ID {current} không có trong APPS_PAYLOAD_KEYS")
    return current, keys


class AesGcmCodec(PayloadCodec):
    def __init__(self, current: str, keys: dict[str, bytes]):
        self.current, self.keys = current, keys

    async def encode(self, payloads: Sequence[Payload]) -> list[Payload]:
        return [self.encode_one(p) for p in payloads]

    async def decode(self, payloads: Sequence[Payload]) -> list[Payload]:
        return [self.decode_one(p) for p in payloads]

    def encode_one(self, p: Payload, nonce: bytes | None = None) -> Payload:
        iv = nonce or os.urandom(12)
        ct = AESGCM(self.keys[self.current]).encrypt(iv, p.SerializeToString(), None)
        return Payload(metadata={"encoding": ENCODING, "encryption-key-id": self.current.encode()}, data=iv + ct)

    def decode_one(self, p: Payload) -> Payload:
        if p.metadata.get("encoding") != ENCODING:
            return p
        kid = p.metadata["encryption-key-id"].decode()
        if kid not in self.keys:
            raise ValueError(f"không có khoá payload '{kid}'")
        out = Payload()
        out.ParseFromString(AESGCM(self.keys[kid]).decrypt(p.data[:12], p.data[12:], None))
        return out


