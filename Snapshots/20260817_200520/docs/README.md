# FantasAI Documentation

**Project Status:** ✅ Production Ready  
**Last Updated:** June 4, 2026

---

## 📚 Documentation Index

### For UI Developers
- **[UI_INTEGRATION_GUIDE.md](./UI_INTEGRATION_GUIDE.md)** - Complete guide for integrating with FantasAI ML tables
  - Table schemas and example queries
  - Performance expectations
  - Best practices and common pitfalls
  - Data refresh strategy
  - 12KB comprehensive reference

- **[WEEKLY_DEEP_REASONING_TASK.md](./WEEKLY_DEEP_REASONING_TASK.md)** - Copy-paste Windows Task Scheduler setup for the dedicated Qwen3:30b overnight reasoning job

### For Data Engineers
- **[CHANGELOG.md](./CHANGELOG.md)** - Project history and version tracking
  - Recent changes and improvements
  - Table creation history
  - Model registration records
  - Performance optimizations

---

## 🚀 Quick Start for UI Team

### 1. Connect to Database
```python
from databricks import sql

connection = sql.connect(
    server_hostname=os.getenv("DATABRICKS_SERVER_HOSTNAME"),
    http_path=os.getenv("DATABRICKS_HTTP_PATH"),
    access_token=os.getenv("DATABRICKS_TOKEN")
)
```

### 2. Fetch 2026 Players (Frontend — via Worker API)
```js
const { players } = await fetch('https://api.fantasai.net/api/v1/db/players').then(r => r.json());
// 997 players, all isDraftable: "true"
// Fields: playerId, name, position, team, proj, avg, last, trend, positionRank, percentile, tier, status, experience, isRookie
```

Or query Databricks directly (internal tooling only):
```sql
SELECT * FROM main.fantasai.export_players_2026_draft LIMIT 2500;
```

### 3. Verify Performance
Expected query latency: **< 300ms**

---

## 📊 Available Tables

| Table | Rows | Purpose |
|-------|------|---------|
| `export_players_2026_draft` | 997 | Draft board — all active 2026 players (all draftable) |
| `export_player_news` | ~86 | AI-enriched news with fantasy insights |
| `export_defense_performance` | 606 | Weekly matchup rankings |
| `export_breakout_candidates` | ~7 | ML-powered sleeper picks |
| `export_sleeper_picks` | ~24 | High-value waiver targets |
| `ml_weekly_predictions` | 24,862 | Weekly projections (internal) |
| `ml_player_features` | 162,896 | Full feature dataset (internal) |

---

## 🔑 Critical Rules

1. **Always filter by** `is_draftable = TRUE`
2. **Sort by** `projected_avg_points DESC`
3. **Label as** "2026 Players" (not "active")
4. **Handle nulls** in combine metrics (~60% missing)
5. **Refresh weekly** during NFL season

---

## 📞 Support

- **Primary Contact:** kingoffrisco@yahoo.com
- **Job Orchestrator:** [Job 763487314454311](https://dbc-60fb4a1c-8bce.cloud.databricks.com/jobs/763487314454311)
- **Database:** Unity Catalog `main.fantasai`

---

## 🎯 Current Status

### ✅ Completed
- [x] ML pipeline operational
- [x] Features table (70 features, 162,896 rows)
- [x] Predictions table (24,862 predictions)
- [x] 2026 players table (997 active, all draftable — retired players removed June 12, 2026)
- [x] R2 optimization enabled
- [x] Documentation complete

### ⏳ Pending
- [ ] Model serving endpoints (manual UI setup)
- [ ] Feature importance visualization
- [ ] Weekly refresh automation
- [ ] UI integration testing

---

## 📖 Additional Resources

### Notebooks
- Feature Engineering: `/Repos/.../notebooks/03_ML_Training/`
- Job Orchestrator: `/Repos/.../notebooks/05_Scheduled_Jobs/`

### Models
- Experiment: `fantasai_weekly_predictions` (ID: 4060439875893869)
- Registry: `main.fantasai.player_performance_predictor_*` (QB/RB/WR/TE)

### Performance Metrics
- **QB Model:** RMSE=4.92, MAE=2.73, R²=0.776
- **Query Speed:** < 300ms average
- **Table Optimization:** Auto (R2 enabled)

---

**Version:** 1.2.0  
**Last Modified:** June 4, 2026
