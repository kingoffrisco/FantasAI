from typing import Any

import httpx

from app.config import settings


class SleeperClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or settings.sleeper_base_url

    async def get_nfl_state(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{self.base_url}/state/nfl")
            response.raise_for_status()
            return response.json()

    async def get_trending_players(self, add_drop: str = "add", hours: int = 24, limit: int = 25) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/players/nfl/trending/{add_drop}",
                params={"lookback_hours": hours, "limit": limit},
            )
            response.raise_for_status()
            return response.json()
