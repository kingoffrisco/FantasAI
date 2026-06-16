-- FantasAI User Settings Table
-- Purpose: Store user preferences and settings across browsers/devices
-- Last Updated: June 8, 2026

CREATE TABLE IF NOT EXISTS main.fantasai.user_settings (
    user_id STRING NOT NULL COMMENT 'Unique user identifier (email or auth ID)',
    setting_category STRING NOT NULL COMMENT 'Category: draft_preferences, ui_layout, notifications, league_settings',
    setting_key STRING NOT NULL COMMENT 'Specific setting name',
    setting_value STRING NOT NULL COMMENT 'JSON-encoded setting value',
    setting_type STRING COMMENT 'Data type hint: string, number, boolean, json',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'First created',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Last modified',
    device_info STRING COMMENT 'Optional: Browser/device that last updated',
    
    -- Constraints
    CONSTRAINT pk_user_settings PRIMARY KEY (user_id, setting_category, setting_key)
)
COMMENT 'User preferences and settings for cross-browser/device consistency'
TBLPROPERTIES (
    'delta.autoOptimize.optimizeWrite' = 'true',
    'delta.autoOptimize.autoCompact' = 'true'
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user ON main.fantasai.user_settings (user_id);

-- Sample settings examples
COMMENT ON TABLE main.fantasai.user_settings IS 
'Examples:
- Draft Preferences: scoring_format (PPR/Half-PPR), roster_size, flex_positions
- UI Layout: view_mode (grid/list), column_order, filters, theme (dark/light)
- Notifications: waiver_alerts, injury_alerts, start_sit_reminders
- League Settings: default_league_id, favorite_players';

