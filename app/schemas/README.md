# FantasAI Table Schema Documentation

## Purpose

This directory contains JSON schema files that document all FantasAI tables. The frontend UI reads these schemas to:
- Dynamically build table views
- Validate data types and required fields
- Generate API documentation automatically
- Alert on schema version mismatches

## 🔒 PROJECT LAW

**Every new or updated table MUST be documented here before being exposed to the frontend.**

## Schema File Format

Each table gets its own JSON file: `{table_name}_schema.json`

### Required Fields

```json
{
  "table_name": "{table_name}",
  "layer": "Bronze|Silver|Gold|Analytics|Export",
  "description": "Brief description of the table's purpose",
  "version": "1.0",
  "last_updated": "YYYY-MM-DD",
  "refresh_schedule": "Daily at HH:MM UTC | Weekly Mon HH:MM UTC",
  "record_count": 12345,
  "columns": [
    {
      "name": "column_name",
      "type": "string|long|double|timestamp|array<type>",
      "description": "What this column represents",
      "primary_key": true|false,
      "nullable": true|false,
      "sample_values": ["example1", "example2"]
    }
  ],
  "relationships": [
    {
      "table": "related_table_name",
      "type": "one-to-one|one-to-many|many-to-one",
      "join_key": "column_name",
      "description": "What this relationship represents"
    }
  ],
  "primary_keys": ["column1", "column2"],
  "partitioning": "By column_name | None",
  "data_quality_rules": [
    "Rule 1: Description of validation",
    "Rule 2: Another validation requirement"
  ],
  "common_queries": [
    {
      "description": "Query purpose",
      "sql": "SELECT * FROM table WHERE condition"
    }
  ],
  "frontend_usage": {
    "use_case_1": "How the frontend uses this field",
    "use_case_2": "Another frontend integration point"
  }
}
```

## Documentation Workflow

> **Note (2026-08-27):** This project migrated off Databricks on 2026-06-15. Tables now live in the local DuckDB warehouse (`local_processing/db/fantasai.duckdb`), created and evolved via `local_processing/db.py`. The "document every table here" law is unchanged — only where the table is created has changed.

### 1. When Creating a New Table

1. Add the `CREATE TABLE IF NOT EXISTS` definition to `local_processing/db.py` (and, if it's populated by ingestion, add/extend a script under `local_processing/ingest/`)
2. **Immediately** create a schema file in this directory
3. Fill in all required fields
4. Commit to Git
5. Frontend team is automatically notified of new schema

### 2. When Updating an Existing Table

1. Make changes to the table definition in `local_processing/db.py` (add columns, adjust types — DuckDB `ALTER TABLE` or a rebuild, depending on the change)
2. If the table feeds an R2 export, update `local_processing/export/export_to_r2.py` (or the job script that writes it directly) accordingly
3. Update the corresponding schema file:
   - Increment version number
   - Update `last_updated` date
   - Add/modify columns as needed
   - Document breaking changes in description
4. Commit to Git
5. Frontend team validates changes against deployed UI

### 3. Schema Validation

Before merging any PR that touches tables:
- Run schema validation script (coming soon)
- Verify all export tables have schemas
- Check for breaking changes

## Priority Tables to Document

### ✅ Completed

- `gold_player_dim` - Master player dimension
- `export_player_news`, `export_breakout_candidates`, `export_defense_performance`, `export_sleeper_picks` — see existing `*_schema.json` files in this directory
- `bronze_article_labels`, `gold_player_mapping_corrections`, `user_settings`, `deep_reasoning` — see existing `*_schema.json` files in this directory

### 🔴 Pending

Cross-check `local_processing/db.py` (49 tables) against the `*_schema.json` files present in this directory and file schemas for any table still missing one — particularly the newer proprietary-metric tables (O-Line Index, O-Line Stability, Offensive Ecosystem, rookie scores) and anything feeding a new R2 export.

## Example Usage (Frontend)

```javascript
// Frontend reads schema to build dynamic table view
import playerSchema from './schemas/gold_player_dim_schema.json';

// Auto-generate table columns from schema
const columns = playerSchema.columns.map(col => ({
  field: col.name,
  headerName: col.description,
  type: col.type,
  required: !col.nullable
}));

// Validate API response against schema
function validatePlayerData(player) {
  playerSchema.columns.forEach(col => {
    if (!col.nullable && !player[col.name]) {
      throw new Error(`Missing required field: ${col.name}`);
    }
    // Additional type checking...
  });
}
```

## Contact

Questions about schema documentation? Contact: kingoffrisco@yahoo.com
