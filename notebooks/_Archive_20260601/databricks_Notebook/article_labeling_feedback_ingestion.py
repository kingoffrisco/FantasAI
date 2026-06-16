# Databricks notebook source
# MAGIC %md
# MAGIC # Article Labeling Feedback - Bronze Ingestion
# MAGIC 
# MAGIC **Purpose:** Ingest human-labeled article feedback from R2 for model training
# MAGIC 
# MAGIC **Source:** `fantasai-r2/fantasai/labeling/article_labels.json`
# MAGIC 
# MAGIC **Target Table:** `main.fantasai.bronze_article_labels`
# MAGIC 
# MAGIC **Schedule:** Hourly (when new labels are added)
# MAGIC 
# MAGIC **Key Use Cases:**
# MAGIC - Training data for player name extraction model
# MAGIC - Identifying systematic pipeline errors
# MAGIC - Measuring model accuracy over time

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration

# COMMAND ----------

import json
from pyspark.sql import functions as F
from pyspark.sql.types import *
from datetime import datetime

# R2 Configuration
R2_BUCKET = "fantasai-r2"
R2_KEY = "fantasai/labeling/article_labels.json"
R2_MOUNT = "/mnt/r2"

# Target table
TARGET_TABLE = "main.fantasai.bronze_article_labels"

# Mode: INCREMENTAL or FULL_REFRESH
MODE = "INCREMENTAL"

