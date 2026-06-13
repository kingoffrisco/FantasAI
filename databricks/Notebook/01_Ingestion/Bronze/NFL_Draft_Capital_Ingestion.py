# Databricks notebook source
# DBTITLE 1,📋 NFL Draft Capital Ingestion Overview
# MAGIC %md
# MAGIC # NFL Draft Capital Ingestion - 2026 NFL Draft
# MAGIC
# MAGIC ## 🎯 Purpose
# MAGIC
# MAGIC Ingests official NFL Draft data to power **rookie rankings** in the FantasAI dual-ranking system.
# MAGIC
# MAGIC **Why Draft Capital Matters:**
# MAGIC * Strongest predictor of rookie opportunity (draft capital > ADP for rookies)
# MAGIC * Teams invest more in early-round picks (touches, targets, playing time)
# MAGIC * Critical for separating hype from actual opportunity
# MAGIC
# MAGIC ## 📊 Output Table
# MAGIC
# MAGIC **Bronze Layer (Unity Catalog: `main.fantasai`):**
# MAGIC
# MAGIC * **`bronze_nfl_draft_picks_2026`** - 2026 NFL Draft picks (Rounds 1-7)
# MAGIC   * Columns: season, round, pick, player_name, position, team, college, draft_capital_score, fetched_at
# MAGIC   * Source: Pro Football Reference (official NFL draft results)
# MAGIC   * Draft Capital Score Formula: `100 - (pick * 0.5)`
# MAGIC     * Pick 1 = 99.5 (highest value)
# MAGIC     * Pick 32 = 84.0
# MAGIC     * Pick 100 = 50.0
# MAGIC     * Pick 262 (Mr. Irrelevant) = -31.0
# MAGIC
# MAGIC ## 🔄 Refresh Schedule
# MAGIC
# MAGIC **One-time historical load:**
# MAGIC * Run once after NFL Draft (late April)
# MAGIC * No recurring schedule needed (draft is annual event)
# MAGIC
# MAGIC ## 📝 Notes
# MAGIC
# MAGIC * 2026 NFL Draft occurred: April 24-26, 2026
# MAGIC * Total picks: ~262 (7 rounds × 32 teams + compensatory picks)
# MAGIC * Only offensive skill positions (QB, RB, WR, TE) relevant for fantasy
# MAGIC * Draft capital used in rookie scoring: 50% weight (see dual ranking system)
# MAGIC
# MAGIC ## 🔗 Downstream Usage
# MAGIC
# MAGIC * Join to `draft_ready_roster_2026` by player_name (rookies only)
# MAGIC * Used in FantasAI Projection Rank calculation
# MAGIC * Powers rookie value identification vs. market ADP

# COMMAND ----------

# DBTITLE 1,Install Dependencies
# MAGIC %pip install requests beautifulsoup4 --quiet
# MAGIC
# MAGIC print("✅ Dependencies installed: requests, beautifulsoup4")

# COMMAND ----------

# DBTITLE 1,Scrape 2026 NFL Draft Data
from bs4 import BeautifulSoup
import requests
import pandas as pd
from datetime import datetime
import re
import json

print("=" * 80)
print("🏈 Scraping 2026 NFL Draft Data - Both Formats")
print("=" * 80)

# FALLBACK STRATEGY (June 2026):
# Official 2026 draft pages not yet published → Use FantasyPros expert consensus rankings
# as proxy for draft capital until real draft data available (late April aftermath)
# These rankings = expert consensus on draft value, highly correlated with actual draft position

# Sources for BOTH PPR and Standard formats
draft_sources = [
    {
        'name': 'Pro Football Reference - 2026 Draft',
        'url': 'https://www.pro-football-reference.com/years/2026/draft.htm',
        'parser': 'pfr_draft',
        'format': 'PPR'  # PFR doesn't distinguish, default to PPR
    },
    {
        'name': 'FantasyPros Consensus Rankings (PPR)',
        'url': 'https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php',
        'parser': 'fantasypros_rankings',
        'format': 'PPR'
    },
    {
        'name': 'FantasyPros Consensus Rankings (Standard)',
        'url': 'https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php',
        'parser': 'fantasypros_rankings',
        'format': 'Standard'
    }
]

