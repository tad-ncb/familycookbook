-- interested_recipes was deliberately shared across households (no
-- household_id at all). Tyler decided "interested"/hearts should NOT be
-- shared -- each household gets its own shortlist -- while ratings/last-made
-- on cook_log (already household-scoped) stay visible across households.
--
-- Existing rows predate any household concept and all belong to the
-- original (only) household, same backfill pattern already used for
-- cook_log (see householdOf() in index.html).
--
-- NOTE (2026-09-18): this migration sat unrun long enough that the
-- household ids it originally referenced ('deemer-berdux') were renamed to
-- 'nicholas-tyler' by migrations/009_rename_household_ids.sql before this
-- one ever ran. Backfilling straight to the current id here instead of the
-- retired one, so there's no need to run 009 again afterward.
alter table interested_recipes add column if not exists household_id text;
update interested_recipes set household_id = 'nicholas-tyler' where household_id is null;

-- If a unique/primary-key constraint exists on recipe_id alone (from when this
-- was one shared row per recipe), it must go -- otherwise two households
-- marking the same recipe "interested" would silently overwrite each other's
-- row instead of each getting their own, which is exactly the failure mode
-- this whole feature exists to avoid. Detected by introspection rather than
-- assumed, since the anon key this app runs on can't tell us this from outside.
do $$
declare
  con record;
begin
  for con in
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public' and tc.table_name = 'interested_recipes'
      and tc.constraint_type in ('UNIQUE','PRIMARY KEY')
    group by tc.constraint_name
    having count(*) = 1 and bool_and(kcu.column_name = 'recipe_id')
  loop
    execute format('alter table interested_recipes drop constraint %I', con.constraint_name);
  end loop;
end $$;

-- The correct constraint going forward: one row per recipe PER household.
-- Postgres has no "add constraint if not exists" -- ADD CONSTRAINT doesn't
-- accept IF NOT EXISTS at all (unlike ADD COLUMN above), so existence has
-- to be checked explicitly or a second run of this migration errors on a
-- duplicate constraint name instead of being a harmless no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'interested_recipes_recipe_household_key'
  ) then
    alter table interested_recipes
      add constraint interested_recipes_recipe_household_key unique (recipe_id, household_id);
  end if;
end $$;
