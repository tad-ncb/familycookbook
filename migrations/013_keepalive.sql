-- Free-tier Supabase projects pause after ~7 days of "inactivity", and read-only
-- REST pings evidently did not prevent it (paused 2026-11-08 despite successful
-- keep-alive reads on Nov 2 and Nov 5). The keep-alive workflow now UPSERTs a
-- single row here every day, so there is real write traffic, and a heartbeat
-- timestamp you can look at in the dashboard to see when it last landed.
create table if not exists keepalive (
  id int primary key,
  pinged_at timestamptz not null default now(),
  note text
);
alter table keepalive enable row level security;
drop policy if exists "anon can insert" on keepalive;
create policy "anon can insert" on keepalive for insert to anon with check (id = 1);
drop policy if exists "anon can update" on keepalive;
create policy "anon can update" on keepalive for update to anon using (id = 1) with check (id = 1);
drop policy if exists "anon can read" on keepalive;
create policy "anon can read" on keepalive for select to anon using (true);
insert into keepalive (id, note) values (1, 'seed') on conflict (id) do nothing;
