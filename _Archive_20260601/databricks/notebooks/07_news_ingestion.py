# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI News Ingestion
# MAGIC
# MAGIC Pull fantasy news from an external provider and land it in bronze Delta tables.

# COMMAND ----------

from pyspark.sql import Row
from pyspark.sql import functions as F

# Replace this stub with a real API call once your provider is chosen.
news_payload = [
    {
        "news_id": "demo-1",
        "player_id": "1234",
        "title": "Sample fantasy news headline",
        "summary": "Sample summary for player update.",
        "source": "demo",
        "published_at": "2026-05-22T00:00:00Z",
    }
]

rows = []
for item in news_payload:
    rows.append(
        Row(
            news_id=item.get("news_id"),
            player_id=item.get("player_id"),
            title=item.get("title"),
            summary=item.get("summary"),
            source=item.get("source"),
            published_at=item.get("published_at"),
        )
    )

news_df = spark.createDataFrame(rows)

display(news_df)

# COMMAND ----------

(
    news_df.withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_news")
)

