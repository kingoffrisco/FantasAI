# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Matchups Ingestion
# MAGIC
# MAGIC Pull weekly matchup data from Sleeper and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

# Set these in the notebook before running
LEAGUE_ID = "YOUR_LEAGUE_ID"
WEEK = 1

# COMMAND ----------

response = requests.get(f"{SLEEPER_BASE_URL}/league/{LEAGUE_ID}/matchups/{WEEK}", timeout=30)
response.raise_for_status()
payload = response.json()

rows = []
for matchup in payload:
    rows.append(
        Row(
            league_id=str(LEAGUE_ID),
            week=int(WEEK),
            roster_id=matchup.get("roster_id"),
            matchup_id=matchup.get("matchup_id"),
            points=float(matchup.get("points")) if matchup.get("points") is not None else None,
            players=",".join(matchup.get("players", [])) if matchup.get("players") else None,
        )
    )

matchups_df = spark.createDataFrame(rows)

display(matchups_df)

# COMMAND ----------

(
    matchups_df.withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_matchups")
)
