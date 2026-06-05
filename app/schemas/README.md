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
  "table_name": "main.fantasai.{table_name}",
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

### 1. When Creating a New Table

1. Create the table in Databricks
2. **Immediately** create a schema file in this directory
3. Fill in all required fields
4. Commit to Git
5. Frontend team is automatically notified of new schema

### 2. When Updating an Existing Table

1. Make changes to the table in Databricks
2. Update the corresponding schema file:
   - Increment version number
   - Update `last_updated` date
   - Add/modify columns as needed
   - Document breaking changes in description
3. Commit to Git
4. Frontend team validates changes against deployed UI

### 3. Schema Validation

Before merging any PR that touches tables:
- Run schema validation script (coming soon)
- Verify all export tables have schemas
- Check for breaking changes

## Priority Tables to Document

### ✅ Completed

- `gold_player_dim` - Master player dimension

### 🔴 Pending (Priority 1 - Export Tables)

- `export_sleeper_picks`
- `export_breakout_candidates`
- `export_players_2026_draft`
- `draft_ready_roster_2026`

### 🔴 Pending (Priority 2 - Gold Layer)

- `gold_player_id_mapping`
- `gold_weekly_stats`
- `player_combine_results`

### 🔴 Pending (Priority 3 - Analytics Layer)

- `analytics_player_trends`
- `analytics_positional_rankings`
- `analytics_player_season_stats`
- `ml_predictions`

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
