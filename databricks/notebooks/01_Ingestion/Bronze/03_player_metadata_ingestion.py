# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Player Metadata Ingestion
# MAGIC
# MAGIC Pull player metadata from Sleeper and land it in bronze and silver Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

# COMMAND ----------

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
        )
    )

players_df = spark.createDataFrame(rows)

display(players_df)

# COMMAND ----------

bronze_players_df = players_df.withColumn("ingested_at", F.current_timestamp())

(
    bronze_players_df.write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_players")
)

# COMMAND ----------

silver_players_df = (
    bronze_players_df
    .select(
        F.col("player_id").cast("string"),
        F.col("full_name").cast("string"),
        F.col("first_name").cast("string"),
        F.col("last_name").cast("string"),
        F.col("team").cast("string"),
        F.col("position").cast("string"),
        F.col("status").cast("string"),
        F.col("sport").cast("string"),
        F.col("ingested_at"),
    )
    .dropDuplicates(["player_id"])
)

display(silver_players_df)

# COMMAND ----------

(
    silver_players_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_players")
)