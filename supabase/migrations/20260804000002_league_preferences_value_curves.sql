-- Persist the single-owner app preference for "my team" and cache the fitted
-- salary curve produced from each league's latest successful team snapshots.

alter table fantasy_leagues
    add column if not exists my_team_uid text references fantasy_teams(team_uid) on delete set null;

create table if not exists league_value_curves (
    league_uid             text primary key references fantasy_leagues(league_uid) on delete cascade,
    parameters             jsonb not null,
    player_count           integer not null check (player_count >= 8),
    rmse                   real not null check (rmse >= 0),
    source_snapshot_max_id integer not null,
    model_version          integer not null default 1,
    generated_at           text not null
);

alter table league_value_curves enable row level security;
drop policy if exists public_read on league_value_curves;
create policy public_read on league_value_curves
    for select to anon, authenticated using (true);

grant select on league_value_curves to anon, authenticated;

-- Keep the existing view column order and append the new preference so
-- CREATE OR REPLACE remains safe for PostgREST consumers.
create or replace view leagues_with_status
with (security_invoker = on) as
select
    l.league_uid,
    l.platform,
    l.league_id,
    l.league_name,
    l.url,
    l.created_at,
    l.updated_at,
    COUNT(DISTINCT m.team_uid) AS team_count,
    COUNT(DISTINCT latest_snapshots.id) AS loaded_team_count,
    COALESCE(SUM(latest_snapshots.roster_count), 0) AS rostered_player_count,
    l.my_team_uid
from fantasy_leagues l
left join league_team_memberships m on m.league_uid = l.league_uid
left join (
    select team_snapshots.*
    from team_snapshots
    inner join (
        select team_uid, MAX(id) AS max_id
        from team_snapshots
        where status = 'success'
        group by team_uid
    ) latest_ids on latest_ids.max_id = team_snapshots.id
) latest_snapshots on latest_snapshots.team_uid = m.team_uid
group by l.league_uid
order by l.league_name;

grant select on leagues_with_status to anon, authenticated;