print(f"⚙️ Configuration")
print(f"  Source: {R2_BUCKET}/{R2_KEY}")
print(f"  Target: {TARGET_TABLE}")
print(f"  Mode: {MODE}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Read from R2

# COMMAND ----------

# Read JSON from R2
try:
    labels_json = dbutils.fs.head(f"{R2_MOUNT}/{R2_KEY}")
    labels = json.loads(labels_json)
    
    print(f"✅ Successfully read {len(labels)} labels from R2")
    
    # Display sample
    if labels:
        print(f"\n📋 Sample label (first record):")
        for key, value in list(labels[0].items())[:8]:
            print(f"  {key}: {value}")
            
except Exception as e:
    print(f"❌ Failed to read from R2: {str(e)}")
    raise

# COMMAND ----------

# MAGIC %md
# MAGIC ## Define Schema

# COMMAND ----------

# Define explicit schema for labels
label_schema = StructType([
    StructField("label_id", StringType(), False),
    StructField("article_url", StringType(), False),
    StructField("headline", StringType(), True),
    StructField("publisher", StringType(), True),
    StructField("published_at", StringType(), True),
    StructField("original_player_name", StringType(), True),
    StructField("original_position", StringType(), True),
    StructField("original_team", StringType(), True),
    StructField("labeled_player_name", StringType(), False),
    StructField("labeled_position", StringType(), False),
    StructField("labeled_team", StringType(), False),
    StructField("player_sleeper_id", StringType(), True),
    StructField("impact_category", StringType(), True),
    StructField("impact_direction", StringType(), True),
    StructField("relevance_score", IntegerType(), True),
    StructField("is_relevant", BooleanType(), True),
    StructField("notes", StringType(), True),
    StructField("labeled_by", StringType(), True),
    StructField("labeled_at", StringType(), True),
    StructField("label_source", StringType(), True),
])

# COMMAND ----------

# MAGIC %md
# MAGIC ## Create DataFrame

# COMMAND ----------

# Create DataFrame from labels
df = spark.createDataFrame(labels, schema=label_schema)

# Add ingestion metadata
df = df.withColumn("ingested_at", F.current_timestamp())
df = df.withColumn("ingestion_source", F.lit("r2"))

# Convert string timestamps to proper timestamps
df = df.withColumn("published_at_ts", F.to_timestamp("published_at"))
df = df.withColumn("labeled_at_ts", F.to_timestamp("labeled_at"))

print(f"📊 DataFrame created with {df.count()} records")
print(f"\n📋 Schema:")
df.printSchema()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Data Quality Checks

# COMMAND ----------

print("🔍 Data Quality Checks")
print("=" * 60)

# Check 1: Required fields present
null_counts = df.select([
    F.sum(F.when(F.col("label_id").isNull(), 1).otherwise(0)).alias("null_label_id"),
    F.sum(F.when(F.col("article_url").isNull(), 1).otherwise(0)).alias("null_article_url"),
    F.sum(F.when(F.col("labeled_player_name").isNull(), 1).otherwise(0)).alias("null_labeled_player_name"),
]).collect()[0]

print(f"  Null label_id: {null_counts.null_label_id}")
print(f"  Null article_url: {null_counts.null_article_url}")
print(f"  Null labeled_player_name: {null_counts.null_labeled_player_name}")

# Check 2: Relevance distribution
relevance_dist = df.groupBy("is_relevant").count().orderBy("is_relevant")
print(f"\n  Relevance Distribution:")
for row in relevance_dist.collect():
    print(f"    is_relevant={row.is_relevant}: {row['count']} records")

# Check 3: Correction rate (where labels differ from original)
corrections = df.filter(
    (F.col("original_player_name") != F.col("labeled_player_name")) |
    (F.col("original_position") != F.col("labeled_position"))
).count()

total = df.count()
correction_rate = (corrections / total * 100) if total > 0 else 0

print(f"\n  Corrections: {corrections}/{total} ({correction_rate:.1f}%)")
print(f"    These are valuable training examples!")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Sample Data Display

# COMMAND ----------

print("📄 Sample Labels (5 records):")
display(df.select(
    "label_id",
    "headline",
    "original_player_name",
    "labeled_player_name",
    "labeled_position",
    "impact_category",
    "relevance_score",
    "is_relevant",
    "labeled_at"
).limit(5))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Write to Bronze Table

# COMMAND ----------

if MODE == "INCREMENTAL":
    # Merge new labels (dedup by label_id)
    print("📝 Writing in INCREMENTAL mode (MERGE)")
    
    # Check if table exists
    table_exists = spark.catalog.tableExists(TARGET_TABLE)
    
    if table_exists:
        # Merge logic: Update existing labels or insert new ones
        df.createOrReplaceTempView("new_labels")
        
        merge_sql = f"""
        MERGE INTO {TARGET_TABLE} target
        USING new_labels source
        ON target.label_id = source.label_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
        
        spark.sql(merge_sql)
        print(f"✅ Merged {df.count()} labels into {TARGET_TABLE}")
        
    else:
        # First time - create table
        print(f"ℹ️ Table does not exist. Creating {TARGET_TABLE}")
        df.write.mode("overwrite").saveAsTable(TARGET_TABLE)
        print(f"✅ Created {TARGET_TABLE} with {df.count()} records")
        
else:
    # Full refresh
    print("📝 Writing in FULL_REFRESH mode (OVERWRITE)")
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(TARGET_TABLE)
    print(f"✅ Wrote {df.count()} records to {TARGET_TABLE}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verification

# COMMAND ----------

# Verify write
result = spark.sql(f"SELECT COUNT(*) as total FROM {TARGET_TABLE}").collect()[0]
print(f"✅ Verification: {TARGET_TABLE} contains {result.total} records")

# Show most recent labels
print(f"\n📋 Most recent 10 labels:")
spark.sql(f"""
SELECT 
    labeled_at,
    headline,
    labeled_player_name,
    labeled_position,
    impact_category,
    relevance_score
FROM {TARGET_TABLE}
ORDER BY labeled_at DESC
LIMIT 10
""").show(truncate=False)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary

# COMMAND ----------

summary = spark.sql(f"""
SELECT 
    COUNT(*) as total_labels,
    SUM(CASE WHEN is_relevant THEN 1 ELSE 0 END) as relevant_labels,
    SUM(CASE WHEN original_player_name != labeled_player_name THEN 1 ELSE 0 END) as player_corrections,
    SUM(CASE WHEN original_position != labeled_position THEN 1 ELSE 0 END) as position_corrections,
    COUNT(DISTINCT labeled_by) as unique_labelers,
    MIN(labeled_at_ts) as first_label_date,
    MAX(labeled_at_ts) as last_label_date
FROM {TARGET_TABLE}
""").collect()[0]

print("=" * 60)
print("📊 BRONZE ARTICLE LABELS SUMMARY")
print("=" * 60)
print(f"  Total Labels: {summary.total_labels}")
print(f"  Relevant Labels: {summary.relevant_labels}")
print(f"  Player Corrections: {summary.player_corrections}")
print(f"  Position Corrections: {summary.position_corrections}")
print(f"  Unique Labelers: {summary.unique_labelers}")
print(f"  First Label: {summary.first_label_date}")
print(f"  Last Label: {summary.last_label_date}")
print("=" * 60)


