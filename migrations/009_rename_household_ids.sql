-- Renames the two original household ids to the names Tyler asked for
-- (2026-09-18): 'deemer-berdux' -> 'nicholas-tyler', 'berdux' -> 'chris-jen'.
-- 'craig-kelly' (the third household, added same day) is unaffected.
--
-- Run this once, after deploying the app.js change that ships alongside it.
-- Until this runs, existing rows still carry the OLD ids, but the app keeps
-- working: currentHousehold() migrates a device's saved id (or an old
-- bookmarked ?hh= link) to the new id, and rowToCook() translates old
-- household_id values back to the new id on read. What breaks without this
-- migration: cross-household "the other household cooked this N times"
-- reads (remoteFetchAll's otherCookLog query filters by the NEW id only),
-- and any household_id-scoped table read straight in the Supabase dashboard
-- will look stale until this runs.
--
-- Written defensively: not every table listed necessarily has a
-- household_id column yet on this database (e.g. interested_recipes only
-- gets one if migration 002 was actually run -- as of 2026-09-18 it hadn't
-- been, so a plain `update interested_recipes set household_id = ...`
-- fails with "column does not exist" and aborts the whole script). Each
-- table's update is skipped, not fatal, if its household_id column isn't
-- there -- run \d <table> or check the table editor afterward to see which
-- ones were actually touched.
do $$
declare
  t text;
  tables text[] := array['cook_log','plan_days','inventory_items','prefs',
                          'interested_recipes','shopping_lists','client_errors'];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'household_id'
    ) then
      execute format('update %I set household_id = %L where household_id = %L', t, 'nicholas-tyler', 'deemer-berdux');
      execute format('update %I set household_id = %L where household_id = %L', t, 'chris-jen', 'berdux');
      raise notice 'updated %', t;
    else
      raise notice 'skipped % (no household_id column)', t;
    end if;
  end loop;
end $$;
