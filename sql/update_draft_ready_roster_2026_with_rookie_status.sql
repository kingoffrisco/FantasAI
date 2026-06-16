-- ============================================================================
-- Update draft_ready_roster_2026 View with Rookie Status and Experience Data
-- ============================================================================
-- Created: June 9, 2026
-- Purpose: Add is_rookie, years_exp, depth_chart data from Sleeper API
-- 
-- PREREQUISITES:
--   1. Run 03_player_metadata_ingestion notebook to populate bronze_players
--      with new columns: years_exp, age, birth_date, college, depth_chart_*
--   2. Verify bronze_players has these columns before running this script
--
-- NEW COLUMNS ADDED:
--   - years_exp (INT): NFL experience years from Sleeper (0 = rookie)
--   - is_rookie (BOOLEAN): TRUE if years_exp = 0
--   - age (INT): Player age
--   - birth_date (STRING): Player birth date
--   - college (STRING): College/university attended
--   - depth_chart_order (INT): 1 = starter, 2 = backup, 3+ = depth
--   - depth_chart_position (STRING): Position-specific depth (WR1, RB2, etc.)
--   - depth_chart_role (STRING): Starter/Backup/Depth/Unknown
--
-- VALIDATION AFTER RUNNING:
--   SELECT is_rookie, COUNT(*) as player_count 
--   FROM main.fantasai.draft_ready_roster_2026 
--   GROUP BY is_rookie;
--   -- Should show TRUE/FALSE split, expect ~50-100 rookies
-- ============================================================================

CREATE OR REPLACE VIEW main.fantasai.draft_ready_roster_2026 AS

