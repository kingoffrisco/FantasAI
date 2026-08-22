"""
Kalshi NFL Markets Ingestion — Prediction Market Prices as Betting Signal
New (2026-08-22).

Unlike DraftKings, Kalshi has a real, documented, publicly-supported REST
API. Market data (prices, volume, open interest) requires no authentication
— only placing orders does. Prices are dollars in [$0.00, $1.00] and can be
read as an approximate market-implied probability (before fees/spread).

Verified live 2026-08-22:
  GET https://external-api.kalshi.com/trade-api/v2/series?category=Sports
  GET https://external-api.kalshi.com/trade-api/v2/markets?series_ticker={t}&status=open

NOTE: the commonly-referenced host trading-api.kalshi.com is DEPRECATED —
it now returns 401 and points at api.elections.kalshi.com. Both that host
and external-api.kalshi.com serve the same trade-api/v2 surface as of this
writing; this script uses external-api.kalshi.com as the more generically-
named (non-election-specific) production host. Re-verify if requests start
failing — Kalshi's own docs are the source of truth, this comment is not.

This script pulls only a curated set of NFL series (not the full ~294 NFL-
matching series Kalshi lists) — see NFL_SERIES below. Expanding coverage
(team season win totals, weekly player leader props, per-quarter markets)
is a deliberate follow-up, not attempted here.

Table is APPEND-ONLY (PRIMARY KEY includes fetched_at) — never overwritten,
so price history over time becomes a usable "line movement" feature. Run
this on a schedule (e.g. hourly, same cadence as job_live_scores.py) to
build that history; a single run only gives you one snapshot.

Outputs (DuckDB):
  bronze_kalshi_nfl_markets — append-only, one row per (market, fetch time)

Outputs (R2):
  fantasai/betting/kalshi_nfl_markets.json — latest snapshot only

Usage:
  python ingest_kalshi.py
  python ingest_kalshi.py --series KXNFLGAME KXNFLTOTAL
  python ingest_kalshi.py --dry-run
"""

import argparse
import json
import os
import sys
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

KALSHI_BASE    = "https://external-api.kalshi.com/trade-api/v2"
KALSHI_HEADERS = {"User-Agent": "Mozilla/5.0"}

# Curated starting set — game winner, game total, first-half spread.
# See NFL-matching series discovered 2026-08-22 for other candidates
# (season win totals: KXNFLWINS-{team}; leader props: KXLEADERNFL*).
NFL_SERIES = ["KXNFLGAME", "KXNFLTOTAL", "KXNFL1HSPREAD"]


def _get(url: str, params: dict, timeout: int = 15) -> dict | None:
    try:
        r = requests.get(url, params=params, headers=KALSHI_HEADERS, timeout=timeout)
        if r.status_code == 200:
            return r.json()
        print(f"   WARNING: {url} -> HTTP {r.status_code}")
    except Exception as e:
        print(f"   WARNING: {url} -> {e}")
    return None


def fetch_series_markets(series_ticker: str) -> list[dict]:
    """Paginate through all open markets for a series ticker."""
    markets: list[dict] = []
    cursor = None
    while True:
        params = {"series_ticker": series_ticker, "status": "open", "limit": 200}
        if cursor:
            params["cursor"] = cursor
        data = _get(f"{KALSHI_BASE}/markets", params)
        if not data:
            break
        batch = data.get("markets") or []
        markets.extend(batch)
        cursor = data.get("cursor")
        if not cursor or not batch:
            break
    return markets


def _dollars(v) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_markets(series_ticker: str, markets: list[dict]) -> list[dict]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for m in markets:
        rows.append({
            "market_ticker": m.get("ticker"),
            "event_ticker":  m.get("event_ticker"),
            "series_ticker": series_ticker,
            "title":         m.get("title", ""),
            "yes_sub_title": m.get("yes_sub_title", ""),
            "no_sub_title":  m.get("no_sub_title", ""),
            "status":        m.get("status", ""),
            "close_time":    m.get("close_time"),
            "yes_bid":       _dollars(m.get("yes_bid_dollars")),
            "yes_ask":       _dollars(m.get("yes_ask_dollars")),
            "no_bid":        _dollars(m.get("no_bid_dollars")),
            "no_ask":        _dollars(m.get("no_ask_dollars")),
            "last_price":    _dollars(m.get("last_price_dollars")),
            "volume":        _dollars(m.get("volume_fp")),
            "open_interest": _dollars(m.get("open_interest_fp")),
            "fetched_at":    now,
        })
    return rows


def write_bronze(conn, rows: list[dict], dry_run: bool):
    if dry_run:
        print(f"   DRY RUN — would append {len(rows)} rows")
        return
    if not rows:
        return
    import pandas as pd
    df = pd.DataFrame(rows)
    conn.register("_kalshi_nfl", df)
    conn.execute("INSERT INTO bronze_kalshi_nfl_markets BY NAME SELECT * FROM _kalshi_nfl")
    print(f"   bronze_kalshi_nfl_markets: {len(rows)} rows appended")


def export_to_r2(conn, dry_run: bool):
    latest = conn.execute("""
        SELECT market_ticker, event_ticker, series_ticker, title, yes_sub_title,
               no_sub_title, status, close_time, yes_bid, yes_ask, no_bid, no_ask,
               last_price, volume, open_interest, fetched_at
        FROM bronze_kalshi_nfl_markets
        QUALIFY ROW_NUMBER() OVER (PARTITION BY market_ticker ORDER BY fetched_at DESC) = 1
        ORDER BY series_ticker, close_time
    """).df()

    if latest.empty:
        print("   No Kalshi data — skipping R2 export")
        return

    # SQL NULL -> pandas NaN for a float column (e.g. a market with no bids yet) ->
    # json.dumps would write a literal NaN token, which is invalid JSON and breaks
    # JSON.parse() downstream. Same fix as ingest_draftkings.py.
    latest = latest.astype(object).where(latest.notnull(), None)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "kalshi",
        "market_count": len(latest),
        "markets": latest.to_dict(orient="records"),
    }

    key = "fantasai/betting/kalshi_nfl_markets.json"
    body = json.dumps(payload, default=str, allow_nan=False)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({len(latest)} markets, {size_kb:.1f} KB)")
    if dry_run:
        print("      DRY RUN"); return
    if not FANTASAI_KEY:
        print("      SKIP — FANTASAI_KEY not set"); return
    try:
        resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
        print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
    except Exception as e:
        print(f"      ERROR {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", nargs="+", default=NFL_SERIES,
                        help=f"Kalshi series tickers to pull (default: {NFL_SERIES})")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("Kalshi NFL Markets Ingestion")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Series:    {', '.join(args.series)}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    all_rows = []
    for series_ticker in args.series:
        print(f"\n   Fetching {series_ticker}…")
        markets = fetch_series_markets(series_ticker)
        rows = parse_markets(series_ticker, markets)
        all_rows.extend(rows)
        print(f"   {len(rows)} open markets")

    print(f"\n── Writing {len(all_rows)} market rows ─────────────────────────────────")
    write_bronze(conn, all_rows, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ Kalshi ingestion complete")


if __name__ == "__main__":
    main()
