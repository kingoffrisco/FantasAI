"""
ADP Ingestion + Gold Consolidation — FantasyPros
Replaces: notebooks/01_Ingestion/Gold/ADP_Consolidation_Gold.py (Databricks)

Scrapes FantasyPros consensus ADP (PPR + Standard) via HTML table parsing.
DST rankings derived from Sleeper bronze data when FantasyPros DST is unavailable.

Outputs (DuckDB):
  bronze_adp_rankings  — raw ADP rows (PPR + Standard + DST)

Outputs (R2):
  players/adp_ppr.json             — top 200 PPR ADP rankings
  players/adp_standard.json        — top 200 Standard ADP rankings
  analysis/gold_adp_defense.json   — 32 DST teams ranked by ADP
  fantasai/analysis/gold_adp_defense.json  — same (frontend tries both paths)

Usage:
  python ingest_adp.py
  python ingest_adp.py --dry-run
  python ingest_adp.py --skip-scrape   # re-export from existing bronze data
"""

import argparse
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

FP_PAGES = {
    "PPR":      "https://www.fantasypros.com/nfl/adp/ppr-overall.php",
    "Standard": "https://www.fantasypros.com/nfl/adp/overall.php",
    "DST":      "https://www.fantasypros.com/nfl/adp/dst.php",
}

# ECR (Expert Consensus Rankings) — overall cheatsheets include all positions
FP_ECR_PAGES = {
    "ECR_PPR": "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
    "ECR_STD": "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php",
}

NFL_TEAM_NAME_TO_ABBR = {
    "arizona cardinals": "ARI", "atlanta falcons": "ATL", "baltimore ravens": "BAL",
    "buffalo bills": "BUF", "carolina panthers": "CAR", "chicago bears": "CHI",
    "cincinnati bengals": "CIN", "cleveland browns": "CLE", "dallas cowboys": "DAL",
    "denver broncos": "DEN", "detroit lions": "DET", "green bay packers": "GB",
    "houston texans": "HOU", "indianapolis colts": "IND", "jacksonville jaguars": "JAX",
    "kansas city chiefs": "KC", "las vegas raiders": "LV", "los angeles chargers": "LAC",
    "los angeles rams": "LAR", "miami dolphins": "MIA", "minnesota vikings": "MIN",
    "new england patriots": "NE", "new orleans saints": "NO", "new york giants": "NYG",
    "new york jets": "NYJ", "philadelphia eagles": "PHI", "pittsburgh steelers": "PIT",
    "san francisco 49ers": "SF", "seattle seahawks": "SEA", "tampa bay buccaneers": "TB",
    "tennessee titans": "TEN", "washington commanders": "WAS",
}

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fantasypros.com/",
}


# ── Scraping ──────────────────────────────────────────────────────────────────

def fetch_fp_ecr(format_name: str, url: str) -> list[dict]:
    """Fetch a FantasyPros consensus rankings page.
    Data is embedded as `var ecrData = {...}` in the page JS (no HTML table).
    Fields used: rank_ecr (overall), rank_ave (expert avg), player_position_id,
    player_team_id, player_name.
    """
    print(f"   Fetching {format_name} from FantasyPros…")
    try:
        resp = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"   WARNING {format_name}: fetch failed — {e}")
        return []

    import json as _json
    m = re.search(r"var ecrData\s*=\s*(\{.*?\});", resp.text, re.DOTALL)
    if not m:
        print(f"   WARNING {format_name}: ecrData not found in page")
        return []

    try:
        data = _json.loads(m.group(1))
    except Exception as e:
        print(f"   WARNING {format_name}: JSON parse error — {e}")
        return []

    players = data.get("players", [])
    if not players:
        print(f"   WARNING {format_name}: ecrData.players is empty")
        return []

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for p in players:
        name = str(p.get("player_name") or "").strip()
        team = str(p.get("player_team_id") or "").strip()
        pos  = str(p.get("player_position_id") or "").strip().upper()
        if not name or pos not in ("QB", "RB", "WR", "TE", "K", "DST"):
            continue
        try:
            ecr_rank = int(p["rank_ecr"])
        except (KeyError, TypeError, ValueError):
            continue
        try:
            ecr_avg = float(p.get("rank_ave") or ecr_rank)
        except (TypeError, ValueError):
            ecr_avg = float(ecr_rank)

        rows.append({
            "player_name": name,
            "position":    pos,
            "team":        team,
            "adp_rank":    ecr_rank,
            "adp_value":   ecr_avg,
            "format":      format_name,
            "source":      "fantasypros",
            "fetched_at":  now,
        })

    print(f"   {format_name}: {len(rows)} players parsed")
    return rows


def clean_player_name(raw: str) -> tuple[str, str]:
    """Return (player_name, team) from a FantasyPros player cell string.
    Handles: 'Ja''Marr Chase CIN (6)', 'CMC SF (BYE: 9)', 'KC DST'
    """
    # Strip bye week — both '(6)' and '(BYE: 9)' formats
    raw = re.sub(r"\s*\(\w*\s*:?\s*\d+\)", "", raw).strip()
    m = re.search(r"\b([A-Z]{2,3})\s*$", raw)
    if m:
        return raw[: m.start()].strip(), m.group(1)
    return raw, ""


