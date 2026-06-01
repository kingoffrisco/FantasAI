# Databricks Notebook — FantasAI R2 Export Pipeline
# ---------------------------------------------------
# Reads from Delta tables in main.fantasai (single schema),
# shapes data for the frontend, then PUTs JSON to Cloudflare
# R2 via the Worker API.
#
# Schedule: every 15 minutes during the season via Databricks Jobs.
#
# Prerequisites:
#   Create a Databricks Secret scope named "fantasai" with key:
#     worker_api_key = <value of FANTASAI_KEY from Cloudflare env>
#   Cluster must have outbound internet access to api.fantasai.net.
# ---------------------------------------------------

import json
import requests
from datetime import datetime, timezone
from pyspark.sql import functions as F

# Databricks runtime globals
try:
    spark    # type: ignore[name-defined]  # noqa: F821
    dbutils  # type: ignore[name-defined]  # noqa: F821
except NameError:
    pass

WORKER_API = "https://api.fantasai.net"
API_KEY = dbutils.secrets.get(scope="fantasai", key="worker_api_key")  # noqa: F821
HEADERS = {
    "Content-Type": "application/json",
    "X-FantasAI-Key": API_KEY,
}

RUN_AT = datetime.now(timezone.utc).isoformat()
errors = []


# ── helpers ───────────────────────────────────────────────────────────────────

def r2_put(key, payload):
    """PUT a JSON payload to R2 via the Worker API."""
    url = f"{WORKER_API}/api/v1/r2/{key}"
    try:
        res = requests.put(
            url,
            data=json.dumps(payload, default=str),
            headers=HEADERS,
            timeout=30,
        )
        status = "✓" if res.ok else f"✗ HTTP {res.status_code}: {res.text[:200]}"
        print(f"  [{key}] {status}")
        if not res.ok:
            errors.append(f"{key}: HTTP {res.status_code}")
        return res.ok
    except Exception as e:
        print(f"  [{key}] ✗ {e}")
        errors.append(f"{key}: {e}")
        return False


def to_records(df, limit=None):
    """Convert a Spark DataFrame to a JSON-safe list of dicts."""
    if limit:
        df = df.limit(limit)
    return [row.asDict() for row in df.collect()]


def current_season_week():
    """Return (season, week) from the most recent breakout feature data."""
    try:
        row = spark.sql(  # noqa: F821
            "SELECT MAX(season) AS season, MAX(week) AS week"
            " FROM main.fantasai.weekly_usage_features"
        ).collect()[0]
        return int(row["season"]), int(row["week"])
    except Exception:
        return 2025, 1


print(f"=== FantasAI R2 Export  {RUN_AT} ===\n")

# ── 1. player_notes ───────────────────────────────────────────────────────────
# Source: main.fantasai.gold_player_notes  (written by 07_news_ingestion.py)
# Shape expected by frontend hooks.js → useR2PlayerNotes:
#   [{player_name, notes:[{note_text, priority, impact_direction, published_at}],
#     has_injury_concern, has_critical_news, last_updated, overall_impact_score}]
print("1. player_notes")
try:
    df = spark.table("main.fantasai.gold_player_notes")  # noqa: F821
    rows = to_records(df, limit=300)
    shaped = []
    for r in rows:
        shaped.append({
            "player_name": r.get("player_name"),
            "notes": [{
                "note_text":        r.get("note_text"),
                "priority":         r.get("priority"),
                "impact_direction": r.get("impact_direction"),
                "published_at":     r.get("published_at"),
            }],
            "has_injury_concern":   r.get("has_injury_concern", False),
            "has_critical_news":    r.get("has_critical_news", False),
            "last_updated":         r.get("last_updated"),
            "overall_impact_score": r.get("overall_impact_score", 0.0),
        })
    r2_put("fantasai/news/player_notes.json", shaped)
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"player_notes: {e}")

