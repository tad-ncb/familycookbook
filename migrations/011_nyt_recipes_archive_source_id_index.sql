-- Archive-source loads page with: archive_source = X AND needs_review = false
-- ORDER BY id, id > last LIMIT 1000. With only the id index available, Postgres
-- sometimes walks the id index and filters, which for sparse sources
-- ("other") hits the anon statement timeout (57014) intermittently -- seen live
-- 2026-10-26. A composite index lets every source seek straight to its rows in
-- id order. IF NOT EXISTS keeps this safe to re-run.
-- NOTE: run via psql directly (not in a transaction block) so CONCURRENTLY works
-- and doesn't lock writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS nyt_recipes_archive_source_id_idx
  ON nyt_recipes (archive_source, id)
  WHERE needs_review = false;
ANALYZE nyt_recipes;
