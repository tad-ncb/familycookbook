-- DO NOT RUN YET. Run only after (1) the static-archive version of the site has been
-- live for about a week with no problems, and (2) the keep-alive workflow no longer
-- reads this table (it now reads `keepalive`). The app no longer touches it: the
-- archive is static files in data/archive/, rebuilt from the lossless snapshot in
-- backups/nyt_recipes/. This frees ~225MB of the 500MB free-tier database.
-- Not reversible from inside Supabase; the snapshot in git is the only copy.
drop table if exists nyt_recipes;
