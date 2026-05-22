from typing import Any


class DatabricksSQLClient:
    def __init__(
        self,
        host: str,
        token: str,
        warehouse_id: str | None = None,
    ) -> None:
        self.host = host
        self.token = token
        self.warehouse_id = warehouse_id

    def execute_query(self, query: str) -> dict[str, Any]:
        return {
            "status": "not_implemented",
            "query": query,
            "rows": [],
        }
