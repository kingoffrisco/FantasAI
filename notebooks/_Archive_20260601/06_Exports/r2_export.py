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
# Source: main.fantasai.gold_enriched_news (full enriched articles with entity extraction)
# Fields: news_id, headline, source_name, source_url, full_text,
#         mentioned_players, mentioned_teams, extraction_confidence, published_at
print("2. enriched_news")
try:
    df = (
        spark.table("main.fantasai.gold_enriched_news")  # noqa: F821
        .orderBy(F.col("published_at").desc())
        .limit(200)
        .select(
            F.col("news_id"),
            F.col("headline"),
            F.col("source_name").alias("publisher"),
            F.col("source_url").alias("article_url"),
            F.col("full_text"),
            F.col("mentioned_players"),
            F.col("mentioned_teams"),
            F.coalesce(F.col("extraction_confidence"), F.lit(None)).alias("extraction_confidence"),
            "published_at",
        )
    )
    r2_put("fantasai/news/enriched_news.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"enriched_news: {e}")

# ── 2b. player_news ───────────────────────────────────────────────────────────
# Source: main.fantasai.export_player_news (combined player news — recommended for UI)
# Fields: news_id, headline, source_url, full_text, player_name, position, team,
#         summary_text, fantasy_insight, impact_score, published_at
# Records: ~1,075 articles (last 60 days)
print("2b. player_news")
try:
    df = (
        spark.table("main.fantasai.export_player_news")  # noqa: F821
        .orderBy(F.col("published_at").desc())
        .limit(1500)
        .select(
            F.col("news_id"),
            F.col("headline"),
            F.col("source_url").alias("article_url"),
            F.col("full_text"),
            F.col("player_name"),
            F.col("position"),
            F.col("team"),
            F.col("summary_text"),
            F.col("fantasy_insight"),
            F.coalesce(F.col("impact_score"), F.lit(None)).alias("impact_score"),
            "published_at",
        )
    )
    r2_put("fantasai/analysis/player_news.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"player_news: {e}")

# ── 2c. ai_summaries ──────────────────────────────────────────────────────────
# Source: main.fantasai.gold_news_ai_summaries (100 most recent AI-enriched summaries)
# Fields: summary_id, news_id, headline, summary_text, fantasy_insight,
#         fantasy_relevance_score, impact_category, priority_level,
#         impacted_players, is_time_sensitive, published_at
print("2c. ai_summaries")
try:
    df = (
        spark.table("main.fantasai.gold_news_ai_summaries")  # noqa: F821
        .orderBy(F.col("published_at").desc())
        .limit(100)
        .select(
            F.col("summary_id"),
            F.col("news_id"),
            F.col("headline"),
            F.col("summary_text"),
            F.col("fantasy_insight"),
            F.coalesce(F.col("fantasy_relevance_score"), F.lit(None)).alias("fantasy_relevance_score"),
            F.col("impact_category"),
            F.col("priority_level"),
            F.col("impacted_players"),
            F.coalesce(F.col("is_time_sensitive"), F.lit(False)).alias("is_time_sensitive"),
            "published_at",
        )
    )
    r2_put("fantasai/news/ai_summaries.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"ai_summaries: {e}")

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
# Source: main.fantasai.breakout_training_data (in-season snap data)
# Pre-season fallback: main.fantasai.players_2026_draft (projected opportunity)
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
    rows = to_records(df)

    # Pre-season fallback: no snap-delta data yet — use projected opportunity from draft table
    if len(rows) == 0:
        print("  ↩ No in-season snap data — falling back to players_2026_draft projections")
        df = (
            spark.table("main.fantasai.players_2026_draft")  # noqa: F821
            .filter(F.col("is_draftable") == True)           # noqa: E712
            .filter(F.col("position").isin("RB", "WR", "TE", "QB"))
            .filter(F.col("projected_avg_points") >= 8.0)
            .select(
                F.col("full_name").alias("player_name"),
                F.col("team"),
                F.col("position"),
                F.lit(None).cast("int").alias("week"),
                F.lit(2026).alias("season"),
                F.lit(None).cast("double").alias("snap_share_delta"),
                F.col("projected_avg_points").alias("opportunity_score"),
                F.lit(None).cast("double").alias("avg_snap_share"),
            )
            .orderBy(F.col("projected_avg_points").desc())
            .limit(30)
        )
        rows = to_records(df)

    r2_put("fantasai/analysis/breakout_candidates.json", rows)
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

# ── 7. players_2026_draft ────────────────────────────────────────────────────
# Source: main.fantasai.players_2026_draft
# Shape: normalized player records the frontend can consume directly.
# Filter: is_draftable = TRUE only (1,338 players after exclusions).
# Sort:   projected_avg_points DESC (ML-powered ranking).
print("7. players_2026_draft")
try:
    df = (
        spark.table("main.fantasai.players_2026_draft")  # noqa: F821
        .filter(F.col("is_draftable") == True)           # noqa: E712
        .select(
            F.col("master_player_id"),
            F.col("full_name").alias("full_name"),
            F.col("position"),
            F.col("team"),
            F.col("projected_avg_points"),
            F.col("position_rank"),
            F.col("season_tier"),
            F.col("player_status"),
            F.col("is_draftable"),
            # optional enrichment columns — coalesce so missing cols don't fail
            F.coalesce(F.col("age"),         F.lit(None)).alias("age"),
            F.coalesce(F.col("bye_week"),    F.lit(None)).alias("bye_week"),
            F.coalesce(F.col("adp"),         F.lit(None)).alias("adp"),
            F.coalesce(F.col("ecr"),         F.lit(None)).alias("ecr"),
            F.coalesce(F.col("headshot_url"),F.lit(None)).alias("headshot_url"),
        )
        .orderBy(F.col("projected_avg_points").desc())
    )
    rows = to_records(df)
    r2_put("fantasai/players/players_2026_draft.json", rows)
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"players_2026_draft: {e}")

# ── 8. sleeper_picks ─────────────────────────────────────────────────────────
# "Sleeper" = player drafted significantly later than expert ranking suggests.
# Definition: ADP > ECR + 8 — flying under the radar relative to projections.
# ownership_pct: derived from ADP using the same linear formula the live
#   worker uses for /api/v1/players  (MAX(0, 98 - adp * 0.31)).
# Source: main.fantasai.players_2026_draft
print("8. sleeper_picks")
try:
    df = spark.sql("""  -- noqa: F821
        SELECT
            full_name                                                 AS player_name,
            position,
            team,
            COALESCE(adp, 999)                                        AS adp,
            COALESCE(ecr, 999)                                        AS ecr,
            ROUND(COALESCE(adp, 999) - COALESCE(ecr, 999), 1)        AS value_gap,
            ROUND(projected_avg_points, 2)                            AS projected_avg_points,
            position_rank,
            season_tier,
            bye_week,
            -- Ownership derived from ADP (same formula as /api/v1/players worker):
            --   ADP ~1   → ~98%   ADP ~150 → ~51%   ADP ~300 → ~5%
            GREATEST(0.0, ROUND(98.0 - COALESCE(adp, 300) * 0.31, 1)) AS ownership_pct
        FROM main.fantasai.players_2026_draft
        WHERE is_draftable = TRUE
          AND projected_avg_points >= 6.0
          AND COALESCE(adp, 999) > COALESCE(ecr, 50) + 8
        ORDER BY value_gap DESC, projected_avg_points DESC
        LIMIT 30
    """)
    r2_put("fantasai/analysis/sleeper_picks.json", to_records(df))
except Exception as e:
    print(f"  ✗ {e}")
    errors.append(f"sleeper_picks: {e}")

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