# ── 2. enriched_news ──────────────────────────────────────────────────────────
# Source: main.fantasai.silver_news
# Shape: [{headline, full_text, source_url, mentioned_players,
#           primary_player_id, published_at}]
print("2. enriched_news")
try:
    df = (
        spark.table("main.fantasai.silver_news")  # noqa: F821
        .orderBy(F.col("published_at").desc())
        .limit(200)
        .select(
            F.col("title").alias("headline"),
            F.col("summary").alias("full_text"),
            F.col("source").alias("source_url"),
            F.col("player_id").alias("primary_player_id"),
            "published_at",
        )
        .withColumn("mentioned_players", F.array())
    )
    r2_put("fantasai/news/enriched_news.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"enriched_news: {e}")

# ── 3. critical_alerts ────────────────────────────────────────────────────────
# Source: main.fantasai.silver_player_injuries filtered to critical/high
# Shape: [{summary_text, fantasy_insight, priority_level, impacted_players,
#           is_time_sensitive, generated_at}]
print("3. critical_alerts")
try:
    df = (
        spark.table("main.fantasai.silver_player_injuries")  # noqa: F821
        .filter(F.col("injury_status").isin(
            "Out", "Injured_Reserve", "Non_Football_Injury", "Doubtful"
        ))
        .orderBy(F.col("ingested_at").desc())
        .limit(50)
    )
    rows = to_records(df)
    shaped = []
    for r in rows:
        status = r.get("injury_status", "")
        notes = r.get("injury_notes") or r.get("news_text") or ""
        name = r.get("player_name", "")
        is_crit = status in ("Out", "Injured_Reserve", "Non_Football_Injury")
        shaped.append({
            "summary_text": f"{name} — {status}. {notes}".strip(". "),
            "fantasy_insight": (
                f"Consider dropping or replacing {name} on waivers."
                if is_crit else
                f"Monitor {name}'s practice status before locking lineup."
            ),
            "priority_level": "critical" if is_crit else "high",
            "is_time_sensitive": True,
            "impacted_players": [{"player_name": name}],
            "generated_at": r.get("ingested_at"),
        })
    r2_put("fantasai/news/critical_alerts.json", shaped)
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"critical_alerts: {e}")

# ── 4. injury_report ──────────────────────────────────────────────────────────
# Source: main.fantasai.silver_player_injuries (all statuses)
print("4. injury_report")
try:
    df = (
        spark.table("main.fantasai.silver_player_injuries")  # noqa: F821
        .select(
            F.col("player_name"),
            F.col("position"),
            F.col("team"),
            F.col("injury_status"),
            F.col("injury_body_part").alias("body_part"),
            F.col("injury_notes").alias("notes"),
            F.col("ingested_at").alias("updated_at"),
        )
        .orderBy("position", "player_name")
        .limit(300)
    )
    r2_put("fantasai/analysis/injury_report.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"injury_report: {e}")

# ── 5. breakout_candidates ────────────────────────────────────────────────────
# Source: main.fantasai.breakout_training_data
# Threshold: snap_share_delta > 10%, opportunity_score > 4
print("5. breakout_candidates")
try:
    season, week = current_season_week()
    df = (
        spark.table("main.fantasai.breakout_training_data")  # noqa: F821
        .filter(F.col("season") == season)
        .filter(F.col("week") >= week - 1)
        .filter(F.col("snap_share_delta") > 0.10)
        .filter(F.col("opportunity_score") > 4)
        .select(
            "player_name", "team", "position", "week", "season",
            "snap_share_delta", "opportunity_score",
            F.coalesce(
                F.col("avg_snap_share_prev_2wk"),
                F.col("avg_snap_share"),
            ).alias("avg_snap_share"),
        )
        .orderBy(
            F.col("snap_share_delta").desc(),
            F.col("opportunity_score").desc(),
        )
        .limit(30)
    )
    r2_put("fantasai/analysis/breakout_candidates.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"breakout_candidates: {e}")

# ── 6. waiver_wire_recommendations ───────────────────────────────────────────
# Composite score: snap delta 35%, opportunity 30%, avg snap 20%, targets 15%
print("6. waiver_wire_recommendations")
try:
    season, week = current_season_week()
    df = spark.sql(f"""  # noqa: F821
        SELECT
            player_name,
            team,
            position,
            week,
            season,
            snap_share_delta,
            opportunity_score,
            COALESCE(avg_snap_share_prev_2wk, avg_snap_share, 0)
                AS avg_snap_share,
            COALESCE(target_share_delta, 0) AS target_share_delta,
            ROUND(
                snap_share_delta                                      * 0.35
              + (opportunity_score / 15.0)                           * 0.30
              + COALESCE(avg_snap_share_prev_2wk, avg_snap_share, 0) * 0.20
              + COALESCE(target_share_delta, 0)                      * 0.15
            , 4) AS waiver_score
        FROM main.fantasai.breakout_training_data
        WHERE season = {season}
          AND week   = {week}
          AND snap_share_delta > 0.08
        ORDER BY waiver_score DESC
        LIMIT 25
    """)
    r2_put(
        "fantasai/analysis/waiver_wire_recommendations.json",
        to_records(df),
    )
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"waiver_wire: {e}")

# ── summary ───────────────────────────────────────────────────────────────────
print(f"\n=== Export complete — {len(errors)} error(s) ===")
if errors:
    for err in errors:
        print(f"  • {err}")
    raise Exception(
        f"R2 export finished with {len(errors)} error(s) — see above"
    )
else:
    print("  All tables exported successfully.")
