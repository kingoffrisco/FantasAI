# Databricks notebook source
# DBTITLE 1,📊 Gold ADP Overview
# MAGIC %md
# MAGIC # Gold Layer: ADP Consolidation
# MAGIC
# MAGIC ## 🎯 Purpose
# MAGIC
# MAGIC Formats FantasyPros consensus ADP data into clean Gold tables for consumption by:
# MAGIC * Draft UI (shows user-relevant ADP for their league format)
# MAGIC * Export layer (feeds R2 API)
# MAGIC * ML training features
# MAGIC
# MAGIC ## 📊 Output Tables
# MAGIC
# MAGIC **Gold Layer (Unity Catalog: `main.fantasai`):**
# MAGIC
# MAGIC * **`gold_adp_ppr`** - PPR ADP (FantasyPros expert consensus)
# MAGIC   * Columns: player_id, player_name, position, team, adp_rank, adp_value, last_updated
# MAGIC   * Source: `bronze_nfl_draft_picks_2026` (FantasyPros PPR expert consensus rankings)
# MAGIC   * 413 fantasy-relevant players (QB, RB, WR, TE)
# MAGIC   
# MAGIC * **`gold_adp_standard`** - Standard ADP (FantasyPros consensus)
# MAGIC   * Same schema as PPR version
# MAGIC   * ✅ **NOW USING REAL STANDARD FORMAT DATA** from FantasyPros Standard rankings
# MAGIC   * Bronze table contains both PPR and Standard formats with format column
# MAGIC
# MAGIC ## 🔄 Refresh Schedule
# MAGIC
# MAGIC **Recommended:**
# MAGIC * Run AFTER bronze ADP ingestion completes
# MAGIC * Daily during draft season (July-September)
# MAGIC * Weekly in offseason (October-June)
# MAGIC
# MAGIC ## 📝 Logic
# MAGIC
# MAGIC * **Source Data:** `bronze_nfl_draft_picks_2026` (expert consensus rankings scraped from FantasyPros)
# MAGIC * **Player ID Mapping:** Joins to bronze_players by name to get player_id for downstream joins
# MAGIC * **Data Cleaning:** Filters to fantasy positions (QB/RB/WR/TE), excludes DST/K
# MAGIC * **Rank = ADP:** Expert consensus rank directly used as ADP value (highly correlated)
# MAGIC * **June 2026 Fallback:** Using expert rankings until actual mock draft ADP available (July-August)
# MAGIC
# MAGIC ## 🔗 Downstream Usage
# MAGIC
# MAGIC * Join to `draft_ready_roster_2026` by player_name
# MAGIC * Export as ADP columns in `export_players_2026_draft`
# MAGIC * Used for "Ghost Picks" draft recommendations in UI

# COMMAND ----------

# DBTITLE 1,Create Gold ADP - PPR
# MAGIC %sql
# MAGIC -- =============================================================================
# MAGIC -- GOLD LAYER: ADP (PPR Format)
# MAGIC -- =============================================================================
# MAGIC -- Formats FantasyPros consensus ADP with player_id mapping
# MAGIC -- =============================================================================
# MAGIC
# MAGIC CREATE OR REPLACE TABLE main.fantasai.gold_adp_ppr AS
# MAGIC WITH player_mapping AS (
# MAGIC   -- Get player_id from bronze_players for downstream joins
# MAGIC   SELECT DISTINCT
# MAGIC     player_id,
# MAGIC     full_name as player_name
# MAGIC   FROM main.fantasai.bronze_players
# MAGIC   WHERE ingested_at >= '2026-01-01'
# MAGIC     AND full_name IS NOT NULL
# MAGIC )
# MAGIC SELECT 
# MAGIC   pm.player_id,
# MAGIC   COALESCE(pm.player_name, draft.player_name) as player_name,
# MAGIC   draft.position,
# MAGIC   draft.team,
# MAGIC   draft.pick as adp_rank,
# MAGIC   CAST(draft.pick AS DOUBLE) as adp_value,  -- Expert consensus rank = ADP value
# MAGIC   CURRENT_TIMESTAMP() as last_updated
# MAGIC   
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026 draft
# MAGIC LEFT JOIN player_mapping pm
# MAGIC   ON LOWER(TRIM(pm.player_name)) = LOWER(TRIM(draft.player_name))
# MAGIC
# MAGIC -- Filter to PPR format and fantasy-relevant positions
# MAGIC WHERE draft.format = 'PPR'
# MAGIC   AND draft.position IN ('QB', 'RB', 'WR', 'TE')
# MAGIC   AND draft.pick IS NOT NULL;

# COMMAND ----------

# DBTITLE 1,Validate Gold ADP - PPR
# MAGIC %sql
# MAGIC -- Show summary of PPR table
# MAGIC SELECT 
# MAGIC   '🟢 PPR Format' as summary,
# MAGIC   COUNT(*) as total_players,
# MAGIC   SUM(CASE WHEN player_id IS NOT NULL THEN 1 ELSE 0 END) as with_player_id,
# MAGIC   SUM(CASE WHEN player_id IS NULL THEN 1 ELSE 0 END) as missing_player_id,
# MAGIC   ROUND(MIN(adp_value), 1) as min_adp,
# MAGIC   ROUND(MAX(adp_value), 1) as max_adp
# MAGIC FROM main.fantasai.gold_adp_ppr;

# COMMAND ----------