print("\n⚠️  NOTE: Using expert rankings as draft capital proxy until official 2026 draft data published")
print("   Expert consensus rank ≈ Expected draft position (high correlation)")
print("   Will switch to actual draft data when available (late April/May 2026)")
print("\n🎯 Strategy: Scrape BOTH PPR and Standard formats for true format differences")

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://www.google.com/',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
}

# Try each source - collect both PPR and Standard
all_dataframes = []

for source in draft_sources:
    print(f"\n🔗 Trying source: {source['name']}")
    print(f"   URL: {source['url']}")
    
    try:
        response = requests.get(source['url'], headers=headers, timeout=30)
        response.raise_for_status()
        
        print(f"   ✅ Page fetched successfully")
        print(f"   Status: {response.status_code}, Size: {len(response.content):,} bytes")
        
        # Parse HTML
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find data based on source
        if source['parser'] == 'pfr_draft':
            draft_table = soup.find('table', {'id': 'drafts'})
            data_found = draft_table is not None
        elif source['parser'] == 'fantasypros_rankings':
            # FantasyPros embeds data in JavaScript variable 'ecrData'
            draft_table = None
            data_found = False
            
            scripts = soup.find_all('script')
            for script in scripts:
                if script.string and 'var ecrData' in script.string:
                    print(f"   🗓️  Found ecrData JavaScript variable, extracting JSON...")
                    # Extract JSON from: var ecrData = {...};
                    # ecrData is an OBJECT with a "players" array inside it
                    match = re.search(r'var ecrData\s*=\s*(\{.*?\});', script.string, re.DOTALL)
                    if match:
                        try:
                            import json
                            ecr_obj = json.loads(match.group(1))
                            # Extract players array from the object
                            if 'players' in ecr_obj:
                                draft_table = ecr_obj['players']  # Store players array
                                data_found = True
                                print(f"   ✅ Successfully parsed {len(draft_table):,} rankings from JSON")
                                print(f"   Format: {ecr_obj.get('type', 'Unknown')} ({ecr_obj.get('scoring', 'Unknown')})")
                                break
                            else:
                                print(f"   ❌ No 'players' key found in ecrData object")
                                continue
                        except json.JSONDecodeError as e:
                            print(f"   ❌ JSON parse error: {e}")
                            continue
        else:
            draft_table = None
            data_found = False
    
        if data_found:
            draft_records = []
            
            if source['parser'] == 'pfr_draft':
                # Pro Football Reference Draft Table Parser
                rows = draft_table.find('tbody').find_all('tr', class_=lambda x: x != 'thead')
                print(f"\n   📊 Parsing {len(rows)} draft picks...")
                
                for row in rows:
                    if row.find('th', {'class': 'thead'}):
                        continue
                    
                    cols = row.find_all(['th', 'td'])
                    if len(cols) >= 5:
                        try:
                            round_num = int(cols[0].text.strip())
                            pick_num = int(cols[1].text.strip())
                            team = cols[2].text.strip()
                            
                            player_link = cols[3].find('a')
                            player_name = player_link.text.strip() if player_link else cols[3].text.strip()
                            
                            position = cols[4].text.strip()
                            college = cols[-1].text.strip() if len(cols) > 5 else ''
                            
                            draft_capital_score = 100 - (pick_num * 0.5)
                            
                            draft_records.append({
                                'season': 2026,
                                'round': round_num,
                                'pick': pick_num,
                                'player_name': player_name,
                                'position': position,
                                'team': team,
                                'college': college,
                                'draft_capital_score': round(draft_capital_score, 1),
                                'fetched_at': datetime.now()
                            })
                        except (ValueError, IndexError, AttributeError):
                            continue
            
            elif source['parser'] == 'fantasypros_rankings':
                # FantasyPros JSON Parser (FALLBACK)
                print(f"\n   📊 Parsing {len(draft_table)} expert consensus rankings...")
                
                for item in draft_table:
                    try:
                        # FantasyPros JSON structure (sample keys to explore)
                        # Common fields: rank_ecr, player_name, player_team_id, player_position_id
                        
                        pick_num = int(item.get('rank_ecr', 0))
                        if pick_num == 0:
                            continue
                        
                        # Player name
                        player_name = item.get('player_name', '')
                        if not player_name:
                            continue
                        
                        # Team (usually team abbreviation)
                        team = item.get('player_team_id', '')
                        
                        # Position
                        position = item.get('player_position_id', '')
                        
                        # Estimate round based on pick number (32 picks per round)
                        round_num = ((pick_num - 1) // 32) + 1
                        
                        # Calculate draft capital score using same formula
                        draft_capital_score = 100 - (pick_num * 0.5)
                        
                        draft_records.append({
                            'season': 2026,
                            'round': round_num,
                            'pick': pick_num,
                            'player_name': player_name,
                            'position': position,
                            'team': team,
                            'college': '',  # Not available in rankings
                            'draft_capital_score': round(draft_capital_score, 1),
                            'fetched_at': datetime.now()
                        })
                    except (ValueError, KeyError, TypeError):
                        continue
        
            if draft_records:
                format_df = pd.DataFrame(draft_records)
                format_df['format'] = source['format']  # Add format column
                all_dataframes.append(format_df)
                print(f"   ✅ Successfully parsed {len(format_df):,} {source['format']} rankings from {source['name']}")
                # Continue to next source (don't break - we want both formats)
            
            else:
                print(f"   ⚠️  Warning: No rankings found in {source['name']} data")
            
        else:
            print(f"   ⚠️  Warning: Could not find draft table on {source['name']} page")
            
    except requests.Timeout:
        print(f"   ❌ Error: Request timed out after 30 seconds")
        continue
    except requests.RequestException as e:
        print(f"   ❌ Error: {e}")
        continue
    except Exception as e:
        print(f"   ❌ Unexpected Error: {e}")
        continue

# Combine all formats into single DataFrame
if all_dataframes:
    df = pd.concat(all_dataframes, ignore_index=True)
    print(f"\n\n{'='*80}")
    print("📊 COMBINED DATA SUMMARY")
    print("="*80)
    print(f"\n📊 Total Records: {len(df):,}")
    print(f"\n🏷️  Format Breakdown:")
    for fmt in df['format'].unique():
        fmt_df = df[df['format'] == fmt]
        print(f"   • {fmt}: {len(fmt_df):,} players")
    
    print(f"\n🎯 Position Breakdown (All Formats):")
    print(df.groupby('position')['format'].count().sort_values(ascending=False).to_string())
    
    print(f"\n📊 Rank Range:")
    print(f"   Min: {df['pick'].min()} | Max: {df['pick'].max()}")
    print(f"\n📅 Fetched At: {df['fetched_at'].iloc[0]}")
    print("="*80)
    
    # Show sample of each format
    print(f"\n👁️  Sample Data (Top 5 from each format):")
    for fmt in df['format'].unique():
        fmt_df = df[df['format'] == fmt].head(5)
        print(f"\n--- {fmt} Format ---")
        print(fmt_df[['pick', 'player_name', 'position', 'team', 'draft_capital_score']].to_string(index=False))
else:
    df = pd.DataFrame(columns=[
        'season', 'round', 'pick', 'player_name', 'position', 
        'team', 'college', 'draft_capital_score', 'fetched_at', 'format'
    ])
    print(f"\n\n❌ ERROR: No data scraped from any source!")
    print("   All sources failed or returned empty data.")
    print(f"   Possible reasons:")
    print(f"   - 2026 draft page not yet published (may take weeks after draft)")
    print(f"   - Websites blocking automated requests")
    print(f"   - URL structure changed")

print(f"\n" + "=" * 80)

# COMMAND ----------

# DBTITLE 1,Save to Bronze Table
print("=" * 80)
print("💾 Saving 2026 NFL Draft Data to Bronze Table (Both Formats)")
print("=" * 80)

table_name = "main.fantasai.bronze_nfl_draft_picks_2026"

if not df.empty:
    print(f"\n📦 Converting to Spark DataFrame...")
    spark_df = spark.createDataFrame(df)
    
    print(f"💾 Saving to: {table_name}")
    print(f"Mode: Overwrite | Records: {len(df):,}")
    print(f"Columns: season, round, pick, player_name, position, team, college, draft_capital_score, fetched_at, format")
    
    try:
        spark_df.write \
            .mode('overwrite') \
            .option('overwriteSchema', 'true') \
            .saveAsTable(table_name)
        
        print(f"✅ Successfully saved! Table: {table_name}, Rows: {len(df):,}")
        
        # Show format breakdown
        print(f"\n🏷️  Format Breakdown:")
        for fmt in df['format'].unique():
            fmt_count = len(df[df['format'] == fmt])
            print(f"   • {fmt}: {fmt_count:,} records")
        
        # Show fantasy-relevant positions by format
        print(f"\n🎯 Fantasy-Relevant Positions (QB, RB, WR, TE):")
        fantasy_positions = df[df['position'].isin(['QB', 'RB', 'WR', 'TE'])]
        print(f"   Total: {len(fantasy_positions):,} players across both formats")
        print(f"\n   Position Breakdown:")
        print(fantasy_positions.groupby(['format', 'position']).size().unstack(fill_value=0).to_string())
        
    except Exception as e:
        print(f"❌ Error saving to table: {e}")
else:
    print(f"\n⚠️  Skipping save: No data available")
    print(f"(Could mean draft hasn't occurred yet or website structure changed)")

print(f"\n" + "=" * 80)

# COMMAND ----------

# DBTITLE 1,DEBUG: Inspect FantasyPros Page Structure
# Debug: Check what tables/data structures exist on FantasyPros page
from bs4 import BeautifulSoup
import requests
import json
import re

url = 'https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

print("Fetching page...")
response = requests.get(url, headers=headers, timeout=30)
soup = BeautifulSoup(response.content, 'html.parser')

print(f"\n1. All <table> elements on page:")
tables = soup.find_all('table')
for i, table in enumerate(tables):
    table_id = table.get('id', 'NO ID')
    table_class = table.get('class', 'NO CLASS')
    print(f"   Table {i+1}: id='{table_id}', class='{table_class}'")

print(f"\n2. All <div> with 'rank' in id or class:")
rank_divs = soup.find_all('div', {'id': re.compile('rank', re.I)}) + soup.find_all('div', {'class': re.compile('rank', re.I)})
for div in rank_divs[:5]:  # First 5 only
    print(f"   {div.get('id', div.get('class'))}")

print(f"\n3. Looking for embedded JSON data in <script> tags...")
scripts = soup.find_all('script')
for script in scripts:
    if script.string and 'var ecrData' in script.string:
        print("   ✅ Found 'ecrData' variable in script tag!")
        print(f"   Script length: {len(script.string)} characters")
        
        # Show first 500 chars of the ecrData line
        ecr_start = script.string.find('var ecrData')
        snippet = script.string[ecr_start:ecr_start+500]
        print(f"\n   First 500 chars starting from 'var ecrData':")
        print(f"   {repr(snippet)}")
        
        # Try multiple regex patterns
        patterns = [
            r'var ecrData\s*=\s*(\[.*?\]);',  # Original (non-greedy)
            r'var ecrData\s*=\s*(\[.*\]);',   # Greedy
            r'var ecrData\s*=\s*(\[[^;]+\]);', # Up to semicolon
        ]
        
        for i, pattern in enumerate(patterns):
            print(f"\n   Trying pattern {i+1}: {pattern}")
            match = re.search(pattern, script.string, re.DOTALL)
            if match:
                print(f"   ✅ Pattern matched! JSON length: {len(match.group(1))} chars")
                try:
                    data = json.loads(match.group(1))
                    print(f"   ✅ Successfully parsed JSON! {len(data)} records found")
                    print(f"\n   First record keys: {list(data[0].keys())}")
                    print(f"\n   Sample record:")
                    print(json.dumps(data[0], indent=2))
                    break
                except json.JSONDecodeError as e:
                    print(f"   ❌ JSON parse error: {e}")
                    print(f"   First 500 chars of matched JSON: {match.group(1)[:500]}")
            else:
                print(f"   ❌ Pattern did not match")
        break
else:
    print("   ❌ No 'ecrData' variable found")
    print("   Checking for other data variables...")
    for script in scripts:
        if script.string and ('var data' in script.string or 'rankings' in script.string.lower()):
            print(f"   Found script with 'data' or 'rankings': {script.string[:200]}...")
            break

# COMMAND ----------

# DBTITLE 1,ALTERNATIVE: Manual CSV Upload
# =============================================================================
# ALTERNATIVE METHOD: Manual CSV Upload
# =============================================================================
# If automated scraping fails (403 errors, data not published yet),
# you can manually upload a CSV file with 2026 draft data.
#
# CSV Format Required:
# round,pick,player_name,position,team,college
# 1,1,Shedeur Sanders,QB,LV,Colorado
# 1,2,Travis Hunter,WR,NYG,Colorado
# ...
#
# Instructions:
# 1. Download draft data from NFL.com, ESPN, or Pro Football Reference
# 2. Save as CSV with headers: round,pick,player_name,position,team,college
# 3. Upload to /FileStore/tables/2026_nfl_draft.csv
# 4. Run this cell
# =============================================================================

import pandas as pd
from datetime import datetime

print("=" * 80)
print("📊 Manual CSV Upload - 2026 NFL Draft")
print("=" * 80)

csv_path = "/dbfs/FileStore/tables/2026_nfl_draft.csv"

try:
    print(f"\n📂 Checking for CSV file: {csv_path}")
    
    # Read CSV
    df_manual = pd.read_csv(csv_path)
    
    print(f"   ✅ CSV file found! Rows: {len(df_manual):,}")
    print(f"\n📊 Columns: {list(df_manual.columns)}")
    
    # Validate required columns
    required_cols = ['round', 'pick', 'player_name', 'position', 'team']
    missing_cols = [col for col in required_cols if col not in df_manual.columns]
    
    if missing_cols:
        print(f"   ❌ Error: Missing required columns: {missing_cols}")
        print(f"   Required: {required_cols}")
        df = pd.DataFrame()
    else:
        # Add calculated columns
        df_manual['season'] = 2026
        df_manual['draft_capital_score'] = 100 - (df_manual['pick'] * 0.5)
        df_manual['draft_capital_score'] = df_manual['draft_capital_score'].round(1)
        df_manual['fetched_at'] = datetime.now()
        
        # Ensure college column exists
        if 'college' not in df_manual.columns:
            df_manual['college'] = ''
        
        # Reorder columns
        df = df_manual[[
            'season', 'round', 'pick', 'player_name', 'position', 
            'team', 'college', 'draft_capital_score', 'fetched_at'
        ]]
        
        print(f"\n✅ Data validated and processed!")
        print(f"\n📊 Draft Summary:")
        print(f"   Total Picks: {len(df)}")
        print(f"   Rounds: {df['round'].min()} - {df['round'].max()}")
        print(f"   Teams: {df['team'].nunique()}")
        print(f"   Positions: {df['position'].nunique()}")
        print(f"   Draft Capital Range: {df['draft_capital_score'].min():.1f} - {df['draft_capital_score'].max():.1f}")
        
        # Show position breakdown
        print(f"\n📈 Fantasy Position Breakdown:")
        fantasy_positions = df[df['position'].isin(['QB', 'RB', 'WR', 'TE'])]
        print(fantasy_positions['position'].value_counts())
        
        # Show top 10 picks
        print(f"\n🏆 Top 10 Picks:")
        display(df[['pick', 'player_name', 'position', 'team', 'college', 'draft_capital_score']].head(10))
        
except FileNotFoundError:
    print(f"   ⚠️  CSV file not found at: {csv_path}")
    print(f"\n📝 To use manual upload:")
    print(f"   1. Create CSV with columns: round,pick,player_name,position,team,college")
    print(f"   2. Upload to Databricks: Data -> FileStore -> Upload")
    print(f"   3. Save as: /FileStore/tables/2026_nfl_draft.csv")
    print(f"   4. Run this cell again")
    df = pd.DataFrame()
    
except Exception as e:
    print(f"   ❌ Error reading CSV: {e}")
    df = pd.DataFrame()

print(f"\n" + "=" * 80)

# COMMAND ----------

# DBTITLE 1,Validation - Verify Bronze Table
# MAGIC %sql
# MAGIC -- =============================================================================
# MAGIC -- VALIDATION: 2026 NFL Draft Capital Data (Both Formats)
# MAGIC -- =============================================================================
# MAGIC
# MAGIC -- 1. Table Summary by Format
# MAGIC SELECT 
# MAGIC   format,
# MAGIC   COUNT(*) as total_picks,
# MAGIC   MIN(round) as first_round,
# MAGIC   MAX(round) as last_round,
# MAGIC   COUNT(DISTINCT team) as teams,
# MAGIC   COUNT(DISTINCT position) as positions,
# MAGIC   ROUND(MIN(draft_capital_score), 1) as min_draft_score,
# MAGIC   ROUND(MAX(draft_capital_score), 1) as max_draft_score,
# MAGIC   MAX(fetched_at) as latest_fetch
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC GROUP BY format
# MAGIC ORDER BY format;
# MAGIC
# MAGIC -- 2. Fantasy-Relevant Positions by Format (QB, RB, WR, TE)
# MAGIC SELECT 
# MAGIC   format,
# MAGIC   position,
# MAGIC   COUNT(*) as players_drafted,
# MAGIC   ROUND(MIN(draft_capital_score), 1) as highest_score,
# MAGIC   ROUND(MAX(draft_capital_score), 1) as lowest_score,
# MAGIC   ROUND(AVG(draft_capital_score), 1) as avg_score
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC WHERE position IN ('QB', 'RB', 'WR', 'TE')
# MAGIC GROUP BY format, position
# MAGIC ORDER BY format, players_drafted DESC;
# MAGIC
# MAGIC -- 3. Top 10 Picks (PPR Format)
# MAGIC SELECT 
# MAGIC   pick,
# MAGIC   player_name,
# MAGIC   position,
# MAGIC   team,
# MAGIC   college,
# MAGIC   draft_capital_score
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC WHERE format = 'PPR'
# MAGIC ORDER BY pick
# MAGIC LIMIT 10;
# MAGIC
# MAGIC -- 4. Top 10 Picks (Standard Format)
# MAGIC SELECT 
# MAGIC   pick,
# MAGIC   player_name,
# MAGIC   position,
# MAGIC   team,
# MAGIC   college,
# MAGIC   draft_capital_score
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC WHERE format = 'Standard'
# MAGIC ORDER BY pick
# MAGIC LIMIT 10;
# MAGIC
# MAGIC -- 5. Format Comparison: Biggest Rank Differences (Top 50)
# MAGIC WITH ppr AS (
# MAGIC   SELECT player_name, position, team, pick as ppr_rank
# MAGIC   FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC   WHERE format = 'PPR' AND pick <= 50
# MAGIC ),
# MAGIC standard AS (
# MAGIC   SELECT player_name, position, team, pick as std_rank
# MAGIC   FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC   WHERE format = 'Standard' AND pick <= 50
# MAGIC )
# MAGIC SELECT 
# MAGIC   COALESCE(ppr.player_name, standard.player_name) as player_name,
# MAGIC   COALESCE(ppr.position, standard.position) as position,
# MAGIC   COALESCE(ppr.team, standard.team) as team,
# MAGIC   ppr.ppr_rank,
# MAGIC   standard.std_rank,
# MAGIC   (standard.std_rank - ppr.ppr_rank) as rank_delta,
# MAGIC   CASE 
# MAGIC     WHEN (standard.std_rank - ppr.ppr_rank) > 5 THEN '🔻 Better in PPR'
# MAGIC     WHEN (standard.std_rank - ppr.ppr_rank) < -5 THEN '🔺 Better in Standard'
# MAGIC     ELSE '↔️ Similar'
# MAGIC   END as format_preference
# MAGIC FROM ppr
# MAGIC FULL OUTER JOIN standard
# MAGIC   ON LOWER(TRIM(ppr.player_name)) = LOWER(TRIM(standard.player_name))
# MAGIC ORDER BY ABS(COALESCE(standard.std_rank, 999) - COALESCE(ppr.ppr_rank, 999)) DESC
# MAGIC LIMIT 20;
# MAGIC
# MAGIC -- 6. Data Quality Check - Null Values by Format
# MAGIC SELECT 
# MAGIC   format,
# MAGIC   SUM(CASE WHEN player_name IS NULL THEN 1 ELSE 0 END) as null_names,
# MAGIC   SUM(CASE WHEN position IS NULL THEN 1 ELSE 0 END) as null_positions,
# MAGIC   SUM(CASE WHEN team IS NULL THEN 1 ELSE 0 END) as null_teams,
# MAGIC   SUM(CASE WHEN draft_capital_score IS NULL THEN 1 ELSE 0 END) as null_scores,
# MAGIC   SUM(CASE WHEN format IS NULL THEN 1 ELSE 0 END) as null_format
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026
# MAGIC GROUP BY format
# MAGIC ORDER BY format;

# COMMAND ----------


