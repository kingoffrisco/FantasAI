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

#### Updating the CBS Cookie

The cookie expires when your CBS session expires. When Sources → Live Backend shows **NEEDS COOKIE**:

1. Go to **cbssports.com** and log in to your fantasy league
2. Press **F12** → open the **Console** tab
3. Run this and press Enter:
   ```javascript
   copy(document.cookie)
   ```
4. The full cookie string is now on your clipboard
5. In PowerShell (off VPN):
   ```powershell
   cd d:\Project\Fantasy\worker-api
   npx wrangler secret put CBS_COOKIE
   ```
6. Paste (Ctrl+V) when prompted → press Enter
7. Redeploy: `npx wrangler deploy`
8. In the app go to **Sources → Live Backend** → click **↻ Resync** — status flips to **LIVE**

### Frontend (`app/`)
React + Vite app deployed to Cloudflare Pages (`fantasai-app`). Connects to the CBS Worker for live league data.

**Deployment note:** Cloudflare Pages production branch is set to `main`. Always deploy via `npm run deploy` from `app/` — this builds with Vite and uploads directly to Pages. The custom domain `fantasai.net` tracks the production deployment. After deploying, confirm `fantasai.net` is serving the new bundle by checking the JS filename in the page source matches `main.fantasai-app.pages.dev`.

#### Admin Panel
Log in with `admin@fantasai.net` to access the **Admin** section in the sidebar (only visible to admin). The **Owners** screen allows changing team names, login emails, and passwords for any league member. Changes are stored in `localStorage` under `fantasai_owners_config` and take effect immediately on the login screen.

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

## Cloudflare Configuration Notes

- **Pages production branch:** Set to `main` via Cloudflare API — ensures `wrangler pages deploy` goes to production
- **Workers Routes:** Only `api.fantasai.net/*` → `fantasai-api`. Do not add a route for `fantasai.net/*` or it will intercept Pages traffic
- **DNS:** `api.fantasai.net` uses an `AAAA 100::` proxied record (dummy IP — Cloudflare intercepts before it hits the IP)
- **SSL:** AWS CA bundle at `~/.aws/ca-bundle.pem` is required locally due to Norton HTTPS scanning. Set in `~/.aws/config` as `ca_bundle`

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
