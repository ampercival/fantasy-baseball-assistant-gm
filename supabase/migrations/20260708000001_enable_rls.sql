-- Enable Row-Level Security on every public table.
--
-- Why: tables in the public schema without RLS are fully readable AND writable/deletable by
-- anyone holding the public anon key (Supabase flagged this as a CRITICAL "rls_disabled_in_public"
-- issue). This app's data is meant to be publicly *readable* (the GitHub Pages site reads it with
-- the anon key), but it must not be writable/deletable by the public.
--
-- How this stays safe without breaking anything:
--   * Writes run only through the local Python and the Edge Functions, which connect as the
--     `postgres` role (BYPASSRLS + table owner) - they ignore RLS entirely.
--   * The site reads through the `*_with_status` views (security_invoker=on) plus `refresh_requests`.
--     Those specific base tables get a read-only (SELECT) policy for anon/authenticated.
--   * Every other table is reached only via Edge Functions (service role), so it gets RLS with
--     NO anon policy => the public key can neither read nor write it directly.
--   * No INSERT/UPDATE/DELETE policies are created for anon anywhere => the public key cannot
--     modify or delete any data.

-- 1. Enable RLS on all public base tables (idempotent).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end$$;

-- 2. Read-only (SELECT) policies for the base tables the public site reads through the
--    security_invoker views. refresh_requests already has refresh_requests_public_read.
do $$
declare t text;
begin
  foreach t in array array[
    'sources',
    'snapshots',
    'player_name_corrections',
    'fantasy_teams',
    'fantasy_leagues',
    'league_team_memberships',
    'team_snapshots'
  ]
  loop
    execute format('drop policy if exists public_read on public.%I', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end$$;
