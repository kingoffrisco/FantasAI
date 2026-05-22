from typing import Any

import asyncio
import httpx


class DatabricksSQLClient:
    def __init__(
        self,
        host: str,
        token: str,
        warehouse_id: str,
    ) -> None:
        self.host = host.rstrip("/")
        self.token = token
        self.warehouse_id = warehouse_id
        self.base_url = f"{self.host}/api/2.0/sql/statements"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def execute_query(
        self,
        query: str,
        poll_interval_seconds: float = 2.0,
        timeout_seconds: float = 60.0,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            submit_response = await client.post(
                self.base_url,
                headers=self.headers,
                json={
                    "statement": query,
                    "warehouse_id": self.warehouse_id,
                    "wait_timeout": "10s",
                    "disposition": "INLINE",
                    "format": "JSON_ARRAY",
                },
            )
            submit_response.raise_for_status()
            payload = submit_response.json()

            state = payload.get("status", {}).get("state")
            statement_id = payload.get("statement_id")

            if state == "SUCCEEDED":
                return payload

            if not statement_id:
                return payload

            elapsed = 0.0
            while elapsed < timeout_seconds:
                poll_response = await client.get(
                    f"{self.base_url}/{statement_id}",
                    headers=self.headers,
                )
                poll_response.raise_for_status()
                payload = poll_response.json()
                state = payload.get("status", {}).get("state")

                if state == "SUCCEEDED":
                    return payload

                if state in {"FAILED", "CANCELED", "CLOSED"}:
                    return payload

                await asyncio.sleep(poll_interval_seconds)
                elapsed += poll_interval_seconds

            return {
                "status": {
                    "state": "TIMEOUT",
                    "message": f"Query did not finish within {timeout_seconds} seconds.",
                },
                "statement_id": statement_id,
            }
