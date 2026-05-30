# Databricks Notebook — FantasAI Fantasy Football Data
# -------------------------------------------------------
# Reads JSON files written to S3 by the GitHub Actions ETL workflow.
#
# S3 layout (all under s3://aws-kingoffrisco-s3-bucket/fantasai/):
#   league/latest.json
#   rosters/latest.json
#   injuries/latest.json
#   draft/season=YYYY/data.json
#   stats/season=YYYY/week=N/data.json         ← partitioned
#   projections/season=YYYY/week=N/data.json   ← partitioned
#
# Prerequisites:
#   1. Attach an IAM role to your Databricks cluster that can read the bucket,
#      OR set spark configs:
#        spark.hadoop.fs.s3a.access.key  <key>
#        spark.hadoop.fs.s3a.secret.key  <secret>
#   2. Run the GitHub Actions workflow at least once to populate S3.
# -------------------------------------------------------

BUCKET  = "aws-kingoffrisco-s3-bucket"
PREFIX  = "fantasai"
BASE    = f"s3://{BUCKET}/{PREFIX}"

# ── Helper ───────────────────────────────────────────────────────────────────

def read_json(path):
    """Read a single JSON file (API response envelope) into a DataFrame.
    Flattens the first array-valued key it finds so the result is tabular."""
    raw = spark.read.option("multiLine", True).json(path)
    # The API wraps rows in a key like "teams", "stats", "picks", etc.
    # Find the first StructType / ArrayType column and explode it.
    from pyspark.sql.types import ArrayType, StructType
    from pyspark.sql import functions as F
    for field in raw.schema.fields:
        if isinstance(field.dataType, ArrayType):
            return raw.select(F.explode(field.name).alias("row")).select("row.*")
    # Flat object (no array) — return as-is
    return raw

# ── League standings ──────────────────────────────────────────────────────────

df_league = read_json(f"{BASE}/league/latest.json")
print("League standings:")
display(df_league.select("name", "wins", "losses", "record", "points_for", "points_against", "point_diff")
                 .orderBy("wins", ascending=False))

# ── Current rosters ───────────────────────────────────────────────────────────

df_rosters_raw = spark.read.option("multiLine", True).json(f"{BASE}/rosters/latest.json")

from pyspark.sql import functions as F

df_rosters = (df_rosters_raw
    .select(F.explode("teams").alias("team"))
    .select(
        F.col("team.team_id"),
        F.explode("team.players").alias("player")
    )
    .select(
        "team_id",
        F.col("player.name").alias("name"),
        F.col("player.position").alias("position"),
        F.col("player.slot").alias("slot"),
        F.col("player.nfl_team").alias("nfl_team"),
        F.col("player.is_starter").alias("is_starter"),
    )
)
print("All rosters:")
display(df_rosters.orderBy("team_id", "slot"))

# ── Injury report ─────────────────────────────────────────────────────────────

df_injuries = read_json(f"{BASE}/injuries/latest.json")
print("Current injury report:")
display(df_injuries.select("name", "position", "nfl_team", "injury_status", "injury_body_part")
                   .orderBy("injury_status", "position"))

# ── Draft history ─────────────────────────────────────────────────────────────

DRAFT_YEAR = 2025
df_draft = read_json(f"{BASE}/draft/season={DRAFT_YEAR}/data.json")
print(f"{DRAFT_YEAR} draft picks:")
display(df_draft.select("overall", "round", "round_pick", "team_name", "player_name", "position", "nfl_team")
                .orderBy("overall"))

# ── Weekly stats — partitioned ────────────────────────────────────────────────
# AutoLoader will pick up new week files automatically as the workflow runs.

df_stats = (spark.read
    .option("multiLine", True)
    .json(f"{BASE}/stats/season=*/week=*/data.json")
)
# The season/week partition values are baked into the JSON by the ETL job.
print("Season stats (all weeks loaded):")
display(df_stats.select("season", "week", "sleeper_id", "pts_half_ppr",
                         "rush_yd", "rec_yd", "pass_yd", "rec_td", "rush_td", "pass_td")
                .filter(F.col("pts_half_ppr") > 0)
                .orderBy("season", "week", F.col("pts_half_ppr").desc()))

# ── Current week projections ──────────────────────────────────────────────────

SEASON = 2025
df_proj = read_json(f"{BASE}/projections/season={SEASON}/current_week.json")
print("This week's projections:")
display(df_proj.select("sleeper_id", "week", "pts_half_ppr", "rush_yd", "rec_yd", "pass_yd")
               .orderBy(F.col("pts_half_ppr").desc())
               .limit(50))

# ── Join rosters + stats: my team's weekly scores ────────────────────────────

MY_TEAM_ID = "8"   # CBS team ID for Armed Rodgery — update if different

my_roster = df_rosters.filter(F.col("team_id") == MY_TEAM_ID).select("name", "slot", "is_starter")

# Join on Sleeper ID isn't possible without a name lookup table yet,
# so join on player name (close enough for analysis).
df_team_stats = (df_stats
    .join(my_roster, df_stats.sleeper_id == my_roster.name, "inner")
    .select("week", "name", "slot", "pts_half_ppr", "rush_yd", "rec_yd", "pass_yd")
    .orderBy("week", F.col("pts_half_ppr").desc())
)
print("My roster weekly scores:")
display(df_team_stats)

# ── Weekly total points per team (standings validation) ───────────────────────

# Requires joining roster names to stats — placeholder for when a name→sleeperId
# lookup table is available from the /api/v1/players endpoint.
print("(Team-level scoring model: add player name→sleeperId mapping to complete)")

# ── Delta table persistence (optional) ───────────────────────────────────────
# Uncomment to write each dataset as a managed Delta table in your catalog.

# df_league.write.format("delta").mode("overwrite").saveAsTable("fantasai.league_standings")
# df_rosters.write.format("delta").mode("overwrite").saveAsTable("fantasai.rosters")
# df_injuries.write.format("delta").mode("overwrite").saveAsTable("fantasai.injuries")
# df_draft.write.format("delta").mode("overwrite").saveAsTable("fantasai.draft_2025")
# df_stats.write.format("delta").mode("overwrite").partitionBy("season","week").saveAsTable("fantasai.weekly_stats")
# df_proj.write.format("delta").mode("overwrite").saveAsTable("fantasai.projections_current")
