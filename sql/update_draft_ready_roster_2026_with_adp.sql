-- =============================================================================
-- UPDATE VIEW: draft_ready_roster_2026 - Add ADP Columns (PPR & Standard)
-- =============================================================================
-- This updates the existing draft_ready_roster_2026 view to include ADP data
-- from both PPR and Standard scoring formats.
-- Run this AFTER gold_adp_consolidated_ppr and gold_adp_consolidated_standard
-- tables are created.
-- =============================================================================

CREATE OR REPLACE VIEW main.fantasai.draft_ready_roster_2026 AS
WITH current_roster AS (
  -- 2026 active roster from Sleeper (last ingested May 23, 2026)
  SELECT 
    player_id,
    full_name,
    first_name,
    last_name,
    position,
    team,
    age,
    status,
    years_exp,
    college,
    height,
    weight,
    birth_date,
    injury_status
  FROM main.fantasai.bronze_players
  WHERE ingested_at >= '2026-01-01'
    AND status IN ('Active', 'Injured Reserve')
    AND team IS NOT NULL
    AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'FB')
),
-- 2025 season stats
stats_2025 AS (
  SELECT 
    player_id,
    SUM(fantasy_points_ppr) as total_fantasy_points_2025,
    COUNT(DISTINCT week) as games_played_2025,
    ROUND(AVG(fantasy_points_ppr), 2) as avg_fantasy_points_per_game_2025,
    SUM(rushing_yards) as rushing_yards_2025,
    SUM(receiving_yards) as receiving_yards_2025,
    SUM(passing_yards) as passing_yards_2025,
    SUM(rushing_touchdowns + receiving_touchdowns + passing_touchdowns) as total_touchdowns_2025
  FROM main.fantasai.gold_weekly_stats
  WHERE season = 2025
  GROUP BY player_id
),
-- Eligibility flag
eligibility AS (
  SELECT 
    r.player_id,
    CASE 
      WHEN r.team IS NOT NULL 
           AND (s.games_played_2025 > 0 OR r.years_exp = 0 OR r.years_exp <= 2)
        THEN TRUE
      ELSE FALSE
    END as player_active_2026
  FROM current_roster r
  LEFT JOIN stats_2025 s ON r.player_id = s.player_id
)
SELECT 
  -- Player Identity
  r.player_id,
  r.full_name,
  r.first_name,
  r.last_name,
  r.position,
  r.team,
  r.age,
  r.status,
  r.years_exp,
  r.college,
  r.height,
  r.weight,
  r.birth_date,
  r.injury_status,
  
  -- 2025 Stats
  COALESCE(s.total_fantasy_points_2025, 0) as total_fantasy_points_2025,
  COALESCE(s.games_played_2025, 0) as games_played_2025,
  COALESCE(s.avg_fantasy_points_per_game_2025, 0) as avg_fantasy_points_per_game_2025,
  COALESCE(s.rushing_yards_2025, 0) as rushing_yards_2025,
  COALESCE(s.receiving_yards_2025, 0) as receiving_yards_2025,
  COALESCE(s.passing_yards_2025, 0) as passing_yards_2025,
  COALESCE(s.total_touchdowns_2025, 0) as total_touchdowns_2025,
  
  -- Eligibility Flag
  e.player_active_2026,
  
  -- ADP Data - PPR Format
  adp_ppr.sleeper_adp_ppr,
  adp_ppr.fantasypros_adp_ppr,
  adp_ppr.consensus_adp_ppr,
  adp_ppr.adp_delta_ppr,
  adp_ppr.value_category_ppr,
  adp_ppr.value_score_pct_ppr,
  
  -- ADP Data - Standard Format
  adp_std.sleeper_adp_standard,
  adp_std.fantasypros_adp_standard,
  adp_std.consensus_adp_standard,
  adp_std.adp_delta_standard,
  adp_std.value_category_standard,
  adp_std.value_score_pct_standard,
  
  -- Metadata
  CURRENT_TIMESTAMP() as view_updated_at
  
FROM current_roster r
LEFT JOIN stats_2025 s ON r.player_id = s.player_id
LEFT JOIN eligibility e ON r.player_id = e.player_id

-- Join PPR ADP
LEFT JOIN main.fantasai.gold_adp_consolidated_ppr adp_ppr
  ON LOWER(TRIM(r.full_name)) = LOWER(TRIM(adp_ppr.player_name))
  
-- Join Standard ADP
LEFT JOIN main.fantasai.gold_adp_consolidated_standard adp_std
  ON LOWER(TRIM(r.full_name)) = LOWER(TRIM(adp_std.player_name))

WHERE e.player_active_2026 = TRUE;
