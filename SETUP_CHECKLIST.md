# FantasAI Setup Checklist

**Last Updated:** August 27, 2026

> This replaces a stale version describing a `uvicorn app.main:app` FastAPI prototype with `/players/trending` routes and Databricks notebook imports — none of that exists anymore. Current stack: React/Vite frontend, two Cloudflare Workers, Cloudflare R2 storage, and a local Python/DuckDB pipeline. See [ARCHITECTURE.md](ARCHITECTURE.md) for full details and [DEPLOY.md](DEPLOY.md) for deploy/secrets specifics.

---

## 1. Clone & Install

- [ ] Clone the repo
- [ ] `cd app && npm install`
- [ ] `cd worker-api && npm install`
- [ ] `cd worker && npm install`

## 2. Cloudflare Account

- [ ] Have (or create) a Cloudflare account with Workers + R2 enabled
- [ ] `npx wrangler login` (run once, from either `worker-api/` or `worker/`)
- [ ] Confirm an R2 bucket is provisioned (`fantasai-r2`) and bound as `BUCKET` in `worker-api/wrangler.toml`

## 3. Worker Secrets

Set via `npx wrangler secret put <NAME> --name fantasai-api` (see [DEPLOY.md](DEPLOY.md) for the full current list, sourced from `worker-api/src/index.js`):

- [ ] `FANTASAI_KEY` — shared secret for the `X-FantasAI-Key` auth header
- [ ] `RESEND_API_KEY` — password-reset emails
- [ ] `WWO_API_KEY` — WorldWeatherOnline forecasts (never hardcode)
- [ ] `LOCAL_CHAT_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — chat fallback chain
- [ ] `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` — web push (optional; degrades gracefully if unset)
- [ ] For the `worker/` CBS proxy: `CBS_COOKIE` (or use the in-app "Get Cookie" flow instead — see DEPLOY.md)

Do **not** set `DATABRICKS_*` secrets for new setups — Databricks was decommissioned 2026-06-15 and is only referenced by a couple of unconfirmed-live legacy fallback routes.

## 4. Deploy the Workers

- [ ] `cd worker-api && npx wrangler deploy`
- [ ] `cd worker && npx wrangler deploy`
- [ ] Verify `GET https://api.fantasai.net/api/health` returns `r2Configured: true`

## 5. Frontend

- [ ] `cd app && npm run dev` for local dev (localhost:5173)
- [ ] Set `VITE_WORKER_URL` / `VITE_FANTASAI_KEY` if deploying to Cloudflare Pages (see DEPLOY.md)
- [ ] `npm run build` then `npx wrangler pages deploy dist --project-name fantasai` to deploy

## 6. Local Pipeline (`local_processing/`)

- [ ] Install Python 3.x
- [ ] `pip install -r local_processing/requirements-local.txt`
- [ ] Install [Ollama](https://ollama.com) locally
- [ ] Pull the models the jobs use: `ollama pull qwen3:8b`, `ollama pull qwen3:14b`, `ollama pull qwen3:30b`
- [ ] Initialize the local DuckDB schema:
  ```bash
  python -c "from local_processing.db import get_conn, init_schema; init_schema(get_conn())"
  ```
- [ ] Set `local_processing/.env` (`FANTASAI_KEY`, `API_SPORTS_KEY`, any other ingest-specific keys — see [DATA_SOURCES.md](DATA_SOURCES.md))

## 7. Run the Local Ingest/AI Jobs

- [ ] `python local_processing/orchestrator_daily.py` — runs the daily ingest chain + Job 1 (news) + Job 2 (fantasy analysis)
- [ ] `python local_processing/orchestrator_weekly.py` — weekly stats refresh
- [ ] `python local_processing/orchestrator_weekly_reasoning.py` — Job 5 deep reasoning (Qwen3 30B)
- [ ] `python local_processing/export/export_to_r2.py` — push results to R2 (also called automatically by the orchestrators)
- [ ] (Optional, ongoing operation) Register the orchestrators as Windows Task Scheduler tasks — see docstrings in each orchestrator and [ARCHITECTURE.md → Job Schedules](ARCHITECTURE.md#job-schedules)

## 8. Verify End-to-End

- [ ] `GET https://api.fantasai.net/api/v1/r2/fantasai/players/export_players_2026_draft.json` returns data
- [ ] Frontend loads the draft board / player list
- [ ] `POST https://api.fantasai.net/api/v1/chat` returns a response with a `source` field (`local-8b`/`local-14b`/`openai-*`/`anthropic`)
