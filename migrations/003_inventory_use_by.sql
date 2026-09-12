-- Optional expiration/use-by tracking on pantry/fridge/freezer items, feeding
-- a "using up soon" recipe nudge (see estimateMacros-adjacent inventoryMatchRatio
-- work in index.html). Nullable and never backfilled/required -- same
-- philosophy as every other optional field in this app.
alter table inventory_items add column if not exists use_by date;
