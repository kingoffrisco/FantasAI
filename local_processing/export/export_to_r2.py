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
    if len(combined) < 100:
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
                          key=lambda x: x.get("published_at") or "", reverse=True)[:1000]
    r2_put("fantasai/analysis/player_news.json", wrap(combined, "bronze_player_news_espn_api"), dry_run)


# ── Analysis exports ───────────────────────────────────────────────────────────

def export_analysis(conn, dry_run: bool):
    print("\n── Analysis Exports ──────────────────────────────────────────────────")

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

    # 2. Player profiles from Sleeper (export_players_2026_draft equivalent)
    players_draft = q(conn, """
        SELECT
            player_id AS master_player_id,
            player_name AS full_name,
            position,
            team,
            years_exp,
            CASE WHEN years_exp = 0 THEN TRUE ELSE FALSE END AS is_rookie,
            age,
            depth_chart_order,
            depth_chart_position,
            NULL AS season_total_points_2025,
            NULL AS season_avg_points_2025,
            NULL AS games_played_2025
        FROM bronze_player_news_raw
        WHERE position IN ('QB','RB','WR','TE','K')
          AND team IS NOT NULL
          AND active = TRUE
        ORDER BY position, player_name
    """)
    players_draft_payload = wrap(players_draft, "bronze_player_news_raw", season=2026)
    r2_put("fantasai/players/export_players_2026_draft.json", players_draft_payload, dry_run)
    r2_put("fantasai/players/players_2026_draft.json", players_draft_payload, dry_run)

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
