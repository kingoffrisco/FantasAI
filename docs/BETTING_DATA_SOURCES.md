# Betting / DFS Data Sources

**Last Updated:** August 22, 2026
**Status:** DraftKings DFS and Kalshi ingest pipelines built and verified live. No lineup optimizer yet — this is the data layer only.

---

## What's live right now

| Script | Source | Auth | Cadence | R2 output |
|---|---|---|---|---|
| `local_processing/ingest/ingest_draftkings.py` | DraftKings DFS (unofficial) | None | Manual (not yet scheduled) | `fantasai/betting/dk_slates.json`, `dk_salaries.json` |
| `local_processing/ingest/ingest_kalshi.py` | Kalshi (official public REST) | None for market data | Manual (not yet scheduled) | `fantasai/betting/kalshi_nfl_markets.json` |

Both verified against live endpoints on 2026-08-22: DraftKings returned 1,317 real NFL DFS players with salaries for the current slate; Kalshi returned 763 open NFL markets across game-winner, game-total, and 1st-half-spread series. Neither is wired into `orchestrator_daily.py` or `orchestrator_weekly.py` yet, and `bronze_kalshi_nfl_markets` is append-only by design (never overwritten) so line-movement history builds up only once this runs on a schedule.

**Not yet built:** DraftKings Sportsbook odds/props (a separate, different unofficial endpoint family from DFS — deliberately out of scope for now, see note below), a lineup optimizer, Kalshi WebSocket streaming, and any frontend "Betting" nav section.

---

## Provider comparison

| Provider | DraftKings coverage | Kalshi/prediction markets | Live odds | Player props | Historical | Official API | Cost | Status here |
|---|---|---|---|---|---|---|---|---|
| **DraftKings DFS (unofficial)** | ✅ salaries/slates | ❌ | N/A (DFS, not odds) | N/A | ⚠️ no history endpoint found | ❌ unofficial | Free | ✅ **built, verified live** |
| **Kalshi direct API** | ❌ | ✅ | ✅ | N/A (prediction contracts, not player props) | ✅ | ✅ official, documented | Free for market-data reads; trading requires an API key | ✅ **built, verified live** |
| DraftKings Sportsbook (unofficial) | ✅ | ❌ | ✅ | ✅ | ⚠️ | ❌ unofficial | Free | ❌ not built — endpoint pattern unverified, see note below |
| SportsDataIO Discovery Lab | ✅ odds | ❌ | ❌ delayed | ✅ | ✅ | ✅ | $99/mo (Odds) or $149/mo (Fantasy+Odds); $599-899/yr | Not evaluated |
| SportsDataIO commercial (real-time) | ✅ | ⚠️ some prediction-market products | ✅ | ✅ | ✅ | ✅ | Quote/sales | Not evaluated |
| The Odds API | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | Free tier → paid plans | Not evaluated |
| OpticOdds | ✅ (DK-specific) | ✅ | ✅ | ✅ | ✅ | ✅ | Quote/sales | Not evaluated |
| OddsPapi | ✅ | ✅ (advertised — verify actual Kalshi NFL market coverage before relying on it) | ✅ | ✅ | ✅ | ✅ | Quote/plan-dependent | Not evaluated |
| Sportradar | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | Quote/enterprise | Not evaluated |
| SportsGameOdds | ✅ | ❌ | ✅ | ✅ | ⚠️ | ✅ | Free/paid tiers | Not evaluated |
| OddsJam | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | Quote/enterprise for API | Not evaluated |
| Polymarket | ❌ | ❌ (different platform) | ✅ | N/A | ✅ | ✅ | Generally free | Not evaluated |
| ESPN (existing) | ❌ | ❌ | N/A | N/A | N/A | ⚠️ unofficial | Free | Already in use for schedule/news |

Pricing for the quote-based rows above was not independently re-verified — the published numbers are only confirmed for SportsDataIO's Discovery Lab tier. Get an actual quote before budgeting for OpticOdds, OddsPapi, or Sportradar.

---

## Why DraftKings Sportsbook odds aren't built yet

The DFS endpoints (draft groups, draftables/salaries) were confirmed by direct testing — real requests, real 200 responses, real current-slate data (see table above). The **Sportsbook** odds/props endpoints (spread, total, player props) are a different, separate DraftKings system, and the exact current endpoint path for it was not verified live in this session — I won't hardcode a guessed URL into the codebase. Before building `ingest_draftkings_sportsbook.py`, that endpoint needs the same direct verification treatment the DFS one got (see the pattern in `ingest_draftkings.py`'s docstring): find the real URL, test it live, confirm the field names, then write the ingest script against confirmed reality.

## Kalshi host correction

Kalshi's REST API has moved hosts. The commonly-referenced `trading-api.kalshi.com` now returns `401` with a redirect message pointing at `api.elections.kalshi.com`. Both `api.elections.kalshi.com` and `external-api.kalshi.com` currently serve the same `trade-api/v2` surface (verified 2026-08-22) — `ingest_kalshi.py` uses `external-api.kalshi.com` since it's the more generically-named of the two working hosts. Re-verify against Kalshi's own docs if requests start failing; don't trust this note indefinitely.

## Risk notes (same class of risk as the ESPN 403 you already hit)

- **DraftKings is fully unofficial.** No developer agreement, no stability guarantee, no rate-limit documentation. Endpoints can change shape or start blocking requests (by IP, User-Agent, or rate) with zero notice — this is the exact failure mode that hit `job_live_scores.py` with ESPN on 2026-08-20. Run DK ingestion from the local machine only, never from the Cloudflare Worker, and expect to need to fix it eventually.
- **Kalshi is a real prediction market, not a sportsbook** — prices reflect what traders are willing to pay for a contract, not a bookmaker's line. They're directionally useful as an implied-probability signal (game total, spread, win probability) but aren't the same thing as a DraftKings Sportsbook line, and Kalshi's own market rules explicitly disclaim any affiliation with the NFL/DraftKings.
- **If any future direction here involves real-money wagering** (as opposed to reading market data for fantasy/DFS context), that's a different legal category — gambling licensing and jurisdiction rules apply. Nothing built so far places or tracks a wager; both scripts only read public market/salary data.