WITH latest_2026_roster AS (
    -- Get the latest 2026 roster snapshot per player
    SELECT 
        player_id,
        full_name,
        position,
        team,
        status,
        years_exp,  -- NEW: Rookie indicator from Sleeper
        age,  -- NEW
        birth_date,  -- NEW
        college,  -- NEW
        depth_chart_order,  -- NEW: Starter vs backup
        depth_chart_position,  -- NEW: WR1, RB1, etc.
        ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY ingested_at DESC) as rn
    FROM main.fantasai.bronze_players
    WHERE ingested_at >= '2026-01-01'  -- 2026 roster data only
),
active_2026 AS (
    -- Filter to only players actually on 2026 rosters
    SELECT 
        player_id,
        full_name,
        position,
        team,
        status,
        years_exp,
        age,
        birth_date,
        college,
        depth_chart_order,
        depth_chart_position
    FROM latest_2026_roster
    WHERE rn = 1  -- Latest update per player
      AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'FB', 'DEF')  -- Fantasy positions including team defenses
      AND (position = 'DEF' OR status IN ('Active', 'Injured Reserve'))  -- Defenses have null status; players must be Active/IR
      AND team IS NOT NULL 
      AND team != ''  -- Must have a team
)
SELECT 
    -- Player Identity (use gold if available, otherwise bronze player_id)
    COALESCE(pd.master_player_id, a2026.player_id) as master_player_id,
    COALESCE(pd.display_name, a2026.full_name) as player_name,
    a2026.position,
    a2026.team,  -- Use 2026 Bronze roster team (most current)
    
    -- NEW: Rookie and Experience Data from Sleeper
    COALESCE(a2026.years_exp, 0) as years_exp,
    CASE WHEN COALESCE(a2026.years_exp, 0) = 0 THEN TRUE ELSE FALSE END as is_rookie,
    a2026.age,
    a2026.birth_date,
    a2026.college,
    
    -- NEW: Depth Chart Data
    a2026.depth_chart_order,
    a2026.depth_chart_position,
    CASE 
        WHEN a2026.depth_chart_order = 1 THEN 'Starter'
        WHEN a2026.depth_chart_order = 2 THEN 'Backup'
        WHEN a2026.depth_chart_order >= 3 THEN 'Depth'
        ELSE 'Unknown'
    END as depth_chart_role,
    
    -- 2025 Season Performance
    COALESCE(s2025.season_total_points, 0.0) as season_total_points_2025,
    COALESCE(s2025.season_avg_points, 0.0) as season_avg_points_2025,
    COALESCE(s2025.games_played, 0) as games_played_2025,
    
    -- Combine Metrics
    c.draft_year,
    c.forty_time,
    c.vertical_jump,
    c.bench_reps,
    c.ras_score as athleticism_score,
    
    -- Career Stats
    COALESCE(career.total_career_points, 0.0) as total_career_points,
    COALESCE(career.seasons_played, 0) as seasons_played,
    COALESCE(career.career_ppg, 0.0) as career_ppg,
    
    -- Experience classification (UPDATED to prioritize years_exp from Sleeper)
    CASE 
        WHEN COALESCE(a2026.years_exp, 0) = 0 THEN 'Rookie'
        WHEN COALESCE(a2026.years_exp, 0) = 1 THEN 'Sophomore'
        WHEN COALESCE(a2026.years_exp, 0) <= 3 THEN 'Young'
        WHEN COALESCE(a2026.years_exp, 0) >= 4 THEN 'Veteran'
        -- Fallback to combine draft_year if years_exp is null
        WHEN c.draft_year = 2026 THEN 'Rookie 2026'
        WHEN c.draft_year = 2025 THEN 'Sophomore' 
        WHEN c.draft_year >= 2023 THEN 'Young'
        WHEN career.seasons_played > 0 THEN 'Veteran'
        ELSE 'Unknown'
    END as experience_level,
    
    -- 2025 Season availability
    CASE 
        WHEN s2025.games_played >= 14 THEN 'Full Season'
        WHEN s2025.games_played >= 8 THEN 'Most Games'
        WHEN s2025.games_played >= 4 THEN 'Limited Action'
        WHEN s2025.games_played > 0 THEN 'Spot Duty'
        ELSE 'No 2025 Stats'
    END as season_2025_status,
    
    -- Draft tier based on 2025 performance
    CASE
        -- QB tiers
        WHEN a2026.position = 'QB' AND s2025.season_total_points >= 300 THEN 'QB1'
        WHEN a2026.position = 'QB' AND s2025.season_total_points >= 250 THEN 'QB2'
        WHEN a2026.position = 'QB' AND s2025.season_total_points >= 200 THEN 'QB3'
        
        -- RB tiers
        WHEN a2026.position = 'RB' AND s2025.season_total_points >= 200 THEN 'RB1'
        WHEN a2026.position = 'RB' AND s2025.season_total_points >= 150 THEN 'RB2'
        WHEN a2026.position = 'RB' AND s2025.season_total_points >= 100 THEN 'RB3'
        
        -- WR tiers
        WHEN a2026.position = 'WR' AND s2025.season_total_points >= 200 THEN 'WR1'
        WHEN a2026.position = 'WR' AND s2025.season_total_points >= 150 THEN 'WR2'
        WHEN a2026.position = 'WR' AND s2025.season_total_points >= 100 THEN 'WR3'
        
        -- TE tiers
        WHEN a2026.position = 'TE' AND s2025.season_total_points >= 150 THEN 'TE1'
        WHEN a2026.position = 'TE' AND s2025.season_total_points >= 100 THEN 'TE2'
        
        -- K tier
        WHEN a2026.position = 'K' AND s2025.season_total_points >= 100 THEN 'K1'
        
        -- Default
        WHEN s2025.season_total_points > 0 THEN 'Flex/Depth'
        ELSE 'Unproven'
    END as draft_tier
    
FROM active_2026 a2026

-- LEFT JOIN to gold_player_dim (keeps all 2026 roster players even if not matched)
LEFT JOIN main.fantasai.gold_player_dim pd 
    ON LOWER(TRIM(a2026.full_name)) = LOWER(TRIM(pd.display_name))
    AND a2026.position = pd.position

-- Join 2025 season stats (using COALESCE'd master_player_id)
LEFT JOIN (
    SELECT 
        master_player_id,
        SUM(fantasy_points) as season_total_points,
        AVG(fantasy_points) as season_avg_points,
        COUNT(DISTINCT week) as games_played
    FROM main.fantasai.gold_weekly_stats
    WHERE season = 2025
    GROUP BY master_player_id
) s2025 ON COALESCE(pd.master_player_id, a2026.player_id) = s2025.master_player_id

-- Join combine data
LEFT JOIN main.fantasai.player_combine_results c 
    ON LOWER(TRIM(a2026.full_name)) = LOWER(TRIM(c.player_name))
    AND a2026.position = c.position

-- Join career totals (using COALESCE'd master_player_id)
LEFT JOIN (
    SELECT 
        master_player_id,
        SUM(fantasy_points) as total_career_points,
        COUNT(DISTINCT season) as seasons_played,
        AVG(fantasy_points) as career_ppg
    FROM main.fantasai.gold_weekly_stats
    GROUP BY master_player_id
) career ON COALESCE(pd.master_player_id, a2026.player_id) = career.master_player_id;