def clean_position(raw: str) -> str:
    """Strip trailing rank digit from FantasyPros position column.
    'RB1' -> 'RB', 'WR22' -> 'WR', 'QB' -> 'QB'
    """
    return re.sub(r"\d+$", "", raw.strip().upper())


def fetch_fp_html(format_name: str, url: str) -> list[dict]:
    """Fetch FantasyPros ADP page and parse the HTML table."""
    print(f"   Fetching {format_name} from FantasyPros…")
    try:
        resp = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"   WARNING {format_name}: fetch failed — {e}")
        return []

    try:
        tables = pd.read_html(io.StringIO(resp.text))
    except Exception as e:
        print(f"   WARNING {format_name}: HTML parse failed — {e}")
        return []

    if not tables:
        print(f"   WARNING {format_name}: no tables found in HTML")
        return []

    # Pick the largest table (the ADP table)
    df = max(tables, key=len)

    # Normalize column names
    df.columns = [str(c).strip().lower() for c in df.columns]

    # Find player and rank columns
    player_col = next((c for c in df.columns if "player" in c), None)
    rank_col   = next((c for c in df.columns if c in ("rank", "#", "rk")), None)
    pos_col    = next((c for c in df.columns if c in ("pos", "position")), None)

    if player_col is None:
        print(f"   WARNING {format_name}: no player column found (cols={list(df.columns)[:6]})")
        return []

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for i, row in df.iterrows():
        raw_player = str(row.get(player_col, "")).strip()
        if not raw_player or raw_player.lower() in ("nan", "player"):
            continue

        player_name, team = clean_player_name(raw_player)
        if not player_name:
            continue

        # DST pages use full team names ("Houston Texans") instead of abbrs — resolve them
        if format_name == "DST" and not team:
            team = NFL_TEAM_NAME_TO_ABBR.get(player_name.lower(), "")
            if team:
                player_name = f"{team} D/ST"

        try:
            adp_rank = int(str(row[rank_col]).strip()) if rank_col else i + 1
        except (ValueError, TypeError):
            adp_rank = i + 1

        raw_pos = str(row.get(pos_col, "")).strip() if pos_col else ""
        position = clean_position(raw_pos) if raw_pos and raw_pos.upper() != "NAN" else ""
        if not position:
            position = "DST" if format_name == "DST" else "UNK"

        rows.append({
            "player_name": player_name,
            "position":    position,
            "team":        team,
            "adp_rank":    adp_rank,
            "adp_value":   float(adp_rank),
            "format":      format_name,
            "source":      "fantasypros",
            "fetched_at":  now,
        })

    print(f"   {format_name}: {len(rows)} players parsed")
    return rows


def build_dst_from_sleeper(conn) -> list[dict]:
    """Derive DST ADP from Sleeper bronze DEF position entries.
    Uses depth_chart_order and active flag to approximate ranking.
    """
    print("   Building DST rankings from Sleeper bronze data…")
    df = conn.execute("""
        SELECT team, player_name,
               COALESCE(depth_chart_order, 99) AS depth_order
        FROM bronze_player_news_raw
        WHERE position = 'DEF'
          AND team IS NOT NULL
          AND active = TRUE
        ORDER BY depth_order, team
    """).df()

    if df.empty:
        print("   WARNING: No DEF entries in bronze_player_news_raw")
        return []

    # One row per team, ranked alphabetically as a neutral fallback
    seen = set()
    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rank = 1
    for _, row in df.iterrows():
        team = row["team"]
        if team in seen:
            continue
        seen.add(team)
        rows.append({
            "player_name": f"{team} D/ST",
            "position":    "DST",
            "team":        team,
            "adp_rank":    rank,
            "adp_value":   float(rank),
            "format":      "DST",
            "source":      "sleeper_fallback",
            "fetched_at":  now,
        })
        rank += 1

    print(f"   DST fallback: {len(rows)} teams from Sleeper")
    return rows


# ── DuckDB write ──────────────────────────────────────────────────────────────

def write_bronze(conn, rows: list[dict], dry_run: bool):
    if not rows:
        return
    if dry_run:
        print("   DRY RUN — skipping bronze write")
        return

    df = pd.DataFrame(rows)
    for fmt in df["format"].unique():
        conn.execute("DELETE FROM bronze_adp_rankings WHERE format = ?", [fmt])
    conn.register("_adp", df)
    conn.execute("INSERT INTO bronze_adp_rankings BY NAME SELECT * FROM _adp")
    print(f"   bronze_adp_rankings: {len(rows)} rows written")


# ── R2 helpers ────────────────────────────────────────────────────────────────

