# FantasAI Databricks Code Backup

Backup of all Databricks notebooks, SQL scripts, and workflows for the FantasAI Fantasy Football analytics platform.

## 📁 Repository Structure

```
├── notebooks/
│   ├── 01_Ingestion/
│   │   ├── Bronze/          # Raw data ingestion (31 notebooks + 9 Python scripts)
│   │   ├── Silver/          # Data normalization
│   │   └── Gold/            # Analytics-ready data
│   ├── 02_Analysis_Metrics/ # Performance analysis and metrics (5 notebooks)
│   ├── 03_ML_Training/      # ML feature engineering and training (3 notebooks)
│   ├── 04_ML_Registration/  # Model serving and chat API (3 notebooks)
│   └── 05_Scheduled_Jobs/   # Automated pipelines (4 notebooks)
├── sql/                     # Unity Catalog DDL scripts (9 files)
└── workflows/               # Job configuration files (1 file)
```

## 📊 Total Files
- **31** Jupyter notebooks (.ipynb)
- **9** Python scripts (.py)
- **9** SQL scripts  
- **1** Workflow JSON

## 🎯 Key Components

### Data Ingestion (Bronze Layer)
- NFLverse stats ingestion
- ESPN, Sleeper, API-Sports integrations
- Injuries, projections, stats pipelines

### Analytics (Analysis & Metrics)
- Fantasy Football Data Analysis
- Player Performance Metrics
- News Aggregation with NLP
- Opportunity Score Model (79.9% correlation)

### Machine Learning
- Feature engineering (42 features)
- LightGBM models for QB/RB/WR/TE predictions
- Vector search for player embeddings
- LLM-powered chat API with RAG

### Scheduled Jobs
- Daily: API-Sports live odds (6am CT)
- Weekly: NFLverse stats, ESPN/Sleeper updates

## 📖 Documentation

For full project details, see the main [FantasAI repository](https://github.com/kingoffrisco/FantasAI).

---

**Backup Date**: 2026-05-30  
**Workspace**: Databricks `/Users/kingoffrisco@yahoo.com`
