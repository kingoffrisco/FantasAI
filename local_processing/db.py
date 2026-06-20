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

    CREATE TABLE IF NOT EXISTS depth_charts (
        season        INTEGER,
        week          INTEGER,
        game_type     VARCHAR,
        team          VARCHAR,
        position      VARCHAR,
        depth_team    VARCHAR,
        formation     VARCHAR,
        gsis_id       VARCHAR,
        player_name   VARCHAR,
        first_name    VARCHAR,
        last_name     VARCHAR,
        jersey_number VARCHAR,
        imported_at   TIMESTAMP,
        PRIMARY KEY (season, week, gsis_id, position)
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

    """

    for stmt in sql.split(";"):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)


if __name__ == "__main__":
    conn = get_conn()
    init_schema(conn)
    tables = conn.execute("SHOW TABLES").fetchall()
    print(f"Schema initialized — {len(tables)} tables")
    for (t,) in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"   {t}: {count:,} rows")
    conn.close()
