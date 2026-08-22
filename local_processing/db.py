"""
DuckDB connection manager and schema initializer.
Replaces Databricks Unity Catalog (main.fantasai.*).

Database file: local_processing/db/fantasai.duckdb
All tables mirror the Databricks schema but use DuckDB types.
"""

from pathlib import Path
import duckdb

DB_PATH = Path(__file__).parent / "db" / "fantasai.duckdb"


def get_conn() -> duckdb.DuckDBPyConnection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(DB_PATH))


def init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Create all tables if they don't already exist."""

    # depth_charts predates nflverse's schema change (old columns: week/game_type/position/
    # depth_team/formation — all gone from the source now). CREATE TABLE IF NOT EXISTS below
    # won't touch an incompatible existing table, so drop it once here; safe because the table
    # is always fully rebuilt from nflverse on each ingest run, never historical.
    existing_cols = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name='depth_charts'"
    ).fetchall()}
    if existing_cols and "pos_abb" not in existing_cols:
        conn.execute("DROP TABLE IF EXISTS depth_charts")

    sql = """

    -- =========================================================
    -- BRONZE LAYER (raw ingestion)
    -- =========================================================

    CREATE TABLE IF NOT EXISTS bronze_player_news_raw (
        player_id            VARCHAR PRIMARY KEY,
        player_name          VARCHAR,
        first_name           VARCHAR,
        last_name            VARCHAR,
        position             VARCHAR,
        team                 VARCHAR,
        status               VARCHAR,
        injury_status        VARCHAR,
        injury_body_part     VARCHAR,
        injury_notes         VARCHAR,
        injury_start_date    VARCHAR,
        years_exp            INTEGER,
        active               BOOLEAN,
        age                  INTEGER,
        number               VARCHAR,
        depth_chart_order    INTEGER,
        depth_chart_position VARCHAR,
        news_updated         BIGINT,
        fantasy_positions    VARCHAR,
        espn_id              VARCHAR,
        fetched_at           TIMESTAMP,
        raw_data             VARCHAR
    );

    CREATE TABLE IF NOT EXISTS bronze_player_news_espn_api (
        article_id      VARCHAR,
        player_id       VARCHAR,
        espn_player_id  VARCHAR,
        player_name     VARCHAR,
        headline        VARCHAR,
        description     VARCHAR,
        article_type    VARCHAR,
        published_at    TIMESTAMP,
        last_modified   TIMESTAMP,
        article_url     VARCHAR,
        image_url       VARCHAR,
        categories      VARCHAR[],
        fetched_at      TIMESTAMP,
        PRIMARY KEY (article_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS bronze_google_news (
        article_id   VARCHAR,
        player_id    VARCHAR,
        player_name  VARCHAR,
        position     VARCHAR,
        team         VARCHAR,
        title        VARCHAR,
        description  VARCHAR,
        link         VARCHAR,
        published_at TIMESTAMP,
        source       VARCHAR,
        fetched_at   TIMESTAMP,
        PRIMARY KEY (article_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS bronze_nfl_transactions (
        transaction_id   VARCHAR,
        transaction_date TIMESTAMP,
        transaction_type VARCHAR,
        player_name      VARCHAR,
        position         VARCHAR,
        team             VARCHAR,
        description      VARCHAR,
        espn_player_id   VARCHAR,
        fetched_at       TIMESTAMP,
        PRIMARY KEY (transaction_id)
    );

    CREATE TABLE IF NOT EXISTS bronze_weekly_stats (
        player_id    VARCHAR,
        week         INTEGER,
        season       INTEGER,
        fantasy_points DOUBLE,
        stats        VARCHAR,
        source       VARCHAR,
        ingested_at  TIMESTAMP,
        PRIMARY KEY (player_id, week, season, source)
    );

    -- =========================================================
    -- SILVER LAYER (cleaned / validated)
    -- =========================================================

    CREATE TABLE IF NOT EXISTS silver_player_news (
        player_id            VARCHAR PRIMARY KEY,
        player_name          VARCHAR,
        position             VARCHAR,
        team                 VARCHAR,
        news_updated         TIMESTAMP,
        injury_status        VARCHAR,
        injury_notes         VARCHAR,
        status               VARCHAR,
        depth_chart_order    INTEGER,
        depth_chart_position VARCHAR,
        fetched_at           TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS silver_injury_reports (
        player_id        VARCHAR PRIMARY KEY,
        player_name      VARCHAR,
        position         VARCHAR,
        team             VARCHAR,
        injury_status    VARCHAR,
        injury_body_part VARCHAR,
        injury_notes     VARCHAR,
        injury_start_date VARCHAR,
        fetched_at       TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS silver_trending_players (
        player_id   VARCHAR PRIMARY KEY,
        count       INTEGER,
        player_name VARCHAR,
        position    VARCHAR,
        team        VARCHAR,
        fetched_at  TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS silver_weekly_stats (
        player_id      VARCHAR,
        week           INTEGER,
        season         INTEGER,
        fantasy_points DOUBLE,
        stats          VARCHAR,
        source         VARCHAR,
        player_name    VARCHAR,
        position       VARCHAR,
        team           VARCHAR,
        ingested_at    TIMESTAMP,
        receiving_yards_after_catch DOUBLE,
        passing_yards_after_catch   DOUBLE,
        headshot_url   VARCHAR,
        PRIMARY KEY (player_id, week, season, source)
    );

    -- =========================================================
    -- nflverse supplement tables
    -- =========================================================

    CREATE TABLE IF NOT EXISTS player_headshots (
        gsis_id      VARCHAR PRIMARY KEY,
        player_name  VARCHAR,
        position     VARCHAR,
        team         VARCHAR,
        headshot     VARCHAR,
        status       VARCHAR,
        birth_date   VARCHAR,
        height       VARCHAR,
        weight       VARCHAR,
        years_of_experience INTEGER,
        college      VARCHAR,
        imported_at  TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS player_yac_stats (
        season           INTEGER,
        week             INTEGER,
        gsis_id          VARCHAR,
        player_name      VARCHAR,
        total_yac        DOUBLE,
        yac_per_reception DOUBLE,
        receptions       INTEGER,
        receiving_yards  DOUBLE,
        air_yards        DOUBLE,
        yac_percentage   DOUBLE,
        imported_at      TIMESTAMP,
        PRIMARY KEY (season, week, gsis_id)
    );

    CREATE TABLE IF NOT EXISTS player_nextgen_stats (
        season                            INTEGER,
        week                              INTEGER,
        gsis_id                           VARCHAR,
        player_name                       VARCHAR,
        avg_cushion                       DOUBLE,
        avg_separation                    DOUBLE,
        avg_intended_air_yards            DOUBLE,
        percent_share_of_intended_air_yards DOUBLE,
        receptions                        INTEGER,
        targets                           INTEGER,
        avg_yac                           DOUBLE,
        avg_expected_yac                  DOUBLE,
        yacoe                             DOUBLE,
        imported_at                       TIMESTAMP,
        PRIMARY KEY (season, week, gsis_id)
    );

    CREATE TABLE IF NOT EXISTS player_snap_counts (
        season           INTEGER,
        week             INTEGER,
        player_name      VARCHAR,
        position         VARCHAR,
        team             VARCHAR,
        offense_snaps    INTEGER,
        offense_pct      DOUBLE,
        imported_at      TIMESTAMP,
        PRIMARY KEY (season, week, player_name, team)
    );

    -- Derived efficiency metrics computed from play-by-play (nflverse EPA, success rate,
    -- explosive plays, red zone/goal-line usage). See ingest_nflverse.py:import_efficiency_stats.
    CREATE TABLE IF NOT EXISTS player_efficiency_stats (
        season                INTEGER,
        week                  INTEGER,
        player_name           VARCHAR,
        position              VARCHAR,
        team                  VARCHAR,
        rush_attempts         INTEGER,
        targets               INTEGER,
        epa_per_play          DOUBLE,
        epa_per_rush          DOUBLE,
        epa_per_target        DOUBLE,
        epa_per_opportunity   DOUBLE,
        success_rate          DOUBLE,
        explosive_run_rate    DOUBLE,
        explosive_rec_rate    DOUBLE,
        yards_per_target      DOUBLE,
        redzone_touches       INTEGER,
        goalline_carries      INTEGER,
        elusiveness_score     DOUBLE,
        imported_at           TIMESTAMP,
        PRIMARY KEY (season, week, player_name, team)
    );

    CREATE TABLE IF NOT EXISTS depth_charts (
        season        INTEGER,
        team          VARCHAR,
        pos_abb       VARCHAR,   -- QB, RB, FB, WR, TE, LT, LG, C, RG, RT
        pos_rank      INTEGER,   -- 1 = starter
        pos_slot      VARCHAR,
        player_name   VARCHAR,
        gsis_id       VARCHAR,
        espn_id       VARCHAR,
        dt            TIMESTAMP,
        imported_at   TIMESTAMP,
        PRIMARY KEY (season, team, pos_abb, pos_rank)
    );

    -- =========================================================
    -- GOLD LAYER (business logic applied)
    -- =========================================================

    CREATE TABLE IF NOT EXISTS gold_player_dim (
        master_player_id     VARCHAR PRIMARY KEY,
        display_name         VARCHAR,
        player_name_normalized VARCHAR,
        position             VARCHAR,
        current_team         VARCHAR,
        headshot_url         VARCHAR,
        sources              VARCHAR[],
        source_count         INTEGER,
        created_at           TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gold_player_id_mapping (
        master_player_id   VARCHAR,
        source             VARCHAR,
        source_player_id   VARCHAR,
        source_player_name VARCHAR,
        position           VARCHAR,
        team               VARCHAR,
        created_at         TIMESTAMP,
        PRIMARY KEY (source, source_player_id)
    );

    CREATE TABLE IF NOT EXISTS gold_weekly_stats (
        master_player_id              VARCHAR,
        source_player_id              VARCHAR,
        source                        VARCHAR,
        season                        INTEGER,
        week                          INTEGER,
        fantasy_points                DOUBLE,
        stats                         VARCHAR,
        player_name                   VARCHAR,
        position                      VARCHAR,
        team                          VARCHAR,
        ingested_at                   TIMESTAMP,
        receiving_yards_after_catch   DOUBLE,
        passing_yards_after_catch     DOUBLE,
        headshot_url                  VARCHAR,
        PRIMARY KEY (source_player_id, week, season, source)
    );

    -- =========================================================
    -- EXPORT TABLES (consumed by R2 export)
    -- =========================================================

    CREATE TABLE IF NOT EXISTS export_player_news (
        news_id          VARCHAR PRIMARY KEY,
        headline         VARCHAR,
        source_url       VARCHAR,
        full_text        VARCHAR,
        player_id        VARCHAR,
        player_name      VARCHAR,
        position         VARCHAR,
        team             VARCHAR,
        summary_text     VARCHAR,
        fantasy_insight  VARCHAR,
        impact_score     DOUBLE,
        impact_category  VARCHAR,
        published_at     TIMESTAMP,
        enriched_at      TIMESTAMP,
        ai_generated_at  TIMESTAMP
    );

    -- =========================================================
    -- ADP TABLES
    -- =========================================================

    CREATE TABLE IF NOT EXISTS bronze_adp_rankings (
        player_name  VARCHAR,
        position     VARCHAR,
        team         VARCHAR,
        adp_rank     INTEGER,
        adp_value    DOUBLE,
        format       VARCHAR,   -- 'PPR', 'Standard', 'DST'
        source       VARCHAR,   -- 'fantasypros'
        fetched_at   TIMESTAMP,
        PRIMARY KEY (player_name, format)
    );

    -- =========================================================
    -- SCHEDULE & OWNERSHIP TABLES
    -- =========================================================

    CREATE TABLE IF NOT EXISTS bronze_nfl_schedules (
        game_id      VARCHAR PRIMARY KEY,
        season       INTEGER,
        week         INTEGER,
        game_type    VARCHAR,
        gameday      VARCHAR,
        gametime     VARCHAR,
        weekday      VARCHAR,
        home_team    VARCHAR,
        away_team    VARCHAR,
        home_score   INTEGER,
        away_score   INTEGER,
        stadium      VARCHAR,
        location     VARCHAR,
        roof         VARCHAR,
        surface      VARCHAR,
        ingested_at  TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bronze_player_ownership (
        player_id        VARCHAR PRIMARY KEY,
        player_name      VARCHAR,
        position         VARCHAR,
        team             VARCHAR,
        ownership_pct    DOUBLE,
        leagues_rostered INTEGER,
        leagues_sampled  INTEGER,
        updated_at       TIMESTAMP
    );

    -- =========================================================
    -- DST PERFORMANCE TABLES
    -- =========================================================

    CREATE TABLE IF NOT EXISTS bronze_dst_weekly_stats (
        team          VARCHAR,
        week          INTEGER,
        season        INTEGER,
        pts_ppr       DOUBLE,
        pts_std       DOUBLE,
        sacks         DOUBLE,
        interceptions DOUBLE,
        fum_rec       DOUBLE,
        def_td        DOUBLE,
        safe          DOUBLE,
        pts_allow     DOUBLE,
        yds_allow     DOUBLE,
        fetched_at    TIMESTAMP,
        PRIMARY KEY (team, week, season)
    );

    -- =========================================================
    -- COMBINE DATA TABLE
    -- =========================================================

    CREATE TABLE IF NOT EXISTS bronze_combine_data (
        player_name  VARCHAR,
        pos          VARCHAR,
        school       VARCHAR,
        season       INTEGER,
        draft_year   INTEGER,
        draft_team   VARCHAR,
        draft_round  INTEGER,
        draft_ovr    INTEGER,
        pfr_id       VARCHAR,
        ht           VARCHAR,
        wt           DOUBLE,
        forty        DOUBLE,
        bench        INTEGER,
        vertical     DOUBLE,
        broad_jump   INTEGER,
        cone         DOUBLE,
        shuttle      DOUBLE,
        ingested_at  TIMESTAMP,
        PRIMARY KEY (player_name, season)
    );

    -- =========================================================
    -- ROOKIE SCORES TABLE
    -- =========================================================
    CREATE TABLE IF NOT EXISTS bronze_rookie_scores (
        player_name          VARCHAR PRIMARY KEY,
        pos                  VARCHAR,
        team                 VARCHAR,
        season               INTEGER,
        draft_round          INTEGER,
        draft_ovr            INTEGER,
        depth_chart_order    INTEGER,
        adp                  DOUBLE,
        -- Component scores (0-100)
        draft_capital_score  DOUBLE,
        athleticism_score    DOUBLE,
        opportunity_score    DOUBLE,
        -- Composite
        rookie_score         DOUBLE,
        -- Projections
        proj_season_pts      DOUBLE,
        proj_week_pts        DOUBLE,
        computed_at          TIMESTAMP
    );

    -- =========================================================
    -- WEATHER TABLES
    -- =========================================================

    CREATE TABLE IF NOT EXISTS weather_forecasts (
        team              VARCHAR,
        city              VARCHAR,
        is_dome           BOOLEAN,
        forecast_date     VARCHAR,
        max_temp_f        INTEGER,
        min_temp_f        INTEGER,
        game_time_temp_f  INTEGER,
        feels_like_f      INTEGER,
        wind_mph          INTEGER,
        wind_dir          VARCHAR,
        precip_in         DOUBLE,
        humidity_pct      INTEGER,
        cloud_cover_pct   INTEGER,
        condition         VARCHAR,
        hourly_json       VARCHAR,
        ingested_at       TIMESTAMP,
        PRIMARY KEY (team, forecast_date)
    );

    CREATE TABLE IF NOT EXISTS weather_historical (
        team             VARCHAR,
        city             VARCHAR,
        game_date        VARCHAR,
        max_temp_f       INTEGER,
        min_temp_f       INTEGER,
        game_time_temp_f INTEGER,
        wind_mph         INTEGER,
        wind_dir         VARCHAR,
        precip_in        DOUBLE,
        condition        VARCHAR,
        ingested_at      TIMESTAMP
    );

    -- =========================================================
    -- WATCHLIST
    -- =========================================================
    CREATE TABLE IF NOT EXISTS watchlist (
        player_name          VARCHAR,
        player_id            VARCHAR,
        position             VARCHAR,
        team                 VARCHAR,
        reason               VARCHAR,
        added_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (player_name)
    );

    -- =========================================================
    -- TEAM RSS NEWS
    -- =========================================================
    CREATE TABLE IF NOT EXISTS bronze_team_rss_news (
        article_id           VARCHAR,
        team                 VARCHAR,
        title                VARCHAR,
        link                 VARCHAR,
        description          VARCHAR,
        player_id            VARCHAR,
        player_name          VARCHAR,
        position             VARCHAR,
        published_at         TIMESTAMP,
        fetched_at           TIMESTAMP,
        source_feed          VARCHAR,
        PRIMARY KEY (article_id)
    );

    -- =========================================================
    -- OFFENSIVE LINE INDEX (proprietary, derived from nflverse PBP)
    -- See ingest/ingest_oline_index.py — no free "official" O-line ranking
    -- exists, so this is a composite score built from public play-by-play.
    -- =========================================================
    CREATE TABLE IF NOT EXISTS team_oline_index (
        season                      INTEGER,
        team                        VARCHAR,
        dropbacks                   INTEGER,
        rush_plays                  INTEGER,
        sack_rate                   DOUBLE,
        pressure_rate               DOUBLE,
        pass_epa_per_play           DOUBLE,
        pass_success_rate           DOUBLE,
        stuff_rate                  DOUBLE,
        explosive_run_rate          DOUBLE,
        rush_epa_per_play           DOUBLE,
        rush_success_rate           DOUBLE,
        short_yardage_success_rate  DOUBLE,
        pass_block_score            DOUBLE,
        run_block_score             DOUBLE,
        overall_score               DOUBLE,
        pass_block_rank             INTEGER,
        run_block_rank              INTEGER,
        overall_rank                INTEGER,
        imported_at                 TIMESTAMP,
        PRIMARY KEY (season, team)
    );

    -- Which team a player suited up for each season, from silver_weekly_stats
    -- (nflverse recent_team). Handles in-season trades: is_primary marks the
    -- team the player played the most games for that season.
    CREATE TABLE IF NOT EXISTS player_team_seasons (
        player_name   VARCHAR,
        season        INTEGER,
        team          VARCHAR,
        games         INTEGER,
        is_primary    BOOLEAN,
        imported_at   TIMESTAMP,
        PRIMARY KEY (player_name, season, team)
    );

    -- =========================================================
    -- OFFENSIVE ECOSYSTEM (proprietary, derived from NGS + efficiency stats)
    -- See ingest/ingest_offensive_ecosystem.py — percentile-composite scores,
    -- same transparent-composite approach as team_oline_index above.
    -- =========================================================
    -- NFL's free NGS receiving feed only covers WR/TE (no RB rows exist at all), so RB
    -- uses a different skill-axis trio sourced from player_efficiency_stats instead of
    -- separation/adot/yacoe — see ingest_offensive_ecosystem.py. Both sets of raw/score
    -- columns are nullable, with one set populated and the other NULL depending on
    -- the player's position.
    CREATE TABLE IF NOT EXISTS player_weapon_scores (
        season                    INTEGER,
        player_name               VARCHAR,
        position                  VARCHAR,   -- 'WR', 'TE', 'RB'
        team                      VARCHAR,
        games                     INTEGER,
        targets                   INTEGER,
        target_share              DOUBLE,
        catch_rate                DOUBLE,
        redzone_touches           INTEGER,
        -- WR/TE only (from player_nextgen_stats)
        adot                      DOUBLE,
        avg_separation            DOUBLE,
        yacoe                     DOUBLE,
        -- RB only (from player_efficiency_stats)
        epa_per_target            DOUBLE,
        yards_per_target          DOUBLE,
        explosive_rec_rate        DOUBLE,
        target_share_score        DOUBLE,    -- percentile 0-100, within (season, position)
        catch_rate_score          DOUBLE,
        redzone_score             DOUBLE,
        adot_score                DOUBLE,
        separation_score          DOUBLE,
        yacoe_score               DOUBLE,
        epa_per_target_score      DOUBLE,
        yards_per_target_score    DOUBLE,
        explosive_rec_rate_score  DOUBLE,
        weapon_score              DOUBLE,    -- composite 0-100
        weapon_rank               INTEGER,   -- rank within (season, position)
        weapon_tier               VARCHAR,   -- Elite / Good / Average / Below Average / Poor
        imported_at               TIMESTAMP,
        PRIMARY KEY (season, player_name, position)
    );

    -- Team-level QB Support Score (ESCV): O-Line + best weapons + pace + red zone volume.
    CREATE TABLE IF NOT EXISTS team_support_scores (
        season                    INTEGER,
        team                      VARCHAR,
        oline_score               DOUBLE,
        oline_rank                INTEGER,
        best_wrte_weapon_score    DOUBLE,
        best_wrte_player_name     VARCHAR,
        best_rb_weapon_score      DOUBLE,
        best_rb_player_name       VARCHAR,
        pace_plays_per_game       DOUBLE,
        pace_score                DOUBLE,
        redzone_touches_total     INTEGER,
        redzone_score             DOUBLE,
        support_score             DOUBLE,  -- composite 0-100 (ESCV)
        support_rank               INTEGER,
        support_tier               VARCHAR,
        oline_starters_json        VARCHAR, -- JSON: {"LT":"...","LG":"...","C":"...","RG":"...","RT":"..."}
        imported_at                TIMESTAMP,
        PRIMARY KEY (season, team)
    );

    -- =========================================================
    -- O-LINE STABILITY INDEX (proprietary, derived from nflverse depth-chart
    -- history + snap counts + roster bio + penalties). See ingest/
    -- ingest_depth_chart_history.py and ingest/ingest_oline_stability.py.
    -- depth_charts above is UNCHANGED — it remains the "current snapshot"
    -- table used by build_oline_starters() in ingest_offensive_ecosystem.py.
    -- depth_chart_history below is purely additive: real per-week lineups.
    -- =========================================================

    -- One row per (season, week, team, OL slot, depth rank). For 2021-2024,
    -- week/rank come straight from nflverse's real weekly depth-chart feed.
    -- For 2025+ (nflverse's dt-snapshot-only schema), week is reconstructed by
    -- picking the latest snapshot whose date is <= that team's game date that
    -- week (see ingest_depth_chart_history.py).
    CREATE TABLE IF NOT EXISTS depth_chart_history (
        season        INTEGER,
        week          INTEGER,
        team          VARCHAR,
        pos_abb       VARCHAR,    -- LT, LG, C, RG, RT only (scope: O-line, not full offense)
        pos_rank      INTEGER,    -- 1 = starter
        player_name   VARCHAR,
        gsis_id       VARCHAR,
        source_schema VARCHAR,    -- 'weekly' (2021-2024 real week field) | 'snapshot' (2025+ reconstructed)
        snapshot_dt   TIMESTAMP,  -- the nflverse dt actually used (NULL for 'weekly' rows — real week, no snapshot)
        game_id       VARCHAR,    -- bronze_nfl_schedules.game_id for that team's week (nullable if bye)
        imported_at   TIMESTAMP,
        PRIMARY KEY (season, week, team, pos_abb, pos_rank)
    );

    -- O-line bio/experience — nflverse seasonal rosters, filtered to position='OL'
    -- (nflverse's roster feed, like snap_counts, uses one generic 'OL' label with
    -- no L/R granularity, that comes from depth_chart_history.pos_abb instead).
    CREATE TABLE IF NOT EXISTS player_roster_bio (
        season        INTEGER,
        gsis_id       VARCHAR,
        player_name   VARCHAR,
        position      VARCHAR,   -- 'OL'
        team          VARCHAR,
        height        VARCHAR,
        weight        DOUBLE,
        age           DOUBLE,
        years_exp     INTEGER,
        college       VARCHAR,
        draft_number  INTEGER,
        entry_year    INTEGER,
        rookie_year   INTEGER,
        imported_at   TIMESTAMP,
        PRIMARY KEY (season, gsis_id)
    );

    -- Offensive Holding / False Start penalties, attributed by nflverse's
    -- penalty_player_id (zero nulls confirmed for these two penalty types) —
    -- real referee-recorded data, not a derived grade.
    CREATE TABLE IF NOT EXISTS player_penalties (
        game_id        VARCHAR,
        play_id        DOUBLE,
        season         INTEGER,
        week           INTEGER,
        team           VARCHAR,   -- penalized team (offense)
        gsis_id        VARCHAR,
        player_name    VARCHAR,
        penalty_type   VARCHAR,   -- 'Offensive Holding' | 'False Start'
        penalty_yards  INTEGER,
        imported_at    TIMESTAMP,
        PRIMARY KEY (game_id, play_id)
    );

    -- Team-season OLSI + Chemistry composite. See ingest_oline_stability.py.
    CREATE TABLE IF NOT EXISTS team_oline_stability (
        season                    INTEGER,
        team                      VARCHAR,
        primary_starters_json     VARCHAR,  -- JSON {"LT":"name", ...} — that season's mode starting-5
        games_started_together    INTEGER,
        team_games_played         INTEGER,
        shared_snaps              INTEGER,
        team_offensive_plays      INTEGER,  -- team_oline_index.dropbacks + rush_plays (shared-snap % denom)
        continuity_pct            DOUBLE,   -- shared_snaps / team_offensive_plays * 100
        continuity_score          DOUBLE,   -- percentile 0-100 within season
        avg_games_missed          DOUBLE,   -- mean across the 5 primary starters
        health_score              DOUBLE,   -- percentile 0-100 (higher = healthier)
        avg_years_exp             DOUBLE,   -- mean across the 5 primary starters
        experience_score          DOUBLE,   -- percentile 0-100
        ol_penalty_count          INTEGER,  -- holding + false start, whole OL room (not just the 5)
        ol_penalty_rate           DOUBLE,   -- ol_penalty_count / team_offensive_plays
        penalty_score             DOUBLE,   -- percentile 0-100, inverse (fewer = better)
        sack_rate                 DOUBLE,   -- reused from team_oline_index
        sack_rate_score           DOUBLE,   -- percentile 0-100, inverse
        rush_epa_per_play         DOUBLE,   -- reused from team_oline_index
        rush_success_rate         DOUBLE,   -- reused from team_oline_index
        rush_efficiency_score     DOUBLE,   -- percentile 0-100, avg of the two above's percentile scores
        pass_block_score          DOUBLE,   -- reused from team_oline_index (Team OL Card "Pass Protection")
        run_block_score           DOUBLE,   -- reused from team_oline_index (Team OL Card "Run Blocking")
        olsi_score                DOUBLE,   -- composite 0-100 (30/20/15/15/10/10)
        olsi_rank                 INTEGER,
        olsi_tier                 VARCHAR,
        returning_starters_ct     INTEGER,  -- 0-5 vs prior season's primary five, NULL if no prior season
        returning_starters_pct    DOUBLE,
        chemistry_score           DOUBLE,   -- 0-100, raw ratios (NOT percentile — see build script)
        imported_at               TIMESTAMP,
        PRIMARY KEY (season, team)
    );

    -- Individual lineman card. One row per (season, team, gsis_id) for anyone
    -- who appears at an OL slot in depth_chart_history that season.
    CREATE TABLE IF NOT EXISTS player_oline_stability (
        season                INTEGER,
        gsis_id               VARCHAR,
        player_name           VARCHAR,
        team                  VARCHAR,
        current_pos_abb       VARCHAR,  -- CURRENT depth_charts slot (today's LT/LG/C/RG/RT), may differ from history
        age                   DOUBLE,
        years_exp             INTEGER,
        starts                INTEGER,  -- weeks started at any OL slot, this team, this season
        snaps                 INTEGER,  -- sum of offense_snaps across started weeks
        games_missed          INTEGER,
        penalties_total       INTEGER,
        penalties_holding     INTEGER,
        penalties_false_start INTEGER,
        is_primary_starter    BOOLEAN,  -- part of the team's season-long mode starting-5 set
        continuity_games      INTEGER,  -- weeks this player was part of the on-field 5 matching primary set
        imported_at           TIMESTAMP,
        PRIMARY KEY (season, gsis_id, team)
    );

    -- =========================================================
    -- DRAFTKINGS DFS (unofficial API — no public/supported developer API
    -- exists for DraftKings — these are the same class of endpoint as the
    -- ESPN ones that started 403-ing on 2026-08-20 — see job_live_scores.py.
    -- Verified live 2026-08-22. See ingest/ingest_draftkings.py.
    -- =========================================================
    CREATE TABLE IF NOT EXISTS bronze_dk_slates (
        draft_group_id   BIGINT PRIMARY KEY,
        sport             VARCHAR,
        game_type         VARCHAR,  -- 'Classic', 'Showdown Captain Mode', etc.
        slate_name        VARCHAR,  -- from the largest contest seen for this draft group
        game_count        INTEGER,
        earliest_start     TIMESTAMP,
        fetched_at        TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bronze_dk_salaries (
        draft_group_id     BIGINT,
        draftable_id        BIGINT,
        player_dk_id         INTEGER,
        display_name          VARCHAR,
        position              VARCHAR,
        team                  VARCHAR,
        opponent              VARCHAR,
        is_home               BOOLEAN,
        salary                INTEGER,
        status                VARCHAR,   -- DK's own injury/news status string, e.g. 'None', 'Q', 'O'
        game_start_time        TIMESTAMP,
        dk_avg_points          DOUBLE,    -- draftStatAttributes id 90 ("AVG") — DK's own consensus projection
        dk_position_rank        VARCHAR,  -- draftStatAttributes id -2, e.g. "13th"
        raw_stat_attrs_json      VARCHAR, -- full draftStatAttributes array as JSON, other ids not yet decoded
        fetched_at             TIMESTAMP,
        PRIMARY KEY (draft_group_id, draftable_id)
    );

    -- =========================================================
    -- KALSHI NFL MARKETS (official, documented public REST API — no auth
    -- required for market data). Append-only: never overwrite prior rows,
    -- so price history over time becomes a usable "line movement" signal.
    -- Verified live 2026-08-22 at host external-api.kalshi.com — NOTE the
    -- older documented host trading-api.kalshi.com now 401s and redirects.
    -- See ingest/ingest_kalshi.py.
    -- =========================================================
    CREATE TABLE IF NOT EXISTS bronze_kalshi_nfl_markets (
        market_ticker    VARCHAR,
        event_ticker     VARCHAR,
        series_ticker    VARCHAR,
        title            VARCHAR,
        yes_sub_title    VARCHAR,
        no_sub_title     VARCHAR,
        status           VARCHAR,
        close_time       TIMESTAMP,
        yes_bid          DOUBLE,   -- implied probability, dollars ($0.00-$1.00)
        yes_ask          DOUBLE,
        no_bid           DOUBLE,
        no_ask           DOUBLE,
        last_price       DOUBLE,
        volume           DOUBLE,
        open_interest    DOUBLE,
        fetched_at       TIMESTAMP,
        PRIMARY KEY (market_ticker, fetched_at)
    );

    -- =========================================================
    -- FLOOR / CEILING (empirical percentiles from real game logs, not a
    -- simulation). See ingest/ingest_floor_ceiling.py.
    -- =========================================================
    CREATE TABLE IF NOT EXISTS player_floor_ceiling (
        master_player_id  VARCHAR PRIMARY KEY,
        player_name        VARCHAR,
        position            VARCHAR,
        team                VARCHAR,
        games_sample        INTEGER,
        floor_pts           DOUBLE,   -- 25th percentile, most recent games window
        median_pts          DOUBLE,   -- 50th percentile
        ceiling_pts         DOUBLE,   -- 90th percentile
        mean_pts            DOUBLE,
        boom_rate            DOUBLE,   -- % of games >= 1.5x median
        bust_rate            DOUBLE,   -- % of games < 0.5x median
        computed_at          TIMESTAMP
    );

    """

    for stmt in sql.split(";"):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)

    # Lightweight migrations — CREATE TABLE IF NOT EXISTS above won't add columns to a table
    # that was already created by an older version of this schema. Add new columns here.
    conn.execute("ALTER TABLE player_efficiency_stats ADD COLUMN IF NOT EXISTS yards_per_target DOUBLE")


if __name__ == "__main__":
    conn = get_conn()
    init_schema(conn)
    tables = conn.execute("SHOW TABLES").fetchall()
    print(f"Schema initialized — {len(tables)} tables")
    for (t,) in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"   {t}: {count:,} rows")
    conn.close()
