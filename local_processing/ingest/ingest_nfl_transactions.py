"""
NFL Transactions — Bronze Layer Ingestion
Replaces: notebooks/01_Ingestion/Bronze/NFL Transactions Ingestion.ipynb

Fetches official NFL transactions (signings, IR moves, activations, releases)
from ESPN's free transactions API and stores to DuckDB.

Outputs:
  bronze_nfl_transactions  — appended, deduplicated by transaction_id

Usage:
  python ingest_nfl_transactions.py
  python ingest_nfl_transactions.py --days 30   # lookback window (default 30)
  python ingest_nfl_transactions.py --dry-run
"""

import argparse
import hashlib
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import requests
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

ESPN_TRANSACTIONS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions"
REQUEST_TIMEOUT       = 15

TRANSACTION_TYPES = [
    ("Reserve/Injured",      r"(?i)Reserve[/\s-]*Injured|placed.+on.+IR|Injured Reserve"),
    ("Reserve/COVID-19",     r"(?i)Reserve[/\s-]*COVID"),
    ("Reserve/PUP",          r"(?i)Reserve[/\s-]*PUP|Physically Unable"),
    ("Reserve/NFI",          r"(?i)Reserve[/\s-]*NFI|Non-Football Injury"),
    ("Reserve/Suspended",    r"(?i)Reserve[/\s-]*Suspended|placed.+on.+suspension"),
    ("Activated",            r"(?i)Activated|activated from"),
    ("Waived",               r"(?i)Waived|waived/"),
    ("Released",             r"(?i)Released"),
    ("Signed",               r"(?i)Signed|re-signed|signs|signed to"),
    ("Traded",               r"(?i)Traded|trade"),
    ("Practice Squad",       r"(?i)Practice Squad|practice-squad"),
    ("Designated to Return", r"(?i)Designated to Return|designated for return"),
    ("Terminated",           r"(?i)Terminated"),
    ("Claimed",              r"(?i)Claimed off waivers|claimed from"),
    ("Exempt",               r"(?i)Exempt List"),
    ("Suspended",            r"(?i)Suspended"),
    ("Contract Extension",   r"(?i)Contract Extension|extension"),
]

POS_PATTERN = r"\b(QB|RB|WR|TE|OL|OT|OG|C|DE|DT|NT|LB|ILB|OLB|CB|S|SS|FS|K|P|LS|FB|DL|DB)\b"


def fetch_transactions(lookback_days: int) -> tuple[list, int]:
    """Fetch all transaction pages from ESPN. Returns (transactions, page_count)."""
    start_date = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    print(f"📡 Fetching NFL transactions (last {lookback_days} days)…")
    r = requests.get(ESPN_TRANSACTIONS_URL, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    data = r.json()

    transactions = data.get("transactions", [])
    page_count   = data.get("pageCount", 1)

    if page_count > 1:
        for page in range(2, page_count + 1):
            try:
                pr = requests.get(ESPN_TRANSACTIONS_URL, params={"page": page}, timeout=REQUEST_TIMEOUT)
                if pr.status_code == 200:
                    transactions.extend(pr.json().get("transactions", []))
                time.sleep(0.1)
            except Exception:
                continue

    print(f"   ✅ {len(transactions):,} raw transactions fetched ({page_count} pages)")
    return transactions, start_date


def parse_transactions(raw: list, start_date: datetime) -> list[dict]:
    parsed = []
    for txn in raw:
        try:
            date_str    = txn.get("date", "")
            description = txn.get("description", "")
            team_obj    = txn.get("team", {}) or {}

            txn_date = None
            if date_str:
                try:
                    txn_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                except Exception:
                    pass

            if txn_date and txn_date < start_date:
                continue

            txn_id = f"espn_{hashlib.md5(f'{date_str}_{description}'.encode()).hexdigest()[:16]}"
            team   = team_obj.get("abbreviation")

            txn_type = None
            for t_name, pattern in TRANSACTION_TYPES:
                if re.search(pattern, description):
                    txn_type = t_name
                    break

            player_name = None
            name_pat = (
                r"(?:Signed|Waived|Released|Activated|Placed|Traded|Claimed|Designated)"
                r"\s+(?:" + POS_PATTERN + r")\s+"
                r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+(?:\.)?)*?)\s+(?:to|from|off|on|and|for)"
            )
            m = re.search(name_pat, description, re.IGNORECASE)
            if m:
                player_name = m.group(2).strip()

            position = None
            pm = re.search(POS_PATTERN, description)
            if pm:
                position = pm.group(1)

            parsed.append({
                "transaction_id":   txn_id,
                "transaction_date": txn_date.replace(tzinfo=None) if txn_date else None,
                "transaction_type": txn_type,
                "player_name":      player_name,
                "position":         position,
                "team":             team,
                "description":      description,
                "espn_player_id":   None,
                "fetched_at":       datetime.now(timezone.utc).replace(tzinfo=None),
            })
        except Exception:
            continue

    type_counts = Counter(t["transaction_type"] for t in parsed)
    print(f"   ✅ {len(parsed):,} transactions parsed")
    for t_type, cnt in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"     {t_type}: {cnt}")
    return parsed


def write_to_db(conn, transactions: list[dict], dry_run: bool):
    if not transactions:
        print("⚠️  No transactions to write")
        return
    if dry_run:
        print("🔵 Dry-run — skipping DB write")
        return

    df = pd.DataFrame(transactions)
    conn.register("_txns", df)

    before = conn.execute("SELECT COUNT(*) FROM bronze_nfl_transactions").fetchone()[0]
    conn.execute("""
        INSERT INTO bronze_nfl_transactions
        SELECT n.*
        FROM _txns n
        WHERE NOT EXISTS (
            SELECT 1 FROM bronze_nfl_transactions t
            WHERE t.transaction_id = n.transaction_id
        )
    """)
    inserted = conn.execute("SELECT COUNT(*) FROM bronze_nfl_transactions").fetchone()[0] - before
    print(f"   bronze_nfl_transactions: +{inserted} new rows (skipped {len(df) - inserted} dupes)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days",    type=int, default=30, help="Lookback window in days")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("NFL Transactions — Bronze Ingestion")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    raw, start_date = fetch_transactions(args.days)
    parsed          = parse_transactions(raw, start_date)
    write_to_db(conn, parsed, args.dry_run)
    conn.close()

    print("\n✅ NFL transactions ingestion complete")


if __name__ == "__main__":
    main()
