"""
Compare classification results between two model runs.
Usage:
  python compare_models.py                              # default: 8b vs 14b
  python compare_models.py --a classified_qwen3_8b.json --b classified_qwen3_14b.json
"""

import argparse
import json
from pathlib import Path

HERE = Path(__file__).parent


def load(path: Path) -> dict:
    items = json.loads(path.read_text())
    return {item["article_id"]: item for item in items}


def diff_summary(a: dict, b: dict, label_a: str, label_b: str):
    shared = set(a) & set(b)
    print(f"\n{'='*60}")
    print(f"  {label_a}  vs  {label_b}")
    print(f"  Articles in {label_a}: {len(a)}  |  {label_b}: {len(b)}  |  shared: {len(shared)}")
    print(f"{'='*60}")

    rel_diffs = []
    sentiment_flips = []
    priority_flips = []
    player_diffs = []

    for aid in sorted(shared):
        ra, rb = a[aid], b[aid]
        headline = ra.get("headline", aid)[:60]

        rel_a = ra.get("relevance", 0)
        rel_b = rb.get("relevance", 0)
        delta = round(rel_b - rel_a, 1)
        if abs(delta) >= 1.5:
            rel_diffs.append((delta, headline, rel_a, rel_b))

        sa, sb = ra.get("sentiment"), rb.get("sentiment")
        if sa != sb:
            sentiment_flips.append((headline, sa, sb))

        pa, pb = ra.get("priority_level"), rb.get("priority_level")
        if pa != pb:
            priority_flips.append((headline, pa, pb))

        players_a = set(ra.get("players", []))
        players_b = set(rb.get("players", []))
        added = players_b - players_a
        dropped = players_a - players_b
        if added or dropped:
            player_diffs.append((headline, added, dropped))

    # Relevance score shifts
    print(f"\n[Relevance shifts ≥1.5 points — {len(rel_diffs)} articles]")
    for delta, headline, ra_val, rb_val in sorted(rel_diffs, key=lambda x: -abs(x[0])):
        arrow = "▲" if delta > 0 else "▼"
        print(f"  {arrow}{abs(delta):+.1f}  {ra_val}→{rb_val}  {headline}")

    # Sentiment flips
    print(f"\n[Sentiment changes — {len(sentiment_flips)} articles]")
    for headline, sa, sb in sentiment_flips:
        print(f"  {sa} → {sb}  |  {headline}")

    # Priority flips
    print(f"\n[Priority changes — {len(priority_flips)} articles]")
    for headline, pa, pb in priority_flips:
        print(f"  {pa} → {pb}  |  {headline}")

    # Player extraction differences
    print(f"\n[Player extraction differences — {len(player_diffs)} articles]")
    for headline, added, dropped in player_diffs[:20]:
        parts = []
        if added:
            parts.append(f"+{list(added)}")
        if dropped:
            parts.append(f"-{list(dropped)}")
        print(f"  {' | '.join(parts)}  |  {headline}")

    # Speed comparison
    def avg_time(d):
        times = [v["elapsed_sec"] for v in d.values() if "elapsed_sec" in v]
        return round(sum(times) / len(times), 2) if times else 0

    print(f"\n[Speed]")
    print(f"  {label_a}: {avg_time(a)}s/article avg")
    print(f"  {label_b}: {avg_time(b)}s/article avg")
    slowdown = round(avg_time(b) / avg_time(a), 1) if avg_time(a) else 0
    print(f"  {label_b} is {slowdown}x slower than {label_a}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--a", default="classified_qwen3_8b.json", help="First model output"
    )
    parser.add_argument(
        "--b", default="classified_qwen3_14b.json", help="Second model output"
    )
    args = parser.parse_args()

    path_a = HERE / args.a
    path_b = HERE / args.b

    if not path_a.exists():
        print(f"Missing: {path_a}")
        return
    if not path_b.exists():
        print(f"Missing: {path_b}  — run classifier with --model qwen3:14b first")
        return

    label_a = args.a.replace("classified_", "").replace(".json", "")
    label_b = args.b.replace("classified_", "").replace(".json", "")

    diff_summary(load(path_a), load(path_b), label_a, label_b)


if __name__ == "__main__":
    main()
