"""Worker Temporal Python cho lớp LAC (task queue `credit-lac-py`, plan 002 P2).

Activity tất định, không gọi mạng/DB: nhận đầu ra DU v5 + ngày tham chiếu + cấu hình + quyết định nhánh 1, trả lac.json.

  APPS_PAYLOAD_KEYS=... TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=apps-dev python -m lac.worker
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import dataclasses
import os
from datetime import date

from temporalio import activity
from temporalio.client import Client
from temporalio.converter import DataConverter
from temporalio.exceptions import ApplicationError
from temporalio.worker import Worker

from lac.adapters.du_integration_v5 import InputError, to_lac_input
from lac.codec import AesGcmCodec, key_ring_from_env
from lac.config import ConfigError, load_config
from lac.export import build_lac

TASK_QUEUE = os.environ.get("LAC_TASK_QUEUE", "credit-lac-py")


@activity.defn(name="lacBuild")
def lac_build(params: dict) -> dict:
    """params: {case, refDate, config: "product@version", interestRate?, cicMaxAge?, overrides?, requireApproved?}"""
    try:
        product, version = params["config"].split("@")
        cfg = load_config(product, version)
        if params.get("requireApproved") and cfg.status != "APPROVED":
            raise ApplicationError(f"cấu hình {cfg.ref} chưa APPROVED", type="ConfigNotApproved", non_retryable=True)
        data = to_lac_input(params["case"])
        return build_lac(data, date.fromisoformat(params["refDate"]), cfg, params.get("cicMaxAge"),
                         params.get("interestRate"), params.get("overrides"))
    except (InputError, ConfigError, KeyError, ValueError) as e:
        # lỗi đầu vào/cấu hình: thử lại không giúp gì
        raise ApplicationError(str(e), type=type(e).__name__, non_retryable=True) from e


def data_converter() -> DataConverter:
    current, keys = key_ring_from_env()
    return dataclasses.replace(DataConverter.default, payload_codec=AesGcmCodec(current, keys))


async def main():
    client = await Client.connect(os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
                                  namespace=os.environ.get("TEMPORAL_NAMESPACE", "apps-dev"),
                                  data_converter=data_converter())
    with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("LAC_WORKER_THREADS", "8"))) as pool:
        await Worker(client, task_queue=TASK_QUEUE, activities=[lac_build], activity_executor=pool).run()


if __name__ == "__main__":
    asyncio.run(main())
