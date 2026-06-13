from fastapi import FastAPI, HTTPException, Query

from app.config import settings
from app.services.databricks_sql import DatabricksSQLClient
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
async def get_trending_players_from_databricks(
    limit: int = Query(default=25, ge=1, le=100),
) -> dict:
    if not settings.databricks_host or not settings.databricks_token or not settings.databricks_warehouse_id:
        raise HTTPException(
            status_code=500,
            detail="Databricks configuration is incomplete. Set DATABRICKS_HOST, DATABRICKS_TOKEN, and DATABRICKS_WAREHOUSE_ID.",
        )

    query = f"""
    SELECT player_id, player_name, position, team, value_score, projected_pts,
           ownership_pct, reason, matchup_grade
    FROM {settings.databricks_catalog}.{settings.databricks_schema}.export_sleeper_picks
    ORDER BY value_score DESC
    LIMIT {limit}
    """.strip()

    dbx_client = DatabricksSQLClient(
        host=settings.databricks_host,
        token=settings.databricks_token,
        warehouse_id=settings.databricks_warehouse_id,
    )

    try:
        result = await dbx_client.execute_query(query)
        rows = dbx_client.extract_rows(result)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Databricks query failed: {exc}") from exc

    return {
        "source": "databricks",
        "catalog": settings.databricks_catalog,
        "schema": settings.databricks_schema,
        "limit": limit,
        "count": len(rows),
        "players": rows,
        "raw_status": result.get("status", {}),
    }


@app.get("/recommendations/roster")
async def get_roster_recommendations(
    limit: int = Query(default=10, ge=1, le=50),
) -> dict:
    if not settings.databricks_host or not settings.databricks_token or not settings.databricks_warehouse_id:
        raise HTTPException(
            status_code=500,
            detail="Databricks configuration is incomplete. Set DATABRICKS_HOST, DATABRICKS_TOKEN, and DATABRICKS_WAREHOUSE_ID.",
        )

    query = f"""
    SELECT player_id, player_name, position, team, value_score, projected_pts,
           ownership_pct, reason, matchup_grade
    FROM {settings.databricks_catalog}.{settings.databricks_schema}.export_sleeper_picks
    ORDER BY value_score DESC
    LIMIT {limit}
    """.strip()

    dbx_client = DatabricksSQLClient(
        host=settings.databricks_host,
        token=settings.databricks_token,
        warehouse_id=settings.databricks_warehouse_id,
    )

    try:
        result = await dbx_client.execute_query(query)
        rows = dbx_client.extract_rows(result)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Recommendation query failed: {exc}") from exc

    return {
        "source": "databricks",
        "type": "roster_recommendations",
        "limit": limit,
        "count": len(rows),
        "recommendations": rows,
        "raw_status": result.get("status", {}),
    }
