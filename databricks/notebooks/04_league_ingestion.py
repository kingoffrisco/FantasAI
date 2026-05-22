# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI League Ingestion
# MAGIC
# MAGIC Pull league-level data from Sleeper and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

# Set this in the notebook before running
LEAGUE_ID = "YOUR_LEAGUE_ID"

# COMMAND ----------

league_response = requests.get(f"{SLEEPER_BASE_URL}/league/{LEAGUE_ID}", timeout=30)
league_response.raise_for_status()
league_payload = league_response.json()

league_df = spark.createDataFrame(
    [
        Row(
            league_id=str(league_payload.get("league_id")),
            name=league_payload.get("name"),
            season=str(league_payload.get("season")),
            sport=league_payload.get("sport"),
            status=league_payload.get("status"),
            total_rosters=league_payload.get("total_rosters"),
        )
    ]
)

display(league_df)

# COMMAND ----------

(
    league_df.withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_leagues")
)
