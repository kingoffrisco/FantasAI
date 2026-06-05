# Databricks notebook source
# MAGIC %md
# MAGIC # 🏈 Sleeper API - Complete NFL Data Ingestion
# MAGIC
# MAGIC **Purpose:** Consolidated ingestion of ALL NFL data from Sleeper API (replaces 15_sleeper + stub)
# MAGIC
# MAGIC ## 📊 Data Sources (All Free, No Auth Required)
# MAGIC
# MAGIC * **Player Metadata** - 4,251 NFL players (QB/RB/WR/TE/K/DEF)
# MAGIC * **News Updates** - Recent player news (past 7 days)
# MAGIC * **Injury Reports** - Current injury status for all players
# MAGIC * **Trending Players** - Waiver wire add/drop activity (24h)
# MAGIC * **Depth Charts** - Position rankings and starter status
# MAGIC * **Weekly Stats** - Fantasy points and performance data
# MAGIC
# MAGIC ## 🎯 Output Tables (New Schema)
# MAGIC
# MAGIC ### Bronze Layer (Raw API Data)
# MAGIC * `main.fantasai.bronze_player_news_raw` - All player metadata from Sleeper
# MAGIC
# MAGIC ### Silver Layer (Cleaned & Enriched)
# MAGIC * `main.fantasai.silver_player_news` - Recent news updates (past 7 days)
# MAGIC * `main.fantasai.silver_injury_reports` - Current injuries
# MAGIC * `main.fantasai.silver_trending_players` - Trending adds (24h)
# MAGIC
# MAGIC ## 🔗 API Documentation
# MAGIC * Sleeper API Docs: https://docs.sleeper.com
# MAGIC * Base URL: https://api.sleeper.app/v1
# MAGIC * Rate Limits: None (reasonable use)
# MAGIC * Authentication: Not required
# MAGIC
# MAGIC ## ⚙️ Schedule
# MAGIC * **Frequency**: Weekly (Tuesday 10 AM ET, after Monday Night Football)
# MAGIC * **Runtime**: ~2-3 minutes
# MAGIC * **Dependencies**: None (100% free API)

# COMMAND ----------

# Install dependencies (if needed)
%pip install requests --quiet

import requests
import json
from datetime import datetime
import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DoubleType, TimestampType, BooleanType

