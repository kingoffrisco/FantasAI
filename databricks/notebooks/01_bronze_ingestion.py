# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Bronze Ingestion
# MAGIC
# MAGIC Pull raw fantasy sports data from external APIs and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import functions as F

SLEEPER_BASE_URL = "https://api.sleeper.app/v1"

response = requests.get(f"{SLEEPER_BASE_URL}/state/nfl", timeout=30)
response.raise_for_status()

state_payload = response.json()
df = spark.createDataFrame([state_payload])

display(df)

# COMMAND ----------

(
    df.withColumn("ingested_at", F.current_timestamp())
      .write
      .format("delta")
      .mode("append")
      .saveAsTable("main.fantasai.bronze_nfl_state")
)
