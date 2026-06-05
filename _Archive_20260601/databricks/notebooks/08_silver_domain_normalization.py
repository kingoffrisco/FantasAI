# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Silver Domain Normalization
# MAGIC
# MAGIC Normalize leagues, rosters, matchups, and news into silver Delta tables.

# COMMAND ----------

from pyspark.sql import functions as F

# COMMAND ----------

bronze_leagues_df = spark.table("main.fantasai.bronze_leagues")
silver_leagues_df = (
    bronze_leagues_df
    .select(
        F.col("league_id").cast("string"),
        F.col("name").cast("string"),
        F.col("season").cast("string"),
        F.col("sport").cast("string"),
        F.col("status").cast("string"),
        F.col("total_rosters").cast("int"),
        F.col("ingested_at"),
    )
    .dropDuplicates(["league_id"])
)

display(silver_leagues_df)

# COMMAND ----------

(
    silver_leagues_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_leagues")
)

# COMMAND ----------

bronze_rosters_df = spark.table("main.fantasai.bronze_rosters")
silver_rosters_df = (
    bronze_rosters_df
    .select(
        F.col("league_id").cast("string"),
        F.col("roster_id").cast("int"),
        F.col("owner_id").cast("string"),
        F.col("starters").cast("string"),
        F.col("players").cast("string"),
        F.col("reserve").cast("string"),
        F.col("ingested_at"),
    )
    .dropDuplicates(["league_id", "roster_id"])
)

display(silver_rosters_df)

# COMMAND ----------

(
    silver_rosters_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_rosters")
)

# COMMAND ----------

bronze_matchups_df = spark.table("main.fantasai.bronze_matchups")
silver_matchups_df = (
    bronze_matchups_df
    .select(
        F.col("league_id").cast("string"),
        F.col("week").cast("int"),
        F.col("roster_id").cast("int"),
        F.col("matchup_id").cast("int"),
        F.col("points").cast("double"),
        F.col("players").cast("string"),
        F.col("ingested_at"),
    )
    .dropDuplicates(["league_id", "week", "roster_id"])
)

display(silver_matchups_df)

# COMMAND ----------

(
    silver_matchups_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_matchups")
)

# COMMAND ----------

bronze_news_df = spark.table("main.fantasai.bronze_news")
silver_news_df = (
    bronze_news_df
    .select(
        F.col("news_id").cast("string"),
        F.col("player_id").cast("string"),
        F.col("title").cast("string"),
        F.col("summary").cast("string"),
        F.col("source").cast("string"),
        F.col("published_at").cast("string"),
        F.col("ingested_at"),
    )
    .dropDuplicates(["news_id"])
)

display(silver_news_df)

# COMMAND ----------

(
    silver_news_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("main.fantasai.silver_news")
)

