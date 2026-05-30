# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Roster Ingestion
# MAGIC
# MAGIC Pull roster data from Sleeper and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

# Set this in the notebook before running
LEAGUE_ID = "YOUR_LEAGUE_ID"

# COMMAND ----------

response = requests.get(f"{SLEEPER_BASE_URL}/league/{LEAGUE_ID}/rosters", timeout=30)
response.raise_for_status()
payload = response.json()

rows = []
for roster in payload:
    rows.append(
        Row(
            league_id=str(LEAGUE_ID),
            roster_id=roster.get("roster_id"),
            owner_id=roster.get("owner_id"),
            starters=",".join(roster.get("starters", [])) if roster.get("starters") else None,
            players=",".join(roster.get("players", [])) if roster.get("players") else None,
            reserve=",".join(roster.get("reserve", [])) if roster.get("reserve") else None,
        )
    )

roster_df = spark.createDataFrame(rows)

display(roster_df)

# COMMAND ----------

(
    roster_df.withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_rosters")
)
