# Databricks notebook source
# /// script
# [tool.databricks.environment]
# environment_version = "2"
# ///
# DBTITLE 1,Ingestion Header
# MAGIC %md
# MAGIC # FantasAI Player Metadata Ingestion
# MAGIC
# MAGIC Pull player metadata from Sleeper and land it in bronze and silver Delta tables.
# MAGIC
# MAGIC **Updated June 9, 2026:** Now captures years_exp (rookie indicator), age, birth_date, college, and depth chart data from Sleeper API.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

# COMMAND ----------

# DBTITLE 1,API Data Parsing
players_response = requests.get(f"{SLEEPER_BASE_URL}/players/nfl", timeout=60)
players_response.raise_for_status()

players_payload = players_response.json()

# Sleeper returns a dictionary keyed by player_id
rows = []
for player_id, player in players_payload.items():
    rows.append(
        Row(
            player_id=str(player_id),
            full_name=player.get("full_name"),
            first_name=player.get("first_name"),
            last_name=player.get("last_name"),
            team=player.get("team"),
            position=player.get("position"),
            status=player.get("status"),
            sport=player.get("sport"),
            # NEW: Rookie and experience data
            years_exp=player.get("years_exp"),
            age=player.get("age"),
            birth_date=player.get("birth_date"),
            college=player.get("college"),
            # NEW: Depth chart data
            depth_chart_order=player.get("depth_chart_order"),
            depth_chart_position=player.get("depth_chart_position"),
            # NEW: Additional metadata
            height=player.get("height"),
            weight=player.get("weight"),
            injury_status=player.get("injury_status"),
            injury_notes=player.get("injury_notes"),
        )
    )

players_df = spark.createDataFrame(rows)

display(players_df)

# COMMAND ----------

# DBTITLE 1,Cell 4
bronze_players_df = players_df.withColumn("ingested_at", F.current_timestamp())

(
    bronze_players_df.write
    .format("delta")
    .mode("append")
    .option("mergeSchema", "true")  # Enable schema evolution
    .saveAsTable("main.fantasai.bronze_players")
)

# COMMAND ----------

# DBTITLE 1,Silver Layer Transformation
# Read from bronze table to get clean data types
bronze_df_clean = spark.table("main.fantasai.bronze_players")

silver_players_df = (
    bronze_df_clean
    .select(
        F.col("player_id").cast("string"),
        F.col("full_name").cast("string"),
        F.col("first_name").cast("string"),
        F.col("last_name").cast("string"),
        F.col("team").cast("string"),
        F.col("position").cast("string"),
        F.col("status").cast("string"),
        F.col("sport").cast("string"),
        # NEW: Experience and rookie data
        F.col("years_exp").cast("int"),
        F.col("age").cast("int"),
        F.col("birth_date").cast("string"),
        F.col("college").cast("string"),
        # NEW: Depth chart data
        F.col("depth_chart_order").cast("int"),
        F.col("depth_chart_position").cast("string"),
        # NEW: Physical attributes
        F.col("height").cast("string"),
        F.col("weight").cast("string"),  # Keep as string, varies in format
        # NEW: Injury data
        F.col("injury_status").cast("string"),
        F.col("injury_notes").cast("string"),
        F.col("ingested_at"),
    )
    .dropDuplicates(["player_id"])
)

display(silver_players_df)

# COMMAND ----------

# DBTITLE 1,Cell 6
(
    silver_players_df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")  # Overwrite schema with new columns
    .saveAsTable("main.fantasai.silver_players")
)
