-- Named recipe collections ("Thanksgiving", "Weeknights"): a household's own groups of recipes.
-- Two small tables, shaped like the other synced ones (soft deletes + updated_at; private to a
-- household by household_id, enforced by the app the same way as plan/lists/storage).
--   recipe_collections : one row per collection
--   collection_items   : one row per (collection, recipe); id = '<collection id>|<recipe id>'
-- Needs migration 014 (the skip_stale_write() function) to have been run.
-- Until this is run the app works with collections on the device only; they start syncing, and
-- are included in the daily backup, as soon as the tables exist. Safe to run more than once.
create table if not exists recipe_collections (
  id text primary key,
  household_id text not null,
  name text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists collection_items (
  id text primary key,
  household_id text not null,
  collection_id text not null,
  recipe_id text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists recipe_collections_household_idx on recipe_collections (household_id);
create index if not exists collection_items_household_idx on collection_items (household_id);

alter table recipe_collections enable row level security;
alter table collection_items enable row level security;
drop policy if exists "anon all" on recipe_collections;
create policy "anon all" on recipe_collections for all to anon using (true) with check (true);
drop policy if exists "anon all" on collection_items;
create policy "anon all" on collection_items for all to anon using (true) with check (true);

-- a newer edit is never overwritten by an older one (see 014)
drop trigger if exists skip_stale_write on recipe_collections;
create trigger skip_stale_write before update on recipe_collections for each row execute function skip_stale_write();
drop trigger if exists skip_stale_write on collection_items;
create trigger skip_stale_write before update on collection_items for each row execute function skip_stale_write();

-- live updates between a household's devices (Supabase only; skipped where there is no such publication)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table recipe_collections; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table collection_items; exception when duplicate_object then null; end;
  end if;
end $$;
