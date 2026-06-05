# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI League Ingestion
# MAGIC
# MAGIC Pull league standings data from FantasAI Cloudflare Worker API (CBS data source) and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F

BASE_URL = "https://api.fantasai.net"

# COMMAND ----------

# Fetch league data from API
league_response = requests.get(f"{BASE_URL}/api/v1/league", timeout=30)
league_response.raise_for_status()
response_data = league_response.json()

# Extract league data from nested structure
league_data = response_data.get("league", response_data)

# Create DataFrame with league information
league_df = spark.createDataFrame(
    [
        Row(
            league_id=str(league_data.get("leagueId", "atotauleague")),
            name=league_data.get("name", "ATO Tau League"),
            season=str(league_data.get("season", 2026)),
            sport="nfl",
            status="active",
            total_rosters=int(league_data.get("leagueSize", 12)),
        )
    ]
).select(
    F.col("league_id"),
    F.col("name"),
    F.col("season"),
    F.col("sport"),
    F.col("status"),
    F.col("total_rosters").cast("int")  # Cast to int to match table schema
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