def r2_put(key: str, payload, dry_run: bool):
    body = json.dumps(payload, default=str)
    size_kb = len(body.encode()) / 1024
    n = len(payload.get("players", payload.get("data", [])))
    print(f"   {key}  ({n} records, {size_kb:.1f} KB)")
    if dry_run:
        print("      DRY RUN")
        return
    if not FANTASAI_KEY:
        print("      SKIP — FANTASAI_KEY not set")
        return
    try:
        resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
        print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
    except Exception as e:
        print(f"      ERROR {e}")


# ── Export ────────────────────────────────────────────────────────────────────

def export_skill_adp(conn, dry_run: bool):
    now = datetime.now(timezone.utc).isoformat()
    for fmt, key in [("PPR", "players/adp_ppr.json"), ("Standard", "players/adp_standard.json")]:
        rows = conn.execute("""
            SELECT player_name, position, team, adp_rank, adp_value
            FROM bronze_adp_rankings
            WHERE format = ?
              AND position IN ('QB','RB','WR','TE')
            ORDER BY adp_rank
            LIMIT 200
        """, [fmt]).df().to_dict(orient="records")

        if not rows:
            print(f"   SKIP {key} — no {fmt} data")
            continue
        r2_put(key, {"generated_at": now, "format": fmt, "source": "fantasypros", "players": rows}, dry_run)


def export_ecr(conn, dry_run: bool):
    now = datetime.now(timezone.utc).isoformat()
    for fmt, key, label in [
        ("ECR_PPR", "players/ecr_ppr.json", "PPR"),
        ("ECR_STD", "players/ecr_std.json", "Standard"),
    ]:
        rows = conn.execute("""
            SELECT
                CASE WHEN position = 'DST' AND team != ''
                     THEN team || ' D/ST'
                     ELSE player_name
                END AS player_name,
                position, team,
                adp_rank  AS ecr_rank,
                adp_value AS ecr_avg
            FROM bronze_adp_rankings
            WHERE format = ?
              AND position IN ('QB','RB','WR','TE','K','DST')
            ORDER BY adp_rank
            LIMIT 500
        """, [fmt]).df().to_dict(orient="records")

        if not rows:
            print(f"   SKIP {key} — no {fmt} data in bronze_adp_rankings")
            continue
        payload = {
            "generated_at": now,
            "format": fmt,
            "scoring": label,
            "source": "fantasypros",
            "players": rows,
        }
        r2_put(key, payload, dry_run)


def export_defense_adp(conn, dry_run: bool):
    now = datetime.now(timezone.utc).isoformat()

    rows = conn.execute("""
        SELECT team, adp_rank, adp_value, source
        FROM bronze_adp_rankings
        WHERE format = 'DST'
        ORDER BY adp_rank
    """).df()

    if rows.empty:
        print("   SKIP gold_adp_defense.json — no DST data in bronze_adp_rankings")
        return

    records = rows[["team", "adp_rank"]].rename(columns={"adp_rank": "adp_rank"}).to_dict(orient="records")
    # Add null avg_pts fields (would need DST weekly stats to populate)
    for r in records:
        r["avg_pts"] = None
        r["avg_last_4_weeks"] = None

    payload = {"generated_at": now, "source": rows["source"].iloc[0], "data": records}
    r2_put("analysis/gold_adp_defense.json", payload, dry_run)
    r2_put("fantasai/analysis/gold_adp_defense.json", payload, dry_run)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",     action="store_true")
    parser.add_argument("--skip-scrape", action="store_true",
                        help="Re-export from existing bronze_adp_rankings (skip FantasyPros fetch)")
    args = parser.parse_args()

    print("=" * 70)
    print("ADP Ingestion — FantasyPros")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    if not args.skip_scrape:
        print("\n── Scraping FantasyPros ADP ──────────────────────────────────────────")
        all_rows: list[dict] = []

        for fmt, url in FP_PAGES.items():
            rows = fetch_fp_html(fmt, url)
            if not rows and fmt == "DST":
                rows = build_dst_from_sleeper(conn)
            all_rows.extend(rows)
            time.sleep(1.5)

        if all_rows:
            write_bronze(conn, all_rows, args.dry_run)
        else:
            print("   WARNING: No ADP data — using Sleeper fallback for DST only")
            dst_rows = build_dst_from_sleeper(conn)
            write_bronze(conn, dst_rows, args.dry_run)

        print("\n── Scraping FantasyPros ECR ──────────────────────────────────────────")
        ecr_rows: list[dict] = []
        for fmt, url in FP_ECR_PAGES.items():
            rows = fetch_fp_ecr(fmt, url)
            ecr_rows.extend(rows)
            time.sleep(1.5)
        if ecr_rows:
            write_bronze(conn, ecr_rows, args.dry_run)
        else:
            print("   WARNING: No ECR data scraped")
    else:
        count = conn.execute(
            "SELECT COUNT(*) FROM bronze_adp_rankings"
        ).fetchone()[0]
        print(f"\n── Using existing bronze_adp_rankings ({count} rows) ─────────────")

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_skill_adp(conn, args.dry_run)
    export_defense_adp(conn, args.dry_run)
    export_ecr(conn, args.dry_run)

    conn.close()
    print("\n✅ ADP ingestion complete")


if __name__ == "__main__":
    main()
