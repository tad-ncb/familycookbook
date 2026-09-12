-- Lightweight client-side error log. Every bug found this session (the "me"
-- ReferenceError that broke every recipe-open, the quick-menu z-index bug)
-- was caught only because someone happened to notice and paste a console
-- screenshot -- this table lets a JS error/unhandledrejection report itself
-- instead of waiting on that. Rows are small (message + first few stack
-- lines, truncated client-side) and deduped per browser session, so this
-- shouldn't meaningfully move the needle on the free-tier database-size cap.
create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  household_id text,
  message text,
  stack text,
  url text,
  created_at timestamptz not null default now()
);
alter table client_errors enable row level security;
drop policy if exists "anon can insert" on client_errors;
create policy "anon can insert" on client_errors
  for insert to anon with check (true);
drop policy if exists "anon can read" on client_errors;
create policy "anon can read" on client_errors
  for select to anon using (true);
