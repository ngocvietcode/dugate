import asyncio
import base64
import json
from pathlib import Path

import pytest

pytest.importorskip("temporalio")
from temporalio.api.common.v1 import Payload  # noqa: E402

from lac.codec import AesGcmCodec, key_ring_from_env  # noqa: E402

V = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "codec-vectors.json").read_text(encoding="utf-8"))
CODEC = AesGcmCodec(*key_ring_from_env({"APPS_PAYLOAD_KEYS": V["keys"], "APPS_PAYLOAD_KEY_ID": V["key_id"]}))


def from_vec(x):
    return Payload(metadata={k: base64.b64decode(b) for k, b in x["metadata"].items()}, data=base64.b64decode(x["data_b64"]))


def test_decodes_typescript_vector():
    [d] = asyncio.run(CODEC.decode([from_vec(V["from_typescript"])]))
    assert d.data.decode() == V["plain"]["data_utf8"] and d.metadata["encoding"] == b"json/plain"


def test_python_vector_is_reproducible():
    plain = Payload(metadata={"encoding": b"json/plain"}, data=V["plain"]["data_utf8"].encode())
    e = CODEC.encode_one(plain, nonce=bytes(range(12)))
    assert base64.b64encode(e.data).decode() == V["from_python"]["data_b64"]


def test_roundtrip_hides_plaintext():
    p = Payload(metadata={"encoding": b"json/plain"}, data=b'{"cccd":"001192012345"}')
    [e] = asyncio.run(CODEC.encode([p]))
    assert b"001192012345" not in e.data
    [d] = asyncio.run(CODEC.decode([e]))
    assert d == p
