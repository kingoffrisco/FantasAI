# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Silver Normalization
# MAGIC
# MAGIC Normalize bronze fantasy data into analytics-friendly silver tables.

# COMMAND ----------

from pyspark.sql import functions as F

bronze_df = spark.table("main.fantasai.bronze_nfl_state")

silver_df = (
    bronze_df
    .select(
        F.col("season").cast("string").alias("season"),
        F.col("season_type").cast("string").alias("season_type"),
        F.col("week").cast("int").alias("week"),
        F.col("league_season").cast("string").alias("league_season"),
        F.col("ingested_at"),
    )
    .dropDuplicates()
)

display(silver_df)

# COMMAND ----------

(
    silver_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_nfl_state")
)
