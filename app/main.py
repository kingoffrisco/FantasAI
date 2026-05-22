from fastapi import FastAPI, Query

from app.config import settings
from app.services.fantasy_apis import SleeperClient

app = FastAPI(title="FantasAI API", version="0.1.0")


@app.get("/")
def read_root() -> dict[str, str]:
    return {
        "name": "FantasAI",
        "environment": settings.app_env,
        "status": "ok",
    }


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/players/trending")
async def get_trending_players(
    add_drop: str = Query(default="add", pattern="^(add|drop)$"),
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=25, ge=1, le=100),
) -> dict:
    client = SleeperClient()
    players = await client.get_trending_players(
        add_drop=add_drop,
        hours=hours,
        limit=limit,
    )
    return {
        "source": "sleeper",
        "add_drop": add_drop,
        "hours": hours,
        "limit": limit,
        "count": len(players),
        "players": players,
    }


@app.get("/players/trending/from-databricks")
def get_trending_players_from_databricks() -> dict:
    return {
        "status": "not_implemented",
        "message": "Replace this stub with Databricks SQL or warehouse query integration.",
        "table": f"{settings.databricks_catalog}.{settings.databricks_schema}.silver_trending_players",
    }
