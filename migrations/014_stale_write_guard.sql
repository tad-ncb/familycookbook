-- Stale-write guard. Every synced row carries updated_at (set by the app from the
-- device's clock when the edit was made). The app already resolves conflicts
-- "newest edit wins" on the client, but the database accepted ANY upsert -- so a
-- phone that was offline for days could, on reconnecting, overwrite a newer edit
-- another device had already saved. This makes the database apply the same rule:
-- an UPDATE whose updated_at is OLDER than the stored row's is silently skipped.
-- Equal timestamps still apply (an idempotent retry of the same edit is fine).
-- Deletes in this app are tombstones (deleted = true + a newer updated_at), so they
-- are ordinary updates and are covered too.
-- Safe to run more than once. Run in the Supabase SQL editor.
create or replace function skip_stale_write() returns trigger
language plpgsql as $$
begin
  if new.updated_at is not null and old.updated_at is not null and new.updated_at < old.updated_at then
    return null;  -- keep the newer stored row, drop this update without an error
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cook_log','plan_days','inventory_items','shopping_lists','interested_recipes','prefs'] loop
    execute format('drop trigger if exists skip_stale_write on %I', t);
    execute format('create trigger skip_stale_write before update on %I for each row execute function skip_stale_write()', t);
  end loop;
end $$;
