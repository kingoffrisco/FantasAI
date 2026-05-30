# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Bronze Ingestion
# MAGIC
# MAGIC Pull raw fantasy sports data from external APIs and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

# COMMAND ----------

state_response = requests.get(f"{SLEEPER_BASE_URL}/state/nfl", timeout=30)
state_response.raise_for_status()

state_payload = state_response.json()
state_df = spark.createDataFrame([state_payload])

display(state_df)

# COMMAND ----------

(
    state_df.withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_nfl_state")
)

# COMMAND ----------

add_drop = "add"
lookback_hours = 24
limit = 50

trending_response = requests.get(
    f"{SLEEPER_BASE_URL}/players/nfl/trending/{add_drop}",
    params={"lookback_hours": lookback_hours, "limit": limit},
    timeout=30,
)
trending_response.raise_for_status()

trending_payload = trending_response.json()
trending_df = spark.createDataFrame(trending_payload)

display(trending_df)

# COMMAND ----------

(
    trending_df.withColumn("add_drop", F.lit(add_drop))
    .withColumn("lookback_hours", F.lit(lookback_hours))
    .withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_trending_players")
)
