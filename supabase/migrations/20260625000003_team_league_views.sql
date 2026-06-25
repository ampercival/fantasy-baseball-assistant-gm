-- List views for the Teams and Leagues tabs, exposed via PostgREST.
-- (Team detail with ranking enrichment is the team-detail Edge Function, not a view.)

-- fantasy_teams + latest snapshot status + standings (was list_teams_with_status).
create or replace view teams_with_status
with (security_invoker = on) as
select
    t.*,
    latest.id AS last_snapshot_id,
    latest.fetched_at AS last_fetched_at,
    latest.status AS last_status,
    latest.roster_count AS last_roster_count,
    latest.roster_limit AS last_roster_limit,
    latest.cap_used AS last_cap_used,
    latest.cap_limit AS last_cap_limit,
    latest.points AS last_points,
    latest.message AS last_message,
    membership.standings_rank,
    membership.points AS standings_points,
    membership.change AS standings_change
from fantasy_teams t
left join league_team_memberships membership on membership.team_uid = t.team_uid
left join (
    select team_snapshots.*
    from team_snapshots
    inner join (
        select team_uid, MAX(id) AS max_id
        from team_snapshots
        group by team_uid
    ) latest_ids on latest_ids.max_id = team_snapshots.id
) latest on latest.team_uid = t.team_uid
order by t.league_name, t.team_name;

-- fantasy_leagues + team/loaded/rostered counts (was list_leagues_with_status).
create or replace view leagues_with_status
with (security_invoker = on) as
select
    l.*,
    COUNT(DISTINCT m.team_uid) AS team_count,
    COUNT(DISTINCT latest_snapshots.id) AS loaded_team_count,
    COALESCE(SUM(latest_snapshots.roster_count), 0) AS rostered_player_count
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

grant select on teams_with_status to anon, authenticated;
grant select on leagues_with_status to anon, authenticated;
