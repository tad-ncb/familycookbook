-- Refresh planner statistics for nyt_recipes so Postgres keeps choosing
-- nyt_recipes_archive_source_id_idx (see 011) for the per-source keyset scans.
-- Read-only in effect (updates stats only), safe to run any time, fine in the
-- Supabase SQL editor.
ANALYZE nyt_recipes;
