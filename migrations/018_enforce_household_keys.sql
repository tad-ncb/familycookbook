-- STAGE 2: ENFORCE. Run only after 017 + the key hashes are in place AND every device has opened its
-- household link once (a device without its key can still read everything, but its changes will be
-- refused and the app shows "read-only"). To undo: 018_rollback_open_access.sql.
--
-- For each table below: every existing policy is dropped (their names aren't known here, and a leftover
-- permissive policy would silently defeat this), then
--   SELECT  -> open to everyone (households may read each other)
--   INSERT / UPDATE / DELETE -> only with the matching household's key
-- family_submissions has no household column: any valid household key may write.
-- client_errors stays open for inserts (so errors from a device without a key are still logged) and reads.
do $$
declare t text; p record;
begin
  foreach t in array array['cook_log','plan_days','inventory_items','shopping_lists','interested_recipes','prefs','recipe_collections','collection_items'] loop
    if to_regclass(t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('alter table %I enable row level security', t);
    execute format('create policy "read all" on %I for select to anon using (true)', t);
    execute format('create policy "write own household" on %I for insert to anon with check (key_ok_for(household_id))', t);
    execute format('create policy "update own household" on %I for update to anon using (key_ok_for(household_id)) with check (key_ok_for(household_id))', t);
    execute format('create policy "delete own household" on %I for delete to anon using (key_ok_for(household_id))', t);
  end loop;

  if to_regclass('family_submissions') is not null then
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'family_submissions' loop
      execute format('drop policy %I on family_submissions', p.policyname);
    end loop;
    alter table family_submissions enable row level security;
    create policy "read all" on family_submissions for select to anon using (true);
    create policy "write with any household key" on family_submissions for insert to anon with check (any_key_ok());
    create policy "update with any household key" on family_submissions for update to anon using (any_key_ok()) with check (any_key_ok());
    create policy "delete with any household key" on family_submissions for delete to anon using (any_key_ok());
  end if;
end $$;
