"""
FantasAI Watchlist Manager

Add/remove players to the news tracking watchlist. Watchlist players
get Google News coverage even if they're outside the top 200 ADP.

Usage:
  python watchlist.py add "Jonathan Brooks" RB CAR --reason "IR stash, 2024 draft pick"
  python watchlist.py add "Colston Loveland" TE DET --reason "Rookie TE to monitor"
  python watchlist.py remove "Jonathan Brooks"
  python watchlist.py list
  python watchlist.py clear
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from db import get_conn, init_schema


def add_player(conn, name, pos, team, reason=""):
    conn.execute("""
        INSERT OR REPLACE INTO watchlist (player_name, position, team, reason, added_at)
        VALUES (?, ?, ?, ?, ?)
    """, [name, pos.upper(), team.upper(), reason, datetime.now(timezone.utc).replace(tzinfo=None)])
    print(f"  ✅ Added: {name} ({pos}, {team}){' — ' + reason if reason else ''}")


def remove_player(conn, name):
    deleted = conn.execute(
        "DELETE FROM watchlist WHERE LOWER(player_name) = LOWER(?)", [name]
    ).fetchone()
    print(f"  ✅ Removed: {name}")


def list_watchlist(conn):
    rows = conn.execute(
        "SELECT player_name, position, team, reason, added_at FROM watchlist ORDER BY added_at DESC"
    ).fetchall()
    if not rows:
        print("  Watchlist is empty")
        return
    print(f"\n  {'Player':<25} {'Pos':<5} {'Team':<5} {'Reason':<40} {'Added'}")
    print(f"  {'─'*25} {'─'*5} {'─'*5} {'─'*40} {'─'*16}")
    for name, pos, team, reason, added in rows:
        dt = added.strftime('%Y-%m-%d') if added else '—'
        print(f"  {name:<25} {pos or '—':<5} {team or '—':<5} {(reason or '—'):<40} {dt}")
    print(f"\n  Total: {len(rows)} players")


def clear_watchlist(conn):
    conn.execute("DELETE FROM watchlist")
    print("  ✅ Watchlist cleared")


def main():
    parser = argparse.ArgumentParser(description="FantasAI Watchlist Manager")
    sub = parser.add_subparsers(dest="cmd")

    add_p = sub.add_parser("add", help="Add a player")
    add_p.add_argument("name", help="Player name")
    add_p.add_argument("pos", help="Position (QB/RB/WR/TE)")
    add_p.add_argument("team", help="NFL team abbreviation")
    add_p.add_argument("--reason", default="", help="Why you're watching")

    rem_p = sub.add_parser("remove", help="Remove a player")
    rem_p.add_argument("name", help="Player name")

    sub.add_parser("list", help="Show watchlist")
    sub.add_parser("clear", help="Clear all")

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        return

    conn = get_conn()
    init_schema(conn)

    if args.cmd == "add":
        add_player(conn, args.name, args.pos, args.team, args.reason)
    elif args.cmd == "remove":
        remove_player(conn, args.name)
    elif args.cmd == "list":
        list_watchlist(conn)
    elif args.cmd == "clear":
        clear_watchlist(conn)

    conn.close()


if __name__ == "__main__":
    main()