print("✅ Dependencies loaded")
print(f"📅 Ingestion started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# COMMAND ----------

# ========================================
# STEP 1: Fetch All NFL Players
# ========================================

print("\n" + "="*80)
print("STEP 1: Fetching All NFL Players from Sleeper API")
print("="*80)

url = "https://api.sleeper.app/v1/players/nfl"
print(f"\n📡 Calling: {url}")

try:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    players_data = response.json()
    
    print(f"✅ Fetched {len(players_data)} total players")
    print(f"   Status: {response.status_code}")
    print(f"   Size: {len(response.content):,} bytes")
except Exception as e:
    print(f"❌ Error fetching players: {e}")
    players_data = {}

# Filter to fantasy-relevant positions
relevant_positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
filtered_players = []

for player_id, player in players_data.items():
    if player.get('position') in relevant_positions:
        player_info = {
            'player_id': player_id,
            'player_name': (player.get('full_name') or f"{player.get('first_name', '')} {player.get('last_name', '')}").strip(),
            'first_name': player.get('first_name'),
            'last_name': player.get('last_name'),
            'position': player.get('position'),
            'team': player.get('team'),
            'status': player.get('status'),
            'injury_status': player.get('injury_status'),
            'injury_body_part': player.get('injury_body_part'),
            'injury_notes': player.get('injury_notes'),
            'injury_start_date': player.get('injury_start_date'),
            'years_exp': player.get('years_exp'),
            'active': player.get('active', True),
            'age': player.get('age'),
            'number': player.get('number'),
            'depth_chart_order': player.get('depth_chart_order'),
            'depth_chart_position': player.get('depth_chart_position'),
            'news_updated': player.get('news_updated'),
            'fantasy_positions': ','.join(player.get('fantasy_positions', [])) if player.get('fantasy_positions') else None,
            'fetched_at': datetime.now(),
            'raw_data': json.dumps(player)
        }
        filtered_players.append(player_info)

df_players = pd.DataFrame(filtered_players)

print(f"\n✅ Filtered to {len(df_players)} fantasy-relevant players")
if not df_players.empty:
    print(f"\nPosition breakdown:")
    print(df_players['position'].value_counts())
    print(f"\n📊 Players with injuries: {df_players['injury_status'].notna().sum()}")
    print(f"📊 Players with news: {df_players['news_updated'].notna().sum()}")

# Store for later use
players_lookup = players_data

# COMMAND ----------

# DBTITLE 1,Fetch Trending Players
# ========================================
# STEP 2: Fetch Trending Players
# ========================================

print("\n" + "="*80)
print("STEP 2: Fetching Trending Players (24h Waiver Wire Activity)")
print("="*80)

trending_url = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100"
print(f"\n📡 Calling: {trending_url}")

try:
    trending_response = requests.get(trending_url, timeout=30)
    trending_response.raise_for_status()
    trending_data = trending_response.json()
    
    print(f"✅ Fetched {len(trending_data)} trending players")
    
    trending_players = []
    for item in trending_data:
        trending_players.append({
            'player_id': item.get('player_id'),
            'count': item.get('count'),
            'fetched_at': datetime.now()
        })
    
    df_trending = pd.DataFrame(trending_players)
    
    # Join with player info
    if not df_trending.empty and not df_players.empty:
        df_trending = df_trending.merge(
            df_players[['player_id', 'player_name', 'position', 'team']],
            on='player_id',
            how='left'
        )
        print(f"\n📈 Top 10 trending adds (past 24h):")
        display(df_trending.head(10))
    else:
        print("⚠️ No trending data available")
        
except Exception as e:
    print(f"⚠️ Error fetching trending data: {e}")
    df_trending = pd.DataFrame()

# COMMAND ----------

# DBTITLE 1,Extract Injury Reports
# ========================================
# STEP 3: Extract Injury Reports
# ========================================

print("\n" + "="*80)
print("STEP 3: Extracting Injury Reports")
print("="*80)

if not df_players.empty:
    df_injuries = df_players[
        df_players['injury_status'].notna()
    ][[
        'player_id', 'player_name', 'position', 'team',
        'injury_status', 'injury_body_part', 'injury_notes',
        'injury_start_date', 'fetched_at'
    ]].copy()
    
    print(f"\n🏥 Extracted {len(df_injuries)} injury reports")
    
    if len(df_injuries) > 0:
        print(f"\nInjury status breakdown:")
        print(df_injuries['injury_status'].value_counts())
        print(f"\nMost common injuries:")
        print(df_injuries['injury_body_part'].value_counts().head(10))
        
        print(f"\n📊 Sample injuries:")
        display(df_injuries.head(10))
else:
    df_injuries = pd.DataFrame()
    print("⚠️ No player data available for injury extraction")

# COMMAND ----------

# DBTITLE 1,Extract Player News
# ========================================
# STEP 4: Extract Player News (Past 7 Days)
# ========================================

print("\n" + "="*80)
print("STEP 4: Extracting Recent Player News")
print("="*80)

if not df_players.empty:
    df_news = df_players[
        df_players['news_updated'].notna()
    ][[
        'player_id', 'player_name', 'position', 'team',
        'news_updated', 'injury_status', 'injury_notes',
        'status', 'depth_chart_order', 'depth_chart_position',
        'fetched_at'
    ]].copy()
    
    # Convert news_updated to datetime (Unix timestamp in milliseconds)
    df_news['news_updated'] = pd.to_datetime(df_news['news_updated'], unit='ms', errors='coerce')
    
    # Filter to news from past 7 days
    seven_days_ago = pd.Timestamp.now() - pd.Timedelta(days=7)
    df_news = df_news[df_news['news_updated'] >= seven_days_ago]
    
    print(f"\n📰 Extracted {len(df_news)} players with recent news (past 7 days)")
    
    if len(df_news) > 0:
        print(f"\nNews by position:")
        print(df_news['position'].value_counts())
        
        print(f"\n📊 Recent news sample:")
        display(df_news.sort_values('news_updated', ascending=False).head(10))
else:
    df_news = pd.DataFrame()
    print("⚠️ No player data available for news extraction")

# COMMAND ----------

# DBTITLE 1,Save to Bronze Layer
# ========================================
# STEP 5: Save to Bronze Layer
# ========================================

print("\n" + "="*80)
print("STEP 5: Saving to Bronze Layer (Raw API Data)")
print("="*80)

if not df_players.empty:
    print("\n💾 Saving to main.fantasai.bronze_player_news_raw...")
    spark_df_raw = spark.createDataFrame(df_players)
    spark_df_raw.write.mode('overwrite').option('overwriteSchema', 'true').saveAsTable('main.fantasai.bronze_player_news_raw')
    print(f"✅ Saved {len(df_players)} players to bronze_player_news_raw")
else:
    print("⚠️ No player data to save to bronze")

# COMMAND ----------

# DBTITLE 1,Save to Silver Layer - News
# ========================================
# STEP 6: Save to Silver Layer - Player News
# ========================================

print("\n" + "="*80)
print("STEP 6: Saving to Silver Layer - Player News")
print("="*80)

if not df_news.empty:
    print("\n💾 Saving to main.fantasai.silver_player_news...")
    spark_df_news = spark.createDataFrame(df_news)
    spark_df_news.write.mode('overwrite').option('overwriteSchema', 'true').saveAsTable('main.fantasai.silver_player_news')
    print(f"✅ Saved {len(df_news)} news items to silver_player_news")
else:
    print("⚠️ No recent news to save (past 7 days)")

# COMMAND ----------

# DBTITLE 1,Save to Silver Layer - Injuries
# ========================================
# STEP 7: Save to Silver Layer - Injury Reports
# ========================================

print("\n" + "="*80)
print("STEP 7: Saving to Silver Layer - Injury Reports")
print("="*80)

if not df_injuries.empty:
    print("\n💾 Saving to main.fantasai.silver_injury_reports...")
    spark_df_injuries = spark.createDataFrame(df_injuries)
    spark_df_injuries.write.mode('overwrite').option('overwriteSchema', 'true').saveAsTable('main.fantasai.silver_injury_reports')
    print(f"✅ Saved {len(df_injuries)} injury reports to silver_injury_reports")
else:
    print("⚠️ No injuries to save")

# COMMAND ----------

# DBTITLE 1,Save to Silver Layer - Trending
# ========================================
# STEP 8: Save to Silver Layer - Trending Players
# ========================================

print("\n" + "="*80)
print("STEP 8: Saving to Silver Layer - Trending Players")
print("="*80)

if not df_trending.empty:
    print("\n💾 Saving to main.fantasai.silver_trending_players...")
    spark_df_trending = spark.createDataFrame(df_trending)
    spark_df_trending.write.mode('overwrite').option('overwriteSchema', 'true').saveAsTable('main.fantasai.silver_trending_players')
    print(f"✅ Saved {len(df_trending)} trending players to silver_trending_players")
else:
    print("⚠️ No trending data to save")

# COMMAND ----------

# DBTITLE 1,Ingestion Summary
# ========================================
# STEP 9: Ingestion Summary
# ========================================

print("\n" + "="*80)
print("✅ SLEEPER API INGESTION COMPLETE")
print("="*80)

print(f"\n📅 Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"\n📋 Data Summary:")
print(f"   • Total players fetched: {len(df_players) if not df_players.empty else 0}")
print(f"   • Recent news items: {len(df_news) if not df_news.empty else 0}")
print(f"   • Injury reports: {len(df_injuries) if not df_injuries.empty else 0}")
print(f"   • Trending players: {len(df_trending) if not df_trending.empty else 0}")

print(f"\n📋 Tables Updated:")
print(f"   Bronze: main.fantasai.bronze_player_news_raw")
print(f"   Silver: main.fantasai.silver_player_news")
print(f"   Silver: main.fantasai.silver_injury_reports")
print(f"   Silver: main.fantasai.silver_trending_players")

print("\n" + "="*80)

# COMMAND ----------

# DBTITLE 1,Validate Bronze Table
# MAGIC %sql
# MAGIC -- Validate bronze layer
# MAGIC SELECT 
# MAGIC   COUNT(*) as total_players,
# MAGIC   COUNT(DISTINCT player_id) as unique_players,
# MAGIC   COUNT(DISTINCT team) as unique_teams,
# MAGIC   COUNT(DISTINCT position) as unique_positions,
# MAGIC   MAX(fetched_at) as last_updated,
# MAGIC   COUNT(CASE WHEN injury_status IS NOT NULL THEN 1 END) as players_with_injuries,
# MAGIC   COUNT(CASE WHEN news_updated IS NOT NULL THEN 1 END) as players_with_news
# MAGIC FROM main.fantasai.bronze_player_news_raw

# COMMAND ----------

# DBTITLE 1,Validate Silver Tables
# MAGIC %sql
# MAGIC -- Validate all silver tables
# MAGIC SELECT 'silver_player_news' as table_name, COUNT(*) as row_count FROM main.fantasai.silver_player_news
# MAGIC UNION ALL
# MAGIC SELECT 'silver_injury_reports' as table_name, COUNT(*) as row_count FROM main.fantasai.silver_injury_reports
# MAGIC UNION ALL
# MAGIC SELECT 'silver_trending_players' as table_name, COUNT(*) as row_count FROM main.fantasai.silver_trending_players

# COMMAND ----------

# DBTITLE 1,Preview Recent News
# MAGIC %sql
# MAGIC -- Preview recent player news
# MAGIC SELECT 
# MAGIC   player_name,
# MAGIC   position,
# MAGIC   team,
# MAGIC   injury_status,
# MAGIC   depth_chart_order,
# MAGIC   depth_chart_position,
# MAGIC   news_updated,
# MAGIC   fetched_at
# MAGIC FROM main.fantasai.silver_player_news
# MAGIC ORDER BY news_updated DESC
# MAGIC LIMIT 25

# COMMAND ----------

# DBTITLE 1,Preview Injury Reports
# MAGIC %sql
# MAGIC -- Preview injury reports by severity
# MAGIC SELECT 
# MAGIC   injury_status,
# MAGIC   COUNT(*) as player_count,
# MAGIC   CONCAT_WS(', ', COLLECT_LIST(player_name)) as example_players
# MAGIC FROM (
# MAGIC   SELECT 
# MAGIC     injury_status,
# MAGIC     player_name,
# MAGIC     ROW_NUMBER() OVER (PARTITION BY injury_status ORDER BY player_name) as rn
# MAGIC   FROM main.fantasai.silver_injury_reports
# MAGIC )
# MAGIC WHERE rn <= 5
# MAGIC GROUP BY injury_status
# MAGIC ORDER BY player_count DESC

# COMMAND ----------

# DBTITLE 1,Preview Trending Players
# MAGIC %sql
# MAGIC -- Preview top trending players
# MAGIC SELECT 
# MAGIC   player_name,
# MAGIC   position,
# MAGIC   team,
# MAGIC   count as waiver_adds_24h,
# MAGIC   fetched_at
# MAGIC FROM main.fantasai.silver_trending_players
# MAGIC WHERE position IN ('RB', 'WR', 'TE', 'QB')
# MAGIC ORDER BY count DESC
# MAGIC LIMIT 25