# DBTITLE 1,Create Gold ADP - Standard
# MAGIC %sql
# MAGIC -- =============================================================================
# MAGIC -- GOLD LAYER: ADP (Standard Format)
# MAGIC -- =============================================================================
# MAGIC -- Formats FantasyPros consensus ADP with player_id mapping
# MAGIC -- =============================================================================
# MAGIC
# MAGIC -- =============================================================================
# MAGIC -- NOW USING REAL STANDARD FORMAT DATA from Bronze Ingestion
# MAGIC -- Bronze table now contains both PPR and Standard formats (format column)
# MAGIC -- =============================================================================
# MAGIC
# MAGIC CREATE OR REPLACE TABLE main.fantasai.gold_adp_standard AS
# MAGIC WITH player_mapping AS (
# MAGIC   -- Get player_id from bronze_players for downstream joins
# MAGIC   SELECT DISTINCT
# MAGIC     player_id,
# MAGIC     full_name as player_name
# MAGIC   FROM main.fantasai.bronze_players
# MAGIC   WHERE ingested_at >= '2026-01-01'
# MAGIC     AND full_name IS NOT NULL
# MAGIC )
# MAGIC SELECT 
# MAGIC   pm.player_id,
# MAGIC   COALESCE(pm.player_name, draft.player_name) as player_name,
# MAGIC   draft.position,
# MAGIC   draft.team,
# MAGIC   draft.pick as adp_rank,
# MAGIC   CAST(draft.pick AS DOUBLE) as adp_value,  -- Standard format ranking
# MAGIC   CURRENT_TIMESTAMP() as last_updated
# MAGIC   
# MAGIC FROM main.fantasai.bronze_nfl_draft_picks_2026 draft
# MAGIC LEFT JOIN player_mapping pm
# MAGIC   ON LOWER(TRIM(pm.player_name)) = LOWER(TRIM(draft.player_name))
# MAGIC
# MAGIC -- Filter to Standard format and fantasy-relevant positions
# MAGIC WHERE draft.format = 'Standard'
# MAGIC   AND draft.position IN ('QB', 'RB', 'WR', 'TE')
# MAGIC   AND draft.pick IS NOT NULL;
# MAGIC
# MAGIC

# COMMAND ----------

# DBTITLE 1,Validate Gold ADP - Standard
# MAGIC %sql
# MAGIC -- Show summary of Standard table
# MAGIC SELECT 
# MAGIC   '✅ Standard Format (Real Data)' as summary,
# MAGIC   COUNT(*) as total_players,
# MAGIC   SUM(CASE WHEN player_id IS NOT NULL THEN 1 ELSE 0 END) as with_player_id,
# MAGIC   SUM(CASE WHEN player_id IS NULL THEN 1 ELSE 0 END) as missing_player_id,
# MAGIC   ROUND(MIN(adp_value), 1) as min_adp,
# MAGIC   ROUND(MAX(adp_value), 1) as max_adp
# MAGIC FROM main.fantasai.gold_adp_standard;

# COMMAND ----------

# DBTITLE 1,Validation - Format Comparison
# MAGIC %sql
# MAGIC -- =============================================================================
# MAGIC -- VALIDATION: PPR vs Standard Format Comparison
# MAGIC -- =============================================================================
# MAGIC
# MAGIC -- Top 20 Players by ADP (PPR)
# MAGIC SELECT 
# MAGIC   'PPR TOP 20' as category,
# MAGIC   player_name,
# MAGIC   position,
# MAGIC   team,
# MAGIC   adp_rank,
# MAGIC   ROUND(adp_value, 1) as adp
# MAGIC FROM main.fantasai.gold_adp_ppr
# MAGIC ORDER BY adp_rank
# MAGIC LIMIT 20;
# MAGIC
# MAGIC -- Top 20 Players by ADP (Standard)
# MAGIC SELECT 
# MAGIC   'STANDARD TOP 20' as category,
# MAGIC   player_name,
# MAGIC   position,
# MAGIC   team,
# MAGIC   adp_rank,
# MAGIC   ROUND(adp_value, 1) as adp
# MAGIC FROM main.fantasai.gold_adp_standard
# MAGIC ORDER BY adp_rank
# MAGIC LIMIT 20;
# MAGIC
# MAGIC -- Format Comparison: Players with Biggest ADP Swings Between PPR and Standard
# MAGIC SELECT 
# MAGIC   ppr.player_name,
# MAGIC   ppr.position,
# MAGIC   ppr.team,
# MAGIC   ppr.adp_value as ppr_adp,
# MAGIC   std.adp_value as standard_adp,
# MAGIC   ROUND(std.adp_value - ppr.adp_value, 1) as adp_delta,
# MAGIC   CASE 
# MAGIC     WHEN std.adp_value - ppr.adp_value > 10 THEN 'Much Better in PPR'
# MAGIC     WHEN std.adp_value - ppr.adp_value < -10 THEN 'Much Better in Standard'
# MAGIC     ELSE 'Similar Value'
# MAGIC   END as format_preference
# MAGIC FROM main.fantasai.gold_adp_ppr ppr
# MAGIC INNER JOIN main.fantasai.gold_adp_standard std
# MAGIC   ON LOWER(TRIM(ppr.player_name)) = LOWER(TRIM(std.player_name))
# MAGIC WHERE ppr.adp_value IS NOT NULL 
# MAGIC   AND std.adp_value IS NOT NULL
# MAGIC ORDER BY ABS(std.adp_value - ppr.adp_value) DESC
# MAGIC LIMIT 30;
