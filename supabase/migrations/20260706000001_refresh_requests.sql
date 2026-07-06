-- Cloud refresh queue: the static site enqueues a request here; a worker on the operator's
-- machine picks it up, runs the scrape (writing to Supabase), and marks it done.
create table if not exists refresh_requests (
    id serial primary key,
    scope text not null default 'all',      -- 'all' | 'continuous' | 'leagues'
    status text not null default 'pending', -- 'pending' | 'running' | 'done' | 'error'
    requested_at text not null,
    started_at text,
    finished_at text,
    message text
);

create index if not exists idx_refresh_requests_status on refresh_requests(status, id);

-- Public read so the site can show request status. Inserts/updates happen only via the
-- request-refresh Edge Function and the local worker (service role, which bypasses RLS).
alter table refresh_requests enable row level security;
drop policy if exists refresh_requests_public_read on refresh_requests;
create policy refresh_requests_public_read on refresh_requests
    for select to anon, authenticated using (true);
