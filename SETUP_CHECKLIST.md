FantasAI Setup Checklist
Local app

    Create .env from .env.example
    Install dependencies with pip install -r requirements.txt
    Run the API with uvicorn app.main:app --reload
    Verify /health
    Verify /players/trending

Databricks

    Create schema with databricks/sql/01_create_schemas.sql
    Create bronze tables
    Create silver tables
    Create player tables
    Create league tables
    Create roster tables
    Create matchup tables
    Create news tables
    Create silver domain tables

Databricks notebooks

    Import 01_bronze_ingestion.py
    Import 02_silver_normalization.py
    Import 03_player_metadata_ingestion.py
    Import 04_league_ingestion.py
    Import 05_roster_ingestion.py
    Import 06_matchups_ingestion.py
    Import 07_news_ingestion.py
    Import 08_silver_domain_normalization.py

Databricks workflow

    Import databricks/workflows/fantasy_pipeline_job.json
    Set any required parameters like LEAGUE_ID
    Run the workflow
    Verify Delta tables are populated

API + Databricks integration

    Set DATABRICKS_HOST
    Set DATABRICKS_TOKEN
    Set DATABRICKS_WAREHOUSE_ID
    Test /players/trending/from-databricks
    Test /recommendations/roster

Quality

    Run pytest
    Run Docker build
    Run GitHub Actions CI
