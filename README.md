FantasAI

FantasAI is a fantasy sports AI assistant built for ingesting fantasy data, normalizing it in Databricks Delta tables, and serving insights through a FastAPI backend.
What this project will do

    Ingest fantasy sports data from external APIs such as Sleeper
    Store raw and normalized data in Delta tables
    Support retrieval pipelines for AI-powered recommendations
    Expose API endpoints for health, data access, and future chat/recommendation workflows

Current scaffold

app/
  config.py
  main.py
  rag/
    pipeline.py
  services/
    fantasy_apis.py
databricks/
  notebooks/
    01_bronze_ingestion.py
    02_silver_normalization.py
  sql/
    01_create_schemas.sql
    02_create_bronze_tables.sql
    03_create_silver_tables.sql
  workflows/
    fantasy_pipeline_job.json
.env.example
.gitignore
requirements.txt
README.md

Local development
1. Create a virtual environment

python -m venv .venv
source .venv/bin/activate

On Windows PowerShell:

python -m venv .venv
.venv\Scripts\Activate.ps1

2. Install dependencies

pip install -r requirements.txt

3. Configure environment variables

Copy the example file:

cp .env.example .env

Fill in values for:

    OPENAI_API_KEY
    DATABRICKS_HOST
    DATABRICKS_TOKEN
    DATABRICKS_CATALOG
    DATABRICKS_SCHEMA
    VECTOR_SEARCH_ENDPOINT

4. Run the API

uvicorn app.main:app --reload

5. Test the API

Open:

    http://127.0.0.1:8000/
    http://127.0.0.1:8000/health
    http://127.0.0.1:8000/players/trending
    http://127.0.0.1:8000/docs

API endpoints
GET /

Basic service metadata.
GET /health

Health check endpoint.
GET /players/trending

Returns trending player data from Sleeper.

Query parameters:

    add_drop: add or drop
    hours: lookback window, default 24
    limit: max number of players, default 25

Example:

curl "http://127.0.0.1:8000/players/trending?add_drop=add&hours=24&limit=10"

Databricks structure

This project uses a simple bronze/silver pattern:

    Bronze: raw API payloads
    Silver: normalized, analytics-friendly tables

Suggested catalog/schema:

    catalog: main
    schema: fantasai

Suggested Delta tables
Bronze

    bronze_nfl_state
    bronze_trending_players

Silver

    silver_nfl_state
    silver_trending_players

Next steps

    Add player metadata ingestion
    Add league and roster ingestion
    Add embeddings and vector search integration
    Add recommendation endpoints
    Add tests, Docker, and CI
