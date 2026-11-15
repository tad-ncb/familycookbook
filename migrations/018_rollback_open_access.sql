-- Puts the synced tables back to fully open access for the public key (how they worked before 018).
-- Does not remove household_keys or the helper functions (017); re-run 018_enforce... to enforce again.
do $$
declare t text; p record;
begin
  foreach t in array array['cook_log','plan_days','inventory_items','shopping_lists','interested_recipes','prefs','recipe_collections','collection_items','family_submissions'] loop
    if to_regclass(t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('create policy "anon all" on %I for all to anon using (true) with check (true)', t);
  end loop;
end $$;
