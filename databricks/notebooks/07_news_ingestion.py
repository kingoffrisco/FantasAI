# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI News Ingestion — Sleeper API
# MAGIC
# MAGIC Fetches injury status and news text for active NFL players
# MAGIC from the Sleeper public API (free, no auth required).
# MAGIC
# MAGIC Source: https://api.sleeper.app/v1/players/nfl
# MAGIC Schedule: Tuesday / Thursday / Sunday (or daily during season)
# MAGIC
# MAGIC Writes to:
# MAGIC   - main.fantasai.bronze_player_injuries  (raw snapshot)
# MAGIC   - main.fantasai.silver_player_injuries  (normalized, deduplicated)
# MAGIC   - main.fantasai.gold_player_notes       (frontend-ready aggregation)

# COMMAND ----------

import requests
from datetime import datetime, timezone
from pyspark.sql import functions as F, Row

# Databricks runtime globals — injected by the cluster, not resolvable by
# static analysis. Declare stubs so linters stop flagging F821.
try:
    spark    # type: ignore[name-defined]  # noqa: F821
    display  # type: ignore[name-defined]  # noqa: F821
    dbutils  # type: ignore[name-defined]  # noqa: F821
except NameError:
    pass  # running outside Databricks (e.g. local unit tests)

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"

INJURY_STATUSES = {"Questionable", "Doubtful", "Out", "Injured_Reserve",
                   "Non_Football_Injury", "Practice_Squad"}

PRIORITY_MAP = {
    "Injured_Reserve":       "critical",
    "Non_Football_Injury":   "critical",
    "Out":                   "high",
    "Doubtful":              "high",
    "Questionable":          "medium",
    "Practice_Squad":        "low",
}

POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}

print(f"Fetching players from Sleeper: {SLEEPER_PLAYERS_URL}")
resp = requests.get(SLEEPER_PLAYERS_URL, timeout=60)
resp.raise_for_status()
all_players = resp.json()
print(f"  Total players returned: {len(all_players)}")

# COMMAND ----------

# Filter to active skill-position players with injury data or news
rows = []
ingested_at = datetime.now(timezone.utc)

for player_id, p in all_players.items():
    if p.get("sport") != "nfl":
        continue
    pos = p.get("position", "")
    if pos not in POSITIONS:
        continue
    if p.get("status") == "Inactive" and not p.get("injury_status") and not p.get("news"):
        continue

    injury_status = p.get("injury_status")    # Sleeper field name
    news_text     = p.get("news")             # latest news blurb

    # Only include if they have something meaningful to report
    if not injury_status and not news_text:
        continue

    full_name = p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip()
    rows.append(Row(
        player_id             = str(player_id),
        player_name           = full_name,
        position              = pos,
        team                  = p.get("team") or "",
        injury_status         = injury_status,
        injury_body_part      = p.get("injury_body_part"),
        injury_notes          = p.get("injury_notes"),
        practice_participation= p.get("practice_participation"),
        news_text             = news_text,
        ingested_at           = ingested_at,
    ))

print(f"  Players with injury/news data: {len(rows)}")

# COMMAND ----------

if not rows:
    print("No injury/news data found — skipping write.")
    dbutils.notebook.exit("no_data")

bronze_df = spark.createDataFrame(rows)
display(bronze_df.select("player_name", "position", "team", "injury_status",
                          "injury_body_part", "news_text").limit(20))

# COMMAND ----------

# Write to bronze (append — keeps history)
(
    bronze_df
    .write.format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_player_injuries")
)
print("  Wrote to main.fantasai.bronze_player_injuries")

# COMMAND ----------

# Silver: normalize and deduplicate, keeping latest record per player
silver_df = (
    bronze_df
    .withColumn("has_injury_concern", F.col("injury_status").isNotNull())
    .withColumn("is_critical",
        F.col("injury_status").isin("Injured_Reserve", "Non_Football_Injury", "Out"))
    .select(
        "player_id", "player_name", "position", "team",
        "injury_status", "injury_body_part", "injury_notes",
        "practice_participation", "news_text",
        "has_injury_concern", "is_critical", "ingested_at",
    )
)

(
    silver_df
    .write.format("delta")
    .mode("overwrite")          # latest snapshot only
    .option("overwriteSchema", "true")
    .saveAsTable("main.fantasai.silver_player_injuries")
)
print("  Wrote to main.fantasai.silver_player_injuries")

# COMMAND ----------

# Gold: shape for frontend player_notes format
# priority and impact_direction derived from injury_status

priority_expr = (
    F.when(F.col("injury_status") == "Injured_Reserve",     "critical")
     .when(F.col("injury_status") == "Non_Football_Injury", "critical")
     .when(F.col("injury_status") == "Out",                 "high")
     .when(F.col("injury_status") == "Doubtful",            "high")
     .when(F.col("injury_status") == "Questionable",        "medium")
     .otherwise("low")
)

impact_expr = (
    F.when(F.col("is_critical"), "negative")
     .when(F.col("has_injury_concern"), "negative")
     .otherwise("neutral")
)

impact_score_expr = (
    F.when(F.col("injury_status") == "Injured_Reserve",     1.0)
     .when(F.col("injury_status") == "Non_Football_Injury", 1.0)
     .when(F.col("injury_status") == "Out",                 0.85)
     .when(F.col("injury_status") == "Doubtful",            0.70)
     .when(F.col("injury_status") == "Questionable",        0.50)
     .otherwise(0.20)
)

note_text_expr = (
    F.when(
        F.col("injury_notes").isNotNull() & (F.col("injury_notes") != ""),
        F.concat_ws(" · ", F.col("injury_status"), F.col("injury_notes"))
    ).when(
        F.col("news_text").isNotNull() & (F.col("news_text") != ""),
        F.col("news_text")
    ).otherwise(
        F.concat(F.lit("Status: "), F.col("injury_status"))
    )
)

gold_df = (
    silver_df
    .withColumn("note_text",            note_text_expr)
    .withColumn("priority",             priority_expr)
    .withColumn("impact_direction",     impact_expr)
    .withColumn("overall_impact_score", impact_score_expr)
    .withColumn("published_at",         F.col("ingested_at").cast("string"))
    .withColumn("last_updated",         F.col("ingested_at").cast("string"))
    .select(
        "player_name", "position", "team",
        "has_injury_concern", "is_critical",
        F.col("is_critical").alias("has_critical_news"),
        "note_text", "priority", "impact_direction",
        "published_at", "last_updated", "overall_impact_score",
    )
    .orderBy(F.col("overall_impact_score").desc())
)

(
    gold_df
    .write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("main.fantasai.gold_player_notes")
)
print("  Wrote to main.fantasai.gold_player_notes")

# COMMAND ----------

# Summary
total     = bronze_df.count()
injured   = bronze_df.filter(F.col("injury_status").isNotNull()).count()
critical  = bronze_df.filter(
    F.col("injury_status").isin("Out","Injured_Reserve","Non_Football_Injury")).count()
has_news  = bronze_df.filter(
    F.col("news_text").isNotNull() & (F.col("news_text") != "")).count()

print(f"\n=== News Ingestion Summary ===")
print(f"  Total players with data : {total}")
print(f"  With injury status      : {injured}")
print(f"  Critical (Out/IR/NFI)   : {critical}")
print(f"  With news text          : {has_news}")
print(f"  Ingested at             : {ingested_at.isoformat()}")
