from db import get_conn
conn = get_conn()

print("=== 2026 rookies in bronze_player_news_raw ===")
rows = conn.execute("""
    SELECT player_name, position, team, depth_chart_order, depth_chart_position, years_exp
    FROM bronze_player_news_raw
    WHERE years_exp = 0 AND position IN ('QB','RB','WR','TE')
    ORDER BY position, depth_chart_order NULLS LAST
    LIMIT 20
""").fetchdf()
print(rows.to_string())

print("\n=== bronze_combine_data 2026: draft data coverage ===")
r2 = conn.execute("""
    SELECT
        COUNT(*) AS total,
        COUNT(draft_ovr) AS with_pick,
        COUNT(draft_round) AS with_round,
        COUNT(forty) AS with_40,
        COUNT(vertical) AS with_vertical
    FROM bronze_combine_data WHERE season = 2026 AND pos IN ('QB','RB','WR','TE')
""").fetchdf()
print(r2.to_string())

print("\n=== Sample 2026 skill-pos combine rows ===")
r3 = conn.execute("""
    SELECT player_name, pos, draft_round, draft_ovr, draft_team,
           forty, vertical, broad_jump, school
    FROM bronze_combine_data
    WHERE season = 2026 AND pos IN ('QB','RB','WR','TE')
    ORDER BY draft_ovr NULLS LAST
    LIMIT 15
""").fetchdf()
print(r3.to_string())

print("\n=== All DuckDB tables ===")
tables = conn.execute("SHOW TABLES").fetchdf()
print(tables.to_string())
