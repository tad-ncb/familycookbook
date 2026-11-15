-- STAGE 1 of per-household write protection. Harmless on its own: it only ADDS a locked-away table
-- and two helper functions; it changes no policy, so nothing about how the app works changes.
--
-- The model (matches how you said it should work): every household can still READ every other
-- household's data (ratings, cook history...), but only a device that holds a household's key can
-- WRITE that household's rows. The key travels as a request header, which Supabase exposes to
-- policies via current_setting('request.headers'). Only a SHA-256 hash of each key is stored here.
--
--   1. python3 tools/make_household_keys.py        -> prints each household's link (with &k=<key>)
--                                                      and the SQL that stores the key hashes
--   2. run that SQL in the Supabase SQL editor (after this file)
--   3. send each household its link; opening it once saves the key on that device
--   4. when every device has opened its link: run 018_enforce_household_keys.sql
--      (and 018_rollback_open_access.sql puts everything back the way it was, if ever needed)
create table if not exists household_keys (
  household_id text primary key,
  key_hash text not null
);
-- row level security on, and NO policy: the public key can neither read nor write this table
alter table household_keys enable row level security;
revoke all on household_keys from anon, authenticated;

create or replace function request_key_hash() returns text
language sql stable as $$
  select encode(sha256(convert_to(coalesce((nullif(current_setting('request.headers', true), '')::json) ->> 'x-household-key', ''), 'UTF8')), 'hex')
$$;

-- security definer: policies call these as the (locked-out) public role, the functions read the key table
create or replace function key_ok_for(hid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_keys k where k.household_id = hid and k.key_hash = request_key_hash())
$$;
create or replace function any_key_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_keys k where k.key_hash = request_key_hash())
$$;
grant execute on function key_ok_for(text), any_key_ok() to anon, authenticated;
