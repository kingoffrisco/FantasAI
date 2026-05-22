# FantasAI

FantasAI is a fantasy sports AI assistant built around Databricks, retrieval-augmented generation (RAG), and external fantasy sports APIs.

## Planned architecture

- Fantasy APIs for league, player, injury, projection, and news data
- Databricks ingestion jobs
- Delta tables for normalized storage
- Embeddings + Vector Search for retrieval
- FastAPI backend for chat and recommendation APIs
- Optional Streamlit frontend

## Initial scaffold

```text
app/
  main.py
  config.py
  services/
    fantasy_apis.py
  rag/
    pipeline.py
databricks/
  notebooks/
    01_bronze_ingestion.py
    02_silver_normalization.py
  workflows/
    fantasy_pipeline_job.json
.env.example
requirements.txt
```

## Quick start

1. Create and activate a Python virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Copy environment variables:

```bash
cp .env.example .env
```

4. Run the API locally:

```bash
uvicorn app.main:app --reload
```

## Environment variables

See `.env.example` for required configuration.

## Next steps

- Add Sleeper ingestion
- Add Delta table DDLs
- Add embedding generation
- Add Databricks Vector Search integration
- Add roster-aware recommendation endpoints
