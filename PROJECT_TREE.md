FantasAI Project Tree Recap

FantasAI/
├── .env.example
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
├── Dockerfile
├── Makefile
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
│   │   └── 04_league_ingestion.py
│   ├── sql/
│   │   ├── 01_create_schemas.sql
│   │   ├── 02_create_bronze_tables.sql
│   │   ├── 03_create_silver_tables.sql
│   │   └── 04_create_player_tables.sql
│   └── workflows/
│       └── fantasy_pipeline_job.json
└── tests/
    └── test_main.py

Current capabilities

    FastAPI app scaffold
    Sleeper trending endpoint
    Databricks SQL starter integration
    Bronze and silver Delta table setup
    Player metadata ingestion notebook
    League ingestion starter notebook
    Docker and docker-compose support
    Basic CI workflow
    Basic API tests

Suggested next priorities

    Add real Databricks result parsing
    Add league rosters ingestion
    Add player news ingestion
    Add embeddings + vector search
    Add recommendation ranking logic
    Add auth and secrets management
    Add production deployment configuration

