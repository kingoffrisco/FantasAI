# FantasAI

FantasAI is a fantasy sports AI assistant that ingests NFL and fantasy data, normalizes it in Databricks Delta tables, and serves insights through a live API and web app.

## Live URLs

| Service | URL |
|---|---|
| Website | https://fantasai.net |
| API | https://api.fantasai.net |
| CBS Worker | https://fantasai-cbs.fantasai.workers.dev |

## Architecture

```
Sleeper API ──┐
CBS Sports ───┤──► api.fantasai.net (Cloudflare Worker) ──► GitHub Actions ETL ──► S3
              │                                                                      │
              └──► fantasai-cbs Worker (auth proxy)                                 │
                                                                                    ▼
                                                             aws-kingoffisco-s3-bucket/fantasai/
                                                                                    │
fantasai.net (Cloudflare Pages) ◄───────────────────────────────────────────────────┘
```

## Services

### API Worker (`worker-api/`)
Deployed to `api.fantasai.net`. Aggregates data from Sleeper and the CBS Worker.

| Endpoint | Source | Description |
|---|---|---|
| `GET /api/health` | — | Health check |
| `GET /api/v1/injuries` | Sleeper | Injured players with status |
| `GET /api/v1/stats/week` | Sleeper | Weekly player stats |
| `GET /api/v1/projections` | Sleeper | Weekly projections |
| `GET /api/v1/league` | CBS Worker | League info |
| `GET /api/v1/rosters` | CBS Worker | Team rosters |
| `GET /api/v1/draft` | CBS Worker | Draft results |

Query params for stats/projections: `?week=N&season=Y&type=regular|pre|post`

### CBS Worker (`worker/`)
Deployed to `fantasai-cbs.fantasai.workers.dev`. Authenticates with CBS Sports using a session cookie and exposes league data as JSON.

Requires secret: `CBS_COOKIE` (set via `wrangler secret put CBS_COOKIE`)

### Frontend (`app/`)
React + Vite app deployed to Cloudflare Pages (`fantasai-app`). Connects to the CBS Worker for live league data.

### ETL Pipeline (`.github/workflows/fantasy-etl.yml`)
Runs every hour via GitHub Actions. Fetches all API endpoints and uploads JSON to S3.

**S3 layout:**
```
aws-kingoffisco-s3-bucket/fantasai/
  injuries/latest.json
  league/latest.json
  rosters/latest.json
  draft/season=YYYY/data.json
  stats/season=YYYY/week=N/data.json
  stats/season=YYYY/current_week.json
  projections/season=YYYY/week=N/data.json
  projections/season=YYYY/current_week.json
```

### Databricks (`databricks/`)
Bronze/silver Delta table pipeline for normalized analytics.

| Layer | Tables |
|---|---|
| Bronze | `bronze_nfl_state`, `bronze_trending_players` |
| Silver | `silver_nfl_state`, `silver_trending_players` |

## Local Development

### FastAPI backend

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env   # fill in values
uvicorn app.main:app --reload
```

Endpoints: `http://127.0.0.1:8000/docs`

### Frontend

```powershell
cd app
npm install
npm run dev
```

### Workers

```powershell
# CBS Worker
cd worker
npx wrangler dev

# API Worker
cd worker-api
npx wrangler dev
```

### Deploy

```powershell
# Frontend → Cloudflare Pages
cd app
npm run deploy

# API Worker → api.fantasai.net
cd worker-api
npx wrangler deploy

# CBS Worker
cd worker
npx wrangler deploy
```

## GitHub Secrets Required

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS IAM access key |
| `AWS_ACCESS_S3_SECRET` | AWS IAM secret key |

## Environment Variables (.env)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `DATABRICKS_HOST` | Databricks workspace URL |
| `DATABRICKS_TOKEN` | Databricks personal access token |
| `DATABRICKS_CATALOG` | Default: `main` |
| `DATABRICKS_SCHEMA` | Default: `fantasai` |
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse ID |
| `VECTOR_SEARCH_ENDPOINT` | Databricks Vector Search endpoint |
