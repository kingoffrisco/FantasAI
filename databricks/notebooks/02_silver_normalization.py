# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Silver Normalization
# MAGIC
# MAGIC Normalize bronze fantasy data into analytics-friendly silver tables.

# COMMAND ----------

from pyspark.sql import functions as F

# COMMAND ----------

bronze_state_df = spark.table("main.fantasai.bronze_nfl_state")

silver_state_df = (
    bronze_state_df
    .select(
        F.col("season").cast("string").alias("season"),
        F.col("season_type").cast("string").alias("season_type"),
        F.col("week").cast("int").alias("week"),
        F.col("league_season").cast("string").alias("league_season"),
        F.col("ingested_at"),
    )
    .dropDuplicates()
)

display(silver_state_df)

# COMMAND ----------

(
    silver_state_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_nfl_state")
)

# COMMAND ----------

bronze_trending_df = spark.table("main.fantasai.bronze_trending_players")

silver_trending_df = (
    bronze_trending_df
    .select(
        F.col("player_id").cast("string").alias("player_id"),
        F.col("count").cast("int").alias("trend_count"),
        F.col("add_drop").cast("string").alias("add_drop"),
        F.col("lookback_hours").cast("int").alias("lookback_hours"),
        F.col("ingested_at"),
    )
    .dropDuplicates()
)

display(silver_trending_df)

# COMMAND ----------

(
    silver_trending_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_trending_players")
)
