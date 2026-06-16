# Databricks notebook source
# MAGIC %md
# MAGIC # Gold Player Mapping Corrections
# MAGIC 
# MAGIC **Purpose:** Extract high-quality training data for player name extraction model
# MAGIC 
# MAGIC **Source:** `main.fantasai.bronze_article_labels`
# MAGIC 
# MAGIC **Target Table:** `main.fantasai.gold_player_mapping_corrections`
# MAGIC 
# MAGIC **Use Case:** Train ML model to correctly extract player names from article text
# MAGIC 
# MAGIC **Filters Applied:**
# MAGIC - Only fantasy-relevant articles (is_relevant = true)
# MAGIC - Minimum relevance score >= 3
# MAGIC - Where original != labeled (actual corrections)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.types import *

SOURCE_TABLE = "main.fantasai.bronze_article_labels"
TARGET_TABLE = "main.fantasai.gold_player_mapping_corrections"

# Quality filters
MIN_RELEVANCE_SCORE = 3
REQUIRE_RELEVANT = True

print(f"⚙️ Configuration")
print(f"  Source: {SOURCE_TABLE}")
print(f"  Target: {TARGET_TABLE}")
print(f"  Min Relevance Score: {MIN_RELEVANCE_SCORE}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Load and Filter for Corrections

# COMMAND ----------

bronze_df = spark.table(SOURCE_TABLE)

corrections_df = bronze_df.filter(
    (F.col("is_relevant") == True) &
    (F.col("relevance_score") >= MIN_RELEVANCE_SCORE) &
    (
        (F.col("original_player_name") != F.col("labeled_player_name")) |
        (F.col("original_position") != F.col("labeled_position")) |
        (F.col("original_team") != F.col("labeled_team"))
    )
)

print(f"✅ Found {corrections_df.count()} corrections")

# COMMAND ----------

# Create gold table with correction flags
gold_df = corrections_df.select(
    "label_id", "article_url", "headline", "publisher",
    F.col("published_at_ts").alias("published_at"),
    "original_player_name", "original_position", "original_team",
    "labeled_player_name", "labeled_position", "labeled_team",
    "player_sleeper_id", "impact_category", "relevance_score"
).withColumn("processed_at", F.current_timestamp())

# Write to gold
gold_df.write.mode("overwrite").saveAsTable(TARGET_TABLE)
print(f"✅ Wrote {gold_df.count()} corrections to {TARGET_TABLE}")


