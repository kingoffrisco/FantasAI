"""
R2 Export — Push DuckDB tables to Cloudflare R2 via Worker API
Replaces:
  notebooks/06_Exports/Export Fantasy News to R2.ipynb
  notebooks/05_Scheduled_Jobs/R2 Export - Analysis Data.ipynb
  databricks/r2_export.py

All uploads use the existing Worker API pattern:
  PUT https://api.fantasai.net/api/v1/r2/{key}
  Header: X-FantasAI-Key: <FANTASAI_KEY>

R2 keys match the paths the frontend already reads.

Usage:
  python export_to_r2.py                    # all exports
  python export_to_r2.py --only news        # just news exports
  python export_to_r2.py --only analysis    # just analysis exports
  python export_to_r2.py --dry-run          # print what would be uploaded
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

WORKER_API   = "https://api.fantasai.net"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set in .env")
    sys.exit(1)

HEADERS = {
    "Content-Type":  "application/json",
    "X-FantasAI-Key": FANTASAI_KEY,
}

errors: list[str] = []


# ── R2 upload helper ──────────────────────────────────────────────────────────

def r2_put(key: str, payload: Any, dry_run: bool) -> bool:
    """PUT a JSON payload to R2 via Worker API."""
    body = json.dumps(payload, default=str)
    size_kb = len(body.encode()) / 1024
    n = len(payload) if isinstance(payload, list) else (
        len(payload.get("data", [])) if isinstance(payload, dict) else "?")
    print(f"   📤 {key}  ({n} records, {size_kb:.1f} KB)")

    if dry_run:
        print(f"      🔵 dry-run — not uploading")
        return True

    try:
        url = f"{WORKER_API}/api/v1/r2/{key}"
        r = requests.put(url, data=body, headers=HEADERS, timeout=30)
        if r.ok:
            print(f"      ✅ uploaded")
            return True
        else:
            msg = f"{key}: HTTP {r.status_code} — {r.text[:200]}"
            print(f"      ❌ {msg}")
            errors.append(msg)
            return False
    except Exception as e:
        msg = f"{key}: {e}"
        print(f"      ❌ {msg}")
        errors.append(msg)
        return False


def clean_nan(obj):
    """Recursively replace float NaN with None for JSON safety."""
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(i) for i in obj]
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


def q(conn, sql: str, params=None) -> list[dict]:
    """Execute query and return list of dicts."""
    result = conn.execute(sql, params or []).df()
    records = result.to_dict(orient="records")
    return clean_nan(records)


def wrap(records: list[dict], source_table: str, **extra) -> dict:
    return {
        "data": records,
        "metadata": {
            "total": len(records),
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "source": source_table,
            **extra,
        }
    }


# ── News exports ──────────────────────────────────────────────────────────────

def export_news(conn, dry_run: bool):
    print("\n── News Exports ──────────────────────────────────────────────────────")

    # 1. Player Notes (from silver_injury_reports + silver_player_news)
    player_notes = q(conn, """
        SELECT
            n.player_id,
            n.player_name,
            n.position,
            n.team,
            i.injury_status,
            i.injury_notes,
            i.injury_body_part,
            n.news_updated,
            n.depth_chart_order,
            n.depth_chart_position,
            n.fetched_at
        FROM silver_player_news n
        LEFT JOIN silver_injury_reports i ON n.player_id = i.player_id
        ORDER BY
            CASE WHEN i.injury_status IS NOT NULL THEN 0 ELSE 1 END,
            n.position, n.player_name
        LIMIT 300
    """)
    shaped_notes = []
    for r in player_notes:
        shaped_notes.append({
            "player_id":    r["player_id"],
            "player_name":  r["player_name"],
            "position":     r["position"],
            "team":         r["team"],
            "notes": [{
                "note_text":        r.get("injury_notes") or f"{r['player_name']} — updated",
                "priority":         "critical" if r.get("injury_status") in ("Out", "Injured_Reserve") else
                                    "high"     if r.get("injury_status") in ("Doubtful", "Non_Football_Injury") else
                                    "medium",
                "impact_direction": "negative" if r.get("injury_status") else "neutral",
                "published_at":     r.get("news_updated"),
            }],
            "has_injury_concern":   r.get("injury_status") is not None,
            "has_critical_news":    r.get("injury_status") in ("Out", "Injured_Reserve"),
            "last_updated":         r.get("news_updated") or r.get("fetched_at"),
            "overall_impact_score": 80 if r.get("injury_status") in ("Out", "Injured_Reserve") else
                                    60 if r.get("injury_status") else 30,
        })
    r2_put("fantasai/news/player_notes.json", shaped_notes, dry_run)

    # 2. Injury report
    injuries = q(conn, """
        SELECT player_name, position, team,
               injury_status, injury_body_part AS body_part,
               injury_notes AS notes, fetched_at AS updated_at
        FROM silver_injury_reports
        ORDER BY position, player_name
        LIMIT 300
    """)
    r2_put("fantasai/analysis/injury_report.json", injuries, dry_run)

    # 3. Critical alerts
    alerts = q(conn, """
        SELECT player_id, player_name, position, team,
               injury_status, injury_notes, fetched_at
        FROM silver_injury_reports
        WHERE injury_status IN ('Out','Injured_Reserve','Non_Football_Injury','Doubtful')
        ORDER BY fetched_at DESC
        LIMIT 50
    """)
    shaped_alerts = []
    for r in alerts:
        is_crit = r["injury_status"] in ("Out", "Injured_Reserve", "Non_Football_Injury")
        shaped_alerts.append({
            "summary_text":    f"{r['player_name']} — {r['injury_status']}. {r.get('injury_notes','') or ''}".strip(". "),
            "fantasy_insight": (f"Consider dropping or replacing {r['player_name']} on waivers."
                                if is_crit else
                                f"Monitor {r['player_name']}'s practice status before locking lineup."),
            "priority_level":  "critical" if is_crit else "high",
            "is_time_sensitive": True,
            "impacted_players": [{"player_name": r["player_name"]}],
            "generated_at":    r.get("fetched_at"),
        })
    r2_put("fantasai/news/critical_alerts.json", shaped_alerts, dry_run)

    # 4. Enriched news (combined: ESPN + Google + Transactions rolled up)
    espn_news = q(conn, """
        SELECT article_id AS news_id, headline, article_url AS source_url,
               description AS full_text, player_name, published_at, 'espn' AS source_name
        FROM bronze_player_news_espn_api
        ORDER BY published_at DESC
        LIMIT 200
    """)
    google_news = q(conn, """
        SELECT article_id AS news_id, title AS headline, link AS source_url,
               description AS full_text, player_name, published_at, source AS source_name
        FROM bronze_google_news
        ORDER BY published_at DESC
        LIMIT 200
    """)
    all_news = sorted(espn_news + google_news,
                      key=lambda x: x.get("published_at") or "", reverse=True)[:200]
    r2_put("fantasai/news/enriched_news.json", wrap(all_news, "bronze_player_news_espn_api+bronze_google_news"), dry_run)

    # 5. Combined player news for frontend (main news feed)
    # Prefers ESPN articles; falls back to Google
    combined = q(conn, """
        SELECT
            article_id AS news_id,
            headline,
            article_url AS source_url,
            description AS full_text,
            player_id,
            player_name,
            NULL AS position,
            NULL AS team,
            NULL AS summary_text,
            NULL AS fantasy_insight,
            NULL AS impact_score,
            NULL AS impact_category,
            published_at,
            fetched_at AS enriched_at,
            NULL AS ai_generated_at
        FROM bronze_player_news_espn_api
        ORDER BY published_at DESC
        LIMIT 500
    """)
    extra = q(conn, """
        SELECT
            article_id AS news_id,
            title AS headline,
            link AS source_url,
            description AS full_text,
            player_id,
            player_name,
            position,
            team,
            NULL AS summary_text,
            NULL AS fantasy_insight,
            NULL AS impact_score,
            NULL AS impact_category,
            published_at,
            fetched_at AS enriched_at,
            NULL AS ai_generated_at
        FROM bronze_google_news
        ORDER BY published_at DESC
        LIMIT 500
    """)
    combined = sorted(combined + extra,
                      key=lambda x: x.get("published_at") or "", reverse=True)

    # Tier 2/3: Team RSS articles (covers deep players outside top 200)
    has_rss = conn.execute(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'bronze_team_rss_news'"
    ).fetchone()[0] > 0
    if has_rss:
        rss = q(conn, """
            SELECT
                article_id AS news_id,
                title AS headline,
                link AS source_url,
                description AS full_text,
                player_id,
                player_name,
                position,
                team,
                NULL AS summary_text,
                NULL AS fantasy_insight,
                NULL AS impact_score,
                NULL AS impact_category,
                published_at,
                fetched_at AS enriched_at,
                NULL AS ai_generated_at
            FROM bronze_team_rss_news
            WHERE player_name IS NOT NULL
            ORDER BY published_at DESC
            LIMIT 500
        """)
        combined = sorted(combined + rss,
                          key=lambda x: x.get("published_at") or "", reverse=True)

    combined = combined[:1000]
    r2_put("fantasai/analysis/player_news.json", wrap(combined, "bronze_player_news_espn_api"), dry_run)


# ── Analysis exports ───────────────────────────────────────────────────────────

def export_analysis(conn, dry_run: bool):
    print("\n── Analysis Exports ──────────────────────────────────────────────────")

    # 0. College stats (CFBD) — for rookie profiles in draft room
    has_cfbd = conn.execute(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'bronze_cfbd_player_stats'"
    ).fetchone()[0] > 0
    if has_cfbd:
        cfbd = q(conn, "SELECT * FROM bronze_cfbd_player_stats ORDER BY player_name, season")
        r2_put("fantasai/analysis/college_stats.json", cfbd, dry_run)
    else:
        print("   ⚠️  No CFBD data — skipping college_stats export")

    # 1. Breakout candidates — from gold_weekly_stats (snap delta proxy)
    breakout = q(conn, """
        SELECT
            g.player_name, g.team, g.position,
            g.week, g.season,
            g.fantasy_points AS opportunity_score,
            NULL AS snap_share_delta,
            NULL AS avg_snap_share
        FROM gold_weekly_stats g
        INNER JOIN (
            SELECT master_player_id, MAX(season * 100 + week) AS latest_week_key
            FROM gold_weekly_stats
            GROUP BY master_player_id
        ) lw ON g.master_player_id = lw.master_player_id
             AND g.season * 100 + g.week = lw.latest_week_key
        WHERE g.position IN ('QB','RB','WR','TE')
          AND g.fantasy_points > 8
        ORDER BY g.fantasy_points DESC
        LIMIT 30
    """)
    r2_put("fantasai/analysis/breakout_candidates.json", breakout, dry_run)

    # 1b. Defense vs Position rankings (2025 season)
    # Cross-references silver_weekly_stats with bronze_nfl_schedules to compute
    # how many fantasy points each defense allows per position per game.
    has_schedules = conn.execute(
        "SELECT COUNT(*) FROM bronze_nfl_schedules WHERE season = 2025"
    ).fetchone()[0]
    if has_schedules:
        def_vs_pos = q(conn, """
            WITH player_vs_def AS (
                SELECT
                    s.position,
                    UPPER(TRIM(
                        CASE
                            WHEN UPPER(TRIM(s.team)) = UPPER(TRIM(g.home_team)) THEN g.away_team
                            WHEN UPPER(TRIM(s.team)) = UPPER(TRIM(g.away_team)) THEN g.home_team
                        END
                    )) AS def_team,
                    s.fantasy_points
                FROM silver_weekly_stats s
                JOIN bronze_nfl_schedules g
                    ON s.week = g.week AND s.season = g.season
                   AND (
                       UPPER(TRIM(s.team)) = UPPER(TRIM(g.home_team))
                    OR UPPER(TRIM(s.team)) = UPPER(TRIM(g.away_team))
                   )
                WHERE s.season = 2025
                  AND s.fantasy_points > 0
                  AND s.position IN ('QB','RB','WR','TE','K')
            ),
            agg AS (
                SELECT
                    def_team,
                    position,
                    ROUND(AVG(fantasy_points), 2)  AS avg_pts_allowed,
                    COUNT(*)                        AS sample_size
                FROM player_vs_def
                WHERE def_team IS NOT NULL
                GROUP BY def_team, position
            ),
            ranked AS (
                SELECT
                    def_team,
                    position,
                    avg_pts_allowed,
                    sample_size,
                    CAST(RANK() OVER (PARTITION BY position ORDER BY avg_pts_allowed ASC)  AS INTEGER) AS rank_vs_pos
                FROM agg
            )
            SELECT def_team, position, avg_pts_allowed, sample_size, rank_vs_pos
            FROM ranked
            ORDER BY position, rank_vs_pos
        """)
        r2_put("fantasai/analysis/defense_vs_pos.json",
               {"source": "silver_weekly_stats+bronze_nfl_schedules", "season": 2025,
                "data": def_vs_pos}, dry_run)
    else:
        print("   ⚠️  No 2025 schedule data — skipping defense_vs_pos export")

    # 2. Player profiles from Sleeper + DSTs from ADP rankings
    # Kickers (K) are in bronze_player_news_raw (Sleeper tracks them as players).
    # DSTs are NOT — Sleeper stores teams separately, so we pull them from
    # bronze_adp_rankings where format='DST' (populated by ingest_adp.py).
    players_draft = q(conn, """
        WITH stats_2025 AS (
            SELECT
                LOWER(TRIM(player_name))              AS name_key,
                ROUND(SUM(fantasy_points), 1)         AS season_total_points_2025,
                ROUND(AVG(CASE WHEN fantasy_points > 0 THEN fantasy_points END), 1)
                                                      AS season_avg_points_2025,
                COUNT(CASE WHEN fantasy_points > 0 THEN 1 END)
                                                      AS games_played_2025,
                ROUND(ARG_MAX(fantasy_points, week), 1) AS last_pts,
                list(ROUND(fantasy_points, 1) ORDER BY week ASC)
                                                      AS trend
            FROM silver_weekly_stats
            WHERE season = 2025
            GROUP BY LOWER(TRIM(player_name))
        ),
        dst_stats_2025 AS (
            SELECT
                UPPER(TRIM(team))                     AS team_key,
                ROUND(SUM(pts_ppr), 1)                AS season_total_points_2025,
                ROUND(AVG(CASE WHEN pts_ppr > 0 THEN pts_ppr END), 1)
                                                      AS season_avg_points_2025,
                COUNT(CASE WHEN pts_ppr > 0 THEN 1 END) AS games_played_2025,
                ROUND(ARG_MAX(pts_ppr, week), 1)      AS last_pts,
                list(ROUND(pts_ppr, 1) ORDER BY week ASC)
                                                      AS trend
            FROM bronze_dst_weekly_stats
            WHERE season = 2025
            GROUP BY UPPER(TRIM(team))
        ),
        yac_2025 AS (
            SELECT
                y.gsis_id,
                ROUND(SUM(y.total_yac), 1)            AS yac,
                ROUND(SUM(y.air_yards), 1)            AS air_yards
            FROM player_yac_stats y
            WHERE y.season = 2025
            GROUP BY y.gsis_id
        ),
        nextgen_2025 AS (
            SELECT
                LOWER(TRIM(ng.player_name))           AS name_key,
                ng.gsis_id,
                ROUND(ng.avg_intended_air_yards, 1)   AS adot,
                ng.targets,
                ROUND(ng.percent_share_of_intended_air_yards, 1) AS target_share,
                COALESCE(y.yac, 0)                    AS yac,
                COALESCE(y.air_yards, 0)              AS air_yards
            FROM player_nextgen_stats ng
            LEFT JOIN yac_2025 y ON ng.gsis_id = y.gsis_id
            WHERE ng.season = 2025 AND ng.week = 0
        ),
        combine AS (
            SELECT
                LOWER(TRIM(player_name))              AS name_key,
                forty,
                vertical,
                broad_jump,
                bench,
                wt                                    AS combine_weight,
                cone,
                shuttle,
                draft_round                           AS combine_draft_round,
                draft_ovr                             AS combine_draft_ovr
            FROM bronze_combine_data
            WHERE forty IS NOT NULL OR vertical IS NOT NULL
        ),
        team_tgt_2025 AS (
            SELECT team, week,
                SUM(CAST(json_extract_string(stats, '$.rec_tgt') AS DOUBLE)) AS team_targets
            FROM gold_weekly_stats
            WHERE season = 2025 AND stats IS NOT NULL AND position IN ('RB','WR','TE')
            GROUP BY team, week
        ),
        snap_2025 AS (
            SELECT
                LOWER(TRIM(g.player_name))            AS name_key,
                ROUND(AVG(CAST(json_extract_string(g.stats, '$.off_snp') AS DOUBLE)), 1) AS avg_snaps,
                ROUND(AVG(CASE WHEN CAST(json_extract_string(g.stats, '$.tm_off_snp') AS DOUBLE) > 0
                    THEN CAST(json_extract_string(g.stats, '$.off_snp') AS DOUBLE) / CAST(json_extract_string(g.stats, '$.tm_off_snp') AS DOUBLE) * 100
                    ELSE NULL END), 1)                AS snap_pct,
                ROUND(AVG(CAST(json_extract_string(g.stats, '$.rec_tgt') AS DOUBLE)), 1) AS avg_targets_g,
                ROUND(AVG(CAST(json_extract_string(g.stats, '$.rush_att') AS DOUBLE)), 1) AS avg_carries_g,
                ROUND(AVG(CAST(json_extract_string(g.stats, '$.rush_rz_att') AS DOUBLE)), 1) AS avg_rz_att_g,
                ROUND(AVG(COALESCE(CAST(json_extract_string(g.stats, '$.rec_yd') AS DOUBLE), 0) + COALESCE(CAST(json_extract_string(g.stats, '$.rush_yd') AS DOUBLE), 0)), 1) AS combo_yds_g,
                ROUND(CASE WHEN SUM(CAST(json_extract_string(g.stats, '$.rec_tgt') AS DOUBLE)) > 0
                    THEN SUM(CAST(json_extract_string(g.stats, '$.rec_yd') AS DOUBLE)) / SUM(CAST(json_extract_string(g.stats, '$.rec_tgt') AS DOUBLE))
                    ELSE NULL END, 1)                 AS yds_per_tgt,
                ROUND(AVG(CASE WHEN tt.team_targets > 0
                    THEN CAST(json_extract_string(g.stats, '$.rec_tgt') AS DOUBLE) / tt.team_targets * 100
                    ELSE NULL END), 1)                AS real_target_share
            FROM gold_weekly_stats g
            LEFT JOIN team_tgt_2025 tt ON g.team = tt.team AND g.week = tt.week
            WHERE g.season = 2025 AND g.stats IS NOT NULL
            GROUP BY LOWER(TRIM(g.player_name))
        )
        SELECT
            p.player_id       AS master_player_id,
            p.player_name     AS full_name,
            p.position,
            p.team,
            p.years_exp,
            CASE WHEN p.years_exp = 0 THEN TRUE ELSE FALSE END AS is_rookie,
            p.age,
            p.depth_chart_order,
            p.depth_chart_position,
            s.season_total_points_2025,
            s.season_avg_points_2025,
            s.games_played_2025,
            s.last_pts,
            s.trend,
            NULL              AS adp_rank,
            ng.yac,
            ng.air_yards,
            ng.adot,
            COALESCE(sn.real_target_share, ng.target_share) AS target_share,
            ng.targets         AS routes,
            sn.avg_snaps,
            sn.snap_pct,
            sn.avg_targets_g,
            sn.avg_carries_g,
            sn.avg_rz_att_g,
            sn.combo_yds_g,
            sn.yds_per_tgt,
            cb.forty,
            cb.vertical,
            cb.broad_jump,
            cb.bench         AS bench_press,
            cb.combine_weight,
            cb.cone,
            cb.shuttle,
            cb.combine_draft_round,
            cb.combine_draft_ovr
        FROM bronze_player_news_raw p
        LEFT JOIN stats_2025 s ON LOWER(TRIM(p.player_name)) = s.name_key
        LEFT JOIN nextgen_2025 ng ON LOWER(TRIM(p.player_name)) = ng.name_key
        LEFT JOIN snap_2025 sn ON LOWER(TRIM(p.player_name)) = sn.name_key
        LEFT JOIN combine cb ON LOWER(TRIM(p.player_name)) = cb.name_key
        WHERE p.position IN ('QB','RB','WR','TE','K')
          AND p.active = TRUE
          AND (
            (p.team IS NOT NULL AND (s.games_played_2025 > 0 OR p.depth_chart_order IS NOT NULL OR COALESCE(p.years_exp, 0) < 3))
            OR s.games_played_2025 >= 5
          )

        UNION ALL

        SELECT
            dst.dst_team     AS master_player_id,
            dst.dst_team || ' D/ST' AS full_name,
            'DST'            AS position,
            dst.dst_team     AS team,
            NULL             AS years_exp,
            FALSE            AS is_rookie,
            NULL             AS age,
            NULL             AS depth_chart_order,
            NULL             AS depth_chart_position,
            d.season_total_points_2025,
            d.season_avg_points_2025,
            d.games_played_2025,
            d.last_pts,
            d.trend,
            dst.adp_rank,
            NULL AS yac,
            NULL AS air_yards,
            NULL AS adot,
            NULL AS target_share,
            NULL AS routes,
            NULL AS avg_snaps,
            NULL AS snap_pct,
            NULL AS avg_targets_g,
            NULL AS avg_carries_g,
            NULL AS avg_rz_att_g,
            NULL AS combo_yds_g,
            NULL AS yds_per_tgt,
            NULL AS forty,
            NULL AS vertical,
            NULL AS broad_jump,
            NULL AS bench_press,
            NULL AS combine_weight,
            NULL AS cone,
            NULL AS shuttle,
            NULL AS combine_draft_round,
            NULL AS combine_draft_ovr
        FROM (
            WITH team_name_map(full_name, abbr) AS (
                VALUES
                    ('Arizona Cardinals','ARI'),('Atlanta Falcons','ATL'),
                    ('Baltimore Ravens','BAL'),('Buffalo Bills','BUF'),
                    ('Carolina Panthers','CAR'),('Chicago Bears','CHI'),
                    ('Cincinnati Bengals','CIN'),('Cleveland Browns','CLE'),
                    ('Dallas Cowboys','DAL'),('Denver Broncos','DEN'),
                    ('Detroit Lions','DET'),('Green Bay Packers','GB'),
                    ('Houston Texans','HOU'),('Indianapolis Colts','IND'),
                    ('Jacksonville Jaguars','JAX'),('Kansas City Chiefs','KC'),
                    ('Las Vegas Raiders','LV'),('Los Angeles Chargers','LAC'),
                    ('Los Angeles Rams','LAR'),('Miami Dolphins','MIA'),
                    ('Minnesota Vikings','MIN'),('New England Patriots','NE'),
                    ('New Orleans Saints','NO'),('New York Giants','NYG'),
                    ('New York Jets','NYJ'),('Philadelphia Eagles','PHI'),
                    ('Pittsburgh Steelers','PIT'),('San Francisco 49ers','SF'),
                    ('Seattle Seahawks','SEA'),('Tampa Bay Buccaneers','TB'),
                    ('Tennessee Titans','TEN'),('Washington Commanders','WAS')
            )
            SELECT
                CASE
                    WHEN b.team != '' AND b.team IS NOT NULL THEN b.team
                    ELSE m.abbr
                END AS dst_team,
                MIN(b.adp_rank) AS adp_rank
            FROM bronze_adp_rankings b
            LEFT JOIN team_name_map m ON LOWER(b.player_name) = LOWER(m.full_name)
            WHERE b.format = 'DST'
            GROUP BY dst_team
            HAVING dst_team IS NOT NULL AND dst_team != ''
        ) dst
        LEFT JOIN dst_stats_2025 d ON UPPER(dst.dst_team) = d.team_key

        ORDER BY position, full_name
    """)
    players_draft_payload = wrap(players_draft, "bronze_player_news_raw", season=2026)
    r2_put("fantasai/players/export_players_2026_draft.json", players_draft_payload, dry_run)
    r2_put("fantasai/players/players_2026_draft.json", players_draft_payload, dry_run)

    # 2b. Per-player 2025 season totals (aggregated from silver_weekly_stats Sleeper data)
    # Used by frontend as offline fallback for the Next Gen Stats panel
    _STAT_FIELDS = [
        "pass_yd","pass_td","pass_att","pass_cmp","pass_int","pass_air_yd",
        "rush_yd","rush_td","rush_att","rush_yac","rush_ybc",
        "rec","rec_tgt","rec_yd","rec_td","rec_air_yd","rec_yac",
        "pts_ppr","pts_half_ppr","pts_std",
    ]
    _stat_sums = ",\n            ".join(
        f"ROUND(SUM(TRY_CAST(json_extract_string(stats,'$.{f}') AS DOUBLE)),1) AS {f}"
        for f in _STAT_FIELDS
    )
    player_stats_2025_rows = q(conn, f"""
        SELECT
            player_id,
            player_name,
            position,
            team,
            COUNT(CASE WHEN fantasy_points > 0 THEN 1 END) AS gp,
            {_stat_sums}
        FROM silver_weekly_stats
        WHERE season = 2025
        GROUP BY player_id, player_name, position, team
        HAVING gp > 0
        ORDER BY pts_half_ppr DESC NULLS LAST
    """)
    # Key by player_id for O(1) frontend lookup
    stats_by_id = {r["player_id"]: {k: v for k, v in r.items() if k != "player_id"}
                   for r in player_stats_2025_rows}
    r2_put("fantasai/analysis/player_stats_2025.json",
           {"source": "silver_weekly_stats", "season": 2025, "players": stats_by_id}, dry_run)

    # 3. Weekly stats
    weekly_stats = q(conn, """
        SELECT
            master_player_id, source_player_id, source,
            season, week, fantasy_points,
            player_name, position, team,
            receiving_yards_after_catch,
            passing_yards_after_catch,
            headshot_url
        FROM gold_weekly_stats
        ORDER BY season DESC, week DESC
        LIMIT 5000
    """)
    r2_put("fantasai/stats/gold_weekly_stats.json",
           wrap(weekly_stats, "gold_weekly_stats"), dry_run)

    # 4. NFL transactions
    transactions = q(conn, """
        SELECT transaction_date, transaction_type, player_name,
               position, team, description, fetched_at
        FROM bronze_nfl_transactions
        WHERE transaction_date >= NOW() - INTERVAL '30 DAYS'
        ORDER BY transaction_date DESC
        LIMIT 200
    """)
    r2_put("fantasai/analysis/nfl_transactions.json",
           wrap(transactions, "bronze_nfl_transactions"), dry_run)

    # 5. Trending players
    trending = q(conn, """
        SELECT player_name, position, team, count AS add_count, fetched_at
        FROM silver_trending_players
        ORDER BY count DESC
        LIMIT 50
    """)
    trending_payload = wrap(trending, "silver_trending_players")
    r2_put("fantasai/analysis/trending_players.json", trending_payload, dry_run)
    r2_put("analysis/sleeper_picks.json", trending_payload, dry_run)

    # 6. Injury overlay (for UI per-player overlay)
    injury_overlay = q(conn, """
        SELECT
            n.player_id, n.player_name, n.position, n.team,
            n.news_updated, n.injury_status, n.injury_notes,
            n.status, n.depth_chart_order, n.depth_chart_position, n.fetched_at
        FROM silver_player_news n
        ORDER BY
            CASE WHEN n.injury_status IS NOT NULL THEN 0 ELSE 1 END,
            n.team, n.depth_chart_order
    """)
    r2_put("fantasai/players/injury_overlay.json",
           wrap(injury_overlay, "silver_player_news"), dry_run)

    # 7. Performance trends — last-4-week avg vs season avg per player
    # Shows who is trending up/down. Empty when gold_weekly_stats is empty.
    has_stats = conn.execute("SELECT COUNT(*) FROM gold_weekly_stats").fetchone()[0]
    if has_stats:
        trends = q(conn, """
            WITH season_avg AS (
                SELECT master_player_id, player_name, position, team,
                       AVG(fantasy_points) AS season_avg,
                       COUNT(*) AS games_played,
                       MAX(season) AS season
                FROM gold_weekly_stats
                WHERE position IN ('QB','RB','WR','TE')
                GROUP BY master_player_id, player_name, position, team
            ),
            recent_weeks AS (
                SELECT master_player_id,
                       AVG(fantasy_points) AS avg_last_4,
                       COUNT(*) AS recent_games
                FROM (
                    SELECT master_player_id, fantasy_points,
                           ROW_NUMBER() OVER (PARTITION BY master_player_id ORDER BY season DESC, week DESC) AS rn
                    FROM gold_weekly_stats
                    WHERE position IN ('QB','RB','WR','TE')
                ) ranked
                WHERE rn <= 4
                GROUP BY master_player_id
            )
            SELECT
                s.player_name, s.position, s.team, s.season,
                s.games_played,
                ROUND(s.season_avg, 2) AS season_avg,
                ROUND(r.avg_last_4, 2) AS avg_last_4_weeks,
                ROUND(r.avg_last_4 - s.season_avg, 2) AS trend_delta,
                CASE
                    WHEN r.avg_last_4 - s.season_avg > 2  THEN 'up'
                    WHEN r.avg_last_4 - s.season_avg < -2 THEN 'down'
                    ELSE 'stable'
                END AS trend_direction
            FROM season_avg s
            JOIN recent_weeks r ON s.master_player_id = r.master_player_id
            WHERE s.games_played >= 4
            ORDER BY trend_delta DESC
            LIMIT 200
        """)
        r2_put("fantasai/analysis/performance_trends.json",
               wrap(trends, "gold_weekly_stats"), dry_run)
    else:
        print("   performance_trends.json — skipped (gold_weekly_stats empty)")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only",    choices=["news", "analysis", "all"], default="all")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("R2 Export — DuckDB → Cloudflare R2")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    run_all = args.only == "all"
    if run_all or args.only == "news":     export_news(conn, args.dry_run)
    if run_all or args.only == "analysis": export_analysis(conn, args.dry_run)

    conn.close()

    print(f"\n{'=' * 70}")
    if errors:
        print(f"❌ Export finished with {len(errors)} error(s):")
        for e in errors:
            print(f"   • {e}")
        sys.exit(1)
    else:
        print(f"✅ Export complete — all R2 keys updated")


if __name__ == "__main__":
    main()
