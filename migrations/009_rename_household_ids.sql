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

update cook_log            set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update cook_log            set household_id = 'chris-jen'      where household_id = 'berdux';

update plan_days           set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update plan_days           set household_id = 'chris-jen'      where household_id = 'berdux';

update inventory_items     set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update inventory_items     set household_id = 'chris-jen'      where household_id = 'berdux';

update prefs                set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update prefs                set household_id = 'chris-jen'      where household_id = 'berdux';

update interested_recipes  set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update interested_recipes  set household_id = 'chris-jen'      where household_id = 'berdux';

update shopping_lists       set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update shopping_lists       set household_id = 'chris-jen'      where household_id = 'berdux';

update client_errors        set household_id = 'nicholas-tyler' where household_id = 'deemer-berdux';
update client_errors        set household_id = 'chris-jen'      where household_id = 'berdux';
