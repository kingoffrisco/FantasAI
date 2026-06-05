# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Roster Ingestion
# MAGIC
# MAGIC Pull roster data from FantasAI Cloudflare Worker API (CBS data source) and land it in bronze Delta tables.

# COMMAND ----------

import requests
from pyspark.sql import Row
from pyspark.sql import functions as F
import json

BASE_URL = "https://api.fantasai.net"
LEAGUE_ID = "atotauleague"  # Your league ID

# COMMAND ----------

# Fetch rosters from Cloudflare Worker API
from pyspark.sql.types import StructType, StructField, StringType, IntegerType

response = requests.get(f"{BASE_URL}/api/v1/rosters", timeout=30)
response.raise_for_status()
response_data = response.json()

print(f"Response type: {type(response_data)}")
print(f"Response keys: {list(response_data.keys())}")

# Extract rosters dictionary from response
rosters_dict = response_data.get('rosters', {})
print(f"\nRosters dict has {len(rosters_dict)} teams")

# Define explicit schema
schema = StructType([
    StructField("league_id", StringType(), True),
    StructField("roster_id", IntegerType(), True),
    StructField("owner_id", StringType(), True),
    StructField("starters", StringType(), True),
    StructField("players", StringType(), True),
    StructField("reserve", StringType(), True)
])

# Convert to DataFrame rows
rows = []
for team_id, roster_players in rosters_dict.items():
    print(f"Team {team_id}: {len(roster_players)} players")
    
    rows.append(
        Row(
            league_id=str(LEAGUE_ID),
            roster_id=int(team_id),
            owner_id=f"team_{team_id}",  # Placeholder - actual owner info may come from different endpoint
            starters=None,  # Not provided in current API response
            players=json.dumps(roster_players) if roster_players else "[]",
            reserve=None  # Not provided in current API response
        )
    )

print(f"\nCreated {len(rows)} roster rows")

if len(rows) > 0:
    roster_df = spark.createDataFrame(rows, schema=schema)
    display(roster_df)
else:
    print("No roster data to process")

# COMMAND ----------

(
    roster_df.withColumn("ingested_at", F.current_timestamp())
    .write
    .format("delta")
    .mode("append")
    .saveAsTable("main.fantasai.bronze_rosters")
)
