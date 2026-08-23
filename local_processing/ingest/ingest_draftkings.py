"""
DraftKings DFS Ingestion — NFL Slates, Players, Salaries
New (2026-08-22).

DraftKings does not publish or support a public developer API. This script
uses the same class of endpoint the DraftKings website itself calls — the
same risk class as the ESPN endpoints that started 403-ing Cloudflare
Workers' shared egress IPs on 2026-08-20 (see job_live_scores.py). These
endpoints can change shape or start blocking requests without notice.
Run this from the local machine, not from a Cloudflare Worker.

Verified live 2026-08-22:
  GET https://www.draftkings.com/lobby/getcontests?sport=NFL
      -> list of open NFL contests, each with a draft group id ("dg")
  GET https://api.draftkings.com/draftgroups/v1/draftgroups/{id}/draftables
      -> full player pool for that slate: salary, position, team, status

Two DK data systems exist; this script only covers DFS (salaries/slates),
not DK Sportsbook odds/props — that's a different, unverified endpoint
family and is intentionally out of scope here (see docs/BETTING_DATA_SOURCES.md).

Outputs (DuckDB):
  bronze_dk_slates   — one row per draft group
  bronze_dk_salaries — one row per (draft_group_id, draftable_id)
  bronze_dk_contests — one row per contest (entry fee, prize pool, entries) —
                       every Classic NFL contest in the lobby, not collapsed
                       to one per draft group, so the user can browse and
                       pick a specific contest to build a lineup for.

Outputs (R2):
  fantasai/betting/dk_slates.json
  fantasai/betting/dk_salaries.json
  fantasai/betting/dk_contests.json

Usage:
  python ingest_draftkings.py                  # Classic slates only, up to --max-slates
  python ingest_draftkings.py --max-slates 5
  python ingest_draftkings.py --draft-group-id 151307   # single slate, skips lobby crawl
  python ingest_draftkings.py --dry-run
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

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

DK_HEADERS = {"User-Agent": "Mozilla/5.0"}
LOBBY_URL  = "https://www.draftkings.com/lobby/getcontests?sport=NFL"
DRAFTABLES_URL = "https://api.draftkings.com/draftgroups/v1/draftgroups/{dg}/draftables"


def _get(url: str, timeout: int = 15) -> dict | None:
    try:
        r = requests.get(url, headers=DK_HEADERS, timeout=timeout)
        if r.status_code == 200:
            return r.json()
        print(f"   WARNING: {url} -> HTTP {r.status_code}")
    except Exception as e:
        print(f"   WARNING: {url} -> {e}")
    return None


def _parse_dk_date(s: str | None):
    """DK dates come as ASP.NET-style '/Date(1789318800000)/' (epoch ms)."""
    if not s:
        return None
    try:
        ms = int(s.strip("/").replace("Date(", "").replace(")", ""))
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _is_real_nfl_contest(c: dict) -> bool:
    """
    Excludes anything that isn't a genuine, real-game salary-cap NFL contest:
      - non-Classic game types (Showdown, Snake, Pick6, etc.)
      - Snake-draft contests (not salary-cap — our optimizer doesn't apply)

    NOTE: Preseason contests ("... (Preseason)" in the name) ARE real —
    real players, real scheduled preseason games, same $50,000 cap/roster
    rules as any other Classic contest. DK's rules page for these labels
    the ruleset "Simulated NFL Classic" and mentions video-game settings
    (Arcade/All-Madden) — that reads like it's describing how DK verifies
    box scores, not that the games themselves are simulated. Confirmed
    live 2026-08-22: draft group 152127 ("$60K Preseason Special") pulled
    real rosters (Caleb Williams, Dak Prescott, Patrick Mahomes, etc.)
    across 4 real scheduled preseason games (CHI@CIN, DAL@ARI, KC@TB,
    PHI@NE), just with a flat $5,500 salary per player (9 x $5,500 =
    $49,500, just under the standard $50,000 cap) instead of DK's usual
    varied salaries — presumably because DK doesn't have enough signal to
    differentiate preseason player value. Not excluded here.
    """
    if c.get("gameType") != "Classic":
        return False
    if c.get("isSnakeDraft"):
        return False
    return True


def fetch_lobby() -> list[dict]:
    data = _get(LOBBY_URL)
    if not data:
        return []
    contests = data.get("Contests") or []
    print(f"   Lobby: {len(contests)} open NFL contests")
    real = [c for c in contests if _is_real_nfl_contest(c)]
    print(f"   {len(real)} salary-cap Classic contests after filtering out Snake-draft / non-Classic")
    return real


def discover_draft_groups(contests: list[dict], max_slates: int) -> list[dict]:
    """
    Collapse the contest list to distinct Classic-format draft groups,
    largest field first (as a proxy for "main slate" relevance) — used to
    pick which slates to pull full player pools for.
    """
    by_dg: dict[int, dict] = {}
    for c in contests:
        dg = c.get("dg")
        if not dg:
            continue
        entries = c.get("m") or 0  # max entries, proxy for slate popularity
        existing = by_dg.get(dg)
        if not existing or entries > existing.get("_entries", 0):
            by_dg[dg] = {
                "draft_group_id": dg,
                "slate_name": c.get("n", ""),
                "game_type": c.get("gameType", ""),
                "_entries": entries,
            }

    groups = sorted(by_dg.values(), key=lambda g: -g["_entries"])[:max_slates]
    print(f"   Selected {len(groups)} Classic draft groups (largest field first)")
    return groups


def parse_contests(contests: list[dict]) -> list[dict]:
    """Every individual Classic NFL contest — lets the user browse and pick
    one (entry fee, prize pool, entries) rather than just the biggest slate."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for c in contests:
        contest_id = c.get("id")
        dg = c.get("dg")
        if contest_id is None or not dg:
            continue
        pd = c.get("pd") or {}
        rows.append({
            "contest_id":            contest_id,
            "draft_group_id":        dg,
            "name":                  c.get("n", ""),
            "game_type":             c.get("gameType", ""),
            "entry_fee":             c.get("a"),
            "total_prize":           c.get("po"),
            "payout_summary":        next(iter(pd.values()), "") if pd else "",
            "max_entries":           c.get("m"),
            "entries_so_far":        c.get("nt"),
            "max_entries_per_user":  c.get("mec"),
            "is_guaranteed":         (c.get("attr") or {}).get("IsGuaranteed") in ("true", True),
            "start_time":            _parse_dk_date(c.get("sd")),
            "fetched_at":            now,
        })
    return rows


def fetch_draftables(draft_group_id: int) -> dict | None:
    return _get(DRAFTABLES_URL.format(dg=draft_group_id))


def parse_slate(draft_group_id: int, meta: dict, draftables_resp: dict) -> tuple[dict, list[dict]]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    draftables = draftables_resp.get("draftables") or []

    start_times = [
        p["competition"]["startTime"]
        for p in draftables
        if p.get("competition", {}).get("startTime")
    ]
    earliest_start = min(start_times) if start_times else None
    game_count = len({p.get("competition", {}).get("competitionId") for p in draftables if p.get("competition")})

    slate_row = {
        "draft_group_id": draft_group_id,
        "sport":          "NFL",
        "game_type":      meta.get("game_type", ""),
        "slate_name":     meta.get("slate_name", ""),
        "game_count":     game_count,
        "earliest_start": earliest_start,
        "fetched_at":     now,
    }

    # DK returns one draftable ROW per (player, eligible-slot-type) pair, not one
    # row per player — a FLEX-eligible RB/WR/TE gets a second row with a different
    # draftableId (same playerDkId, same salary) purely for FLEX-slot eligibility.
    # Confirmed live 2026-08-22: Jahmyr Gibbs had draftableId 43727325 (rosterSlotId
    # 67=RB) AND 43727326 (rosterSlotId 70=FLEX), identical salary/stats otherwise.
    # Keeping both as separate optimizer candidates let the ILP solver "use" the
    # same real player twice (once as e.g. WR, once as FLEX) since they're
    # independent binary variables — dedupe by playerDkId to prevent that.
    seen_player_ids: set = set()
    player_rows = []
    for p in draftables:
        player_dk_id = p.get("playerDkId")
        if player_dk_id is not None:
            if player_dk_id in seen_player_ids:
                continue
            seen_player_ids.add(player_dk_id)
        comp = p.get("competition") or {}
        team = p.get("teamAbbreviation", "")
        comp_name = comp.get("name", "")  # e.g. "BUF @ HOU"
        opponent = ""
        is_home = None
        if team and comp_name:
            teams_in_game = [t.strip() for t in comp_name.split("@")]
            if len(teams_in_game) == 2:
                away, home = teams_in_game[0].strip(), teams_in_game[1].strip()
                is_home = (team == home)
                opponent = home if team == away else away

        stat_attrs = p.get("draftStatAttributes") or []
        avg_points = None
        pos_rank = None
        for a in stat_attrs:
            if a.get("id") == 90:
                try:
                    avg_points = float(a.get("value"))
                except (TypeError, ValueError):
                    pass
            elif a.get("id") == -2:
                pos_rank = a.get("value")

        player_rows.append({
            "draft_group_id":     draft_group_id,
            "draftable_id":       p.get("draftableId"),
            "player_dk_id":       p.get("playerDkId"),
            "display_name":       p.get("displayName", ""),
            "position":           p.get("position", ""),
            "team":               team,
            "opponent":           opponent,
            "is_home":            is_home,
            "salary":             p.get("salary"),
            "status":             p.get("status", ""),
            "game_start_time":    comp.get("startTime"),
            "dk_avg_points":      avg_points,
            "dk_position_rank":   pos_rank,
            "raw_stat_attrs_json": json.dumps(stat_attrs),
            "fetched_at":         now,
        })

    return slate_row, player_rows


def write_bronze(conn, slate_rows: list[dict], player_rows: list[dict], contest_rows: list[dict], dry_run: bool):
    if dry_run:
        print(f"   DRY RUN — would write {len(slate_rows)} slates, {len(player_rows)} salary rows, {len(contest_rows)} contests")
        return
    import pandas as pd

    if slate_rows:
        df = pd.DataFrame(slate_rows)
        conn.register("_dk_slates", df)
        conn.execute("DELETE FROM bronze_dk_slates WHERE draft_group_id IN (SELECT draft_group_id FROM _dk_slates)")
        conn.execute("INSERT INTO bronze_dk_slates BY NAME SELECT * FROM _dk_slates")
        print(f"   bronze_dk_slates: {len(slate_rows)} rows written")

    if player_rows:
        df = pd.DataFrame(player_rows)
        conn.register("_dk_salaries", df)
        conn.execute("""
            DELETE FROM bronze_dk_salaries
            WHERE draft_group_id IN (SELECT DISTINCT draft_group_id FROM _dk_salaries)
        """)
        conn.execute("INSERT INTO bronze_dk_salaries BY NAME SELECT * FROM _dk_salaries")
        print(f"   bronze_dk_salaries: {len(player_rows)} rows written")

    if contest_rows:
        df = pd.DataFrame(contest_rows)
        conn.register("_dk_contests", df)
        # Full replace, not merge-by-id: this is a snapshot of currently-open
        # contests, not a history table — a contest that closed since the
        # last run should disappear, not linger as stale bronze_dk_contests rows.
        conn.execute("DELETE FROM bronze_dk_contests")
        conn.execute("INSERT INTO bronze_dk_contests BY NAME SELECT * FROM _dk_contests")
        print(f"   bronze_dk_contests: {len(contest_rows)} rows written")


def export_to_r2(conn, dry_run: bool):
    slates = conn.execute("""
        SELECT draft_group_id, sport, game_type, slate_name, game_count, earliest_start
        FROM bronze_dk_slates ORDER BY earliest_start
    """).df()
    salaries = conn.execute("""
        SELECT draft_group_id, draftable_id, player_dk_id, display_name, position, team,
               opponent, is_home, salary, status, game_start_time, dk_avg_points, dk_position_rank
        FROM bronze_dk_salaries ORDER BY draft_group_id, salary DESC
    """).df()
    contests = conn.execute("""
        SELECT contest_id, draft_group_id, name, game_type, entry_fee, total_prize,
               payout_summary, max_entries, entries_so_far, max_entries_per_user,
               is_guaranteed, start_time
        FROM bronze_dk_contests ORDER BY total_prize DESC
    """).df()

    # SQL NULL -> pandas NaN in a float column, and Python's json.dumps happily writes
    # a literal `NaN` token for that — valid Python, NOT valid JSON, and it breaks any
    # strict JSON.parse() downstream. Not every player has a DK "AVG" projection
    # (draftStatAttributes id 90), so this is a real, expected case, not an edge case.
    slates   = slates.astype(object).where(slates.notnull(), None)
    salaries = salaries.astype(object).where(salaries.notnull(), None)
    contests = contests.astype(object).where(contests.notnull(), None)

    now_iso = datetime.now(timezone.utc).isoformat()
    payloads = {
        "fantasai/betting/dk_slates.json": {
            "generated_at": now_iso,
            "source": "draftkings_unofficial",
            "slate_count": len(slates),
            "slates": slates.to_dict(orient="records"),
        },
        "fantasai/betting/dk_salaries.json": {
            "generated_at": now_iso,
            "source": "draftkings_unofficial",
            "player_count": len(salaries),
            "players": salaries.to_dict(orient="records"),
        },
        "fantasai/betting/dk_contests.json": {
            "generated_at": now_iso,
            "source": "draftkings_unofficial",
            "contest_count": len(contests),
            "contests": contests.to_dict(orient="records"),
        },
    }

    for key, payload in payloads.items():
        # allow_nan=False: fail loudly here instead of shipping a NaN/Infinity token
        # that breaks every strict JSON.parse() downstream (this is what broke the
        # DFS Optimizer screen — silent by default, expensive to debug from the frontend).
        body = json.dumps(payload, default=str, allow_nan=False)
        size_kb = len(body.encode()) / 1024
        print(f"   {key}  ({size_kb:.1f} KB)")
        if dry_run:
            print("      DRY RUN"); continue
        if not FANTASAI_KEY:
            print("      SKIP — FANTASAI_KEY not set"); continue
        try:
            resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
            print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
        except Exception as e:
            print(f"      ERROR {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-slates", type=int, default=10,
                        help="Max number of Classic NFL draft groups to pull (default: 10)")
    parser.add_argument("--draft-group-id", type=int, default=None,
                        help="Pull a single draft group directly, skip the lobby crawl")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("DraftKings DFS Ingestion — NFL Slates, Players, Salaries")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    contest_rows = []
    if args.draft_group_id:
        groups = [{"draft_group_id": args.draft_group_id, "slate_name": "", "game_type": ""}]
    else:
        contests = fetch_lobby()
        contest_rows = parse_contests(contests)
        groups = discover_draft_groups(contests, args.max_slates)

    if not groups:
        print("\n   WARNING: no draft groups found — DK lobby may have changed shape or blocked this request")
        conn.close()
        return

    all_slate_rows, all_player_rows = [], []
    for g in groups:
        dg = g["draft_group_id"]
        print(f"\n   Fetching draftables for draft group {dg} ({g.get('slate_name', '')})…")
        resp = fetch_draftables(dg)
        if not resp:
            print(f"   SKIP — draftables fetch failed for {dg}")
            continue
        slate_row, player_rows = parse_slate(dg, g, resp)
        all_slate_rows.append(slate_row)
        all_player_rows.extend(player_rows)
        print(f"   {len(player_rows)} players")
        time.sleep(0.3)

    print(f"\n── Writing {len(all_slate_rows)} slates, {len(all_player_rows)} salary rows, {len(contest_rows)} contests ─────")
    write_bronze(conn, all_slate_rows, all_player_rows, contest_rows, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ DraftKings DFS ingestion complete")


if __name__ == "__main__":
    main()
