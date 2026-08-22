# FantasAI Documentation

**Project Status:** ✅ Production (local pipeline, some legacy Databricks-backed endpoints unconfirmed live)
**Last Updated:** August 22, 2026

> **August 22, 2026:** This index and quick-start were written for the old Databricks-backed system and were badly stale (the platform migrated to a fully local DuckDB pipeline on June 15, 2026, and has grown substantially since). Rewritten from a full audit of the current codebase. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the canonical, detailed architecture reference — this page is just a quick-start pointer into it.

---

## 📚 Documentation Index

- **[../ARCHITECTURE.md](../ARCHITECTURE.md)** — Canonical architecture reference: system inventory, DuckDB schema (~33 tables), job schedules (14 live Task Scheduler tasks), AI pipeline (Jobs 1-5), repository structure, known issues
- **[API_ENDPOINTS.md](./API_ENDPOINTS.md)** — Every worker-api route, grouped by feature, with R2-backed vs. still-Databricks-backed status flagged per endpoint
- **[DATA_SCHEMAS.md](./DATA_SCHEMAS.md)** — JSON shape for every R2 export/endpoint, including the new ones (player scores, deep reasoning, live scoring, O-Line Index/Stability, offensive ecosystem, rookie scores)
- **[../app/BACKEND_TO_FRONTEND.md](../app/BACKEND_TO_FRONTEND.md)** — Frontend integration guide: `app/src/api.js` function-to-endpoint map, screen inventory, known frontend issues
- **[BETTING_DATA_SOURCES.md](./BETTING_DATA_SOURCES.md)** — DraftKings DFS + Kalshi prediction-market ingestion (new, 2026-08-22): what's live, provider cost comparison, risk notes
- **[WEEKLY_DEEP_REASONING_TASK.md](./WEEKLY_DEEP_REASONING_TASK.md)** — Task Scheduler setup for the Job 5 (Qwen3:30B) overnight reasoning job — current and accurate
- **[LOCAL_MIGRATION_CHECKLIST.md](./LOCAL_MIGRATION_CHECKLIST.md)** — Historical record of the June 2026 Databricks → local migration
- **[HUMAN_IN_THE_LOOP_INTEGRATION.md](./HUMAN_IN_THE_LOOP_INTEGRATION.md)** — Article labeling feedback loop
- **[CHANGELOG.md](./CHANGELOG.md)** — Project history

---

## 🚀 Quick Start

### Fetch 2026 draft players (recommended — R2, local pipeline)
```js
const res = await fetch('https://api.fantasai.net/api/v1/r2/fantasai/players/export_players_2026_draft.json');
const { data } = await res.json();
```

### Fetch player news (recommended — R2, local pipeline)
```js
const res = await fetch('https://api.fantasai.net/api/v1/r2/fantasai/analysis/player_news.json');
const { data } = await res.json();
```

### Legacy Databricks-backed convenience endpoint (status unconfirmed — see API_ENDPOINTS.md)
```js
const { players } = await fetch('https://api.fantasai.net/api/v1/db/players').then(r => r.json());
```
This route still issues a live Databricks SQL Warehouse query. Whether Databricks credentials are still provisioned was not confirmed in the August 22 audit — prefer the R2-backed endpoint above unless you've verified this one works.

### Auth
Most reads are open. A subset of routes (raw R2 access, some Sleeper/CBS proxies, admin routes) require an `X-FantasAI-Key` header. See [API_ENDPOINTS.md](./API_ENDPOINTS.md) for which.

---

## 📊 Key Data Exports (R2, local pipeline)

| Export | R2 Key | Purpose |
|---|---|---|
| Draft board | `fantasai/players/export_players_2026_draft.json` | All active draftable players |
| Player news | `fantasai/analysis/player_news.json` | AI-enriched news |
| Player scores | `fantasai/analysis/player_scores.json` | Job 2 waiver/trade/start/sit/dynasty scores |
| Deep reasoning | `fantasai/analysis/deep_reasoning.json` | Job 5 — weekly, top ~20 candidates only |
| Live scores | `fantasai/live/scoreboard_{season}_{type}_{week}.json` | In-game scoring |
| O-Line Index / Stability | `fantasai/analysis/oline_index.json`, `oline_stability.json` | Proprietary O-line metrics |

Full list: [DATA_SCHEMAS.md](./DATA_SCHEMAS.md).

---

## 🔑 Critical Rules

1. Prefer R2-backed endpoints (`/api/v1/r2/{key}`) over the legacy `/api/v1/db/*` and `/api/v1/news/{latest,critical,ai-summaries}` routes — the latter are still Databricks-backed and unconfirmed live.
2. Handle nulls in combine metrics and Job 5 deep-reasoning fields (deep reasoning only covers ~20 players/week, not the full pool).
3. Live scoring keys return empty arrays (not an error) if `job_live_scores.py` hasn't run for that week yet.
4. Refresh cadence varies by export — see [ARCHITECTURE.md → Job Schedules](../ARCHITECTURE.md#job-schedules) for the authoritative per-job schedule rather than assuming daily/weekly uniformly.

---

## 📞 Support

- **Primary Contact:** kingoffrisco@yahoo.com

---

**Version:** 2.0.0
**Last Modified:** August 22, 2026
