FantasAI Final Project Tree

FantasAI/
├── .env.example
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
├── Dockerfile
├── Makefile
├── PROJECT_TREE.md
├── README.md
├── docker-compose.yml
├── requirements.txt
├── app/
│   ├── config.py
│   ├── main.py
│   ├── rag/
│   │   └── pipeline.py
│   └── services/
│       ├── databricks_sql.py
│       └── fantasy_apis.py
├── databricks/
│   ├── notebooks/
│   │   ├── 01_bronze_ingestion.py
│   │   ├── 02_silver_normalization.py
│   │   ├── 03_player_metadata_ingestion.py
│   │   ├── 04_league_ingestion.py
│   │   ├── 05_roster_ingestion.py
│   │   ├── 06_matchups_ingestion.py
│   │   ├── 07_news_ingestion.py
│   │   └── 08_silver_domain_normalization.py
│   ├── sql/
│   │   ├── 01_create_schemas.sql
│   │   ├── 02_create_bronze_tables.sql
│   │   ├── 03_create_silver_tables.sql
│   │   ├── 04_create_player_tables.sql
│   │   ├── 05_create_league_tables.sql
│   │   ├── 06_create_roster_tables.sql
│   │   ├── 07_create_matchup_tables.sql
│   │   ├── 08_create_news_tables.sql
│   │   └── 09_create_silver_domain_tables.sql
│   └── workflows/
│       └── fantasy_pipeline_job.json
└── tests/
    └── test_main.py

Functional areas

    FastAPI app for health, live Sleeper data, Databricks-backed trending data, and roster recommendations
    Databricks bronze ingestion notebooks for NFL state, trending players, player metadata, leagues, rosters, matchups, and news
    Databricks silver normalization notebooks for analytics-friendly domain tables
    SQL DDLs for creating bronze and silver Delta tables
    Dev tooling with Docker, docker-compose, Makefile, tests, and CI

Recommended next steps

    Add real secrets management
    Add player projections and injuries
    Parse array-like roster/player fields into normalized child tables
    Add warehouse query pagination and retries
    Add authentication and user-specific league settings
    Add LLM recommendation ranking on top of Databricks results

