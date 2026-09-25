-- Writes the client-side-only Chicken Tikka Masala seed (see the
-- SEED_STATE.cookLog entry, id 'seed-ctm-1', in src/app.js) into the real
-- cook_log table.
--
-- That seed has always been baked into every device's local state so
-- Nick and Tyler's household would show it as already cooked/rated on
-- first load, but it was deliberately never written to Supabase (see
-- cookbook-meal-planner project notes: "not a DB row"). That's exactly why
-- it can't show up as "Nick and Tyler cooked this" on Jen and Chris's or
-- Craig and Kelly's History tab / recipe modal -- their view of other
-- households' cooking (DATA.otherCookLog) comes from a real database
-- query, and this row has never existed there. The 2026-09-21/24 app-side
-- fixes (commits 7fc0007, a474d8b) stopped it from showing up WRONGLY
-- attributed to whichever household was viewing, but can't retroactively
-- attribute a row that was never real -- only inserting it can.
--
-- id matches the local seed's id on purpose so the client-side merge
-- (mergeStates, keyed by id) treats this as the same entry rather than a
-- duplicate, once fetched back down to Nick and Tyler's own devices too.
insert into cook_log (id, recipe_id, household_id, rating, date, note, leftover, deleted, updated_at)
values ('seed-ctm-1', 'chicken-tikka-masala', 'nicholas-tyler', 5, '2026-08-23', '', '', false, now())
on conflict (id) do nothing;
