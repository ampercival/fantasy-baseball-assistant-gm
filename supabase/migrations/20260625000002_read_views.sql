-- Read-only views for the rankings tab, exposed via PostgREST so the static frontend can
-- read them directly (no Edge Function needed). security_invoker = on so base-table RLS
-- (public read) applies as the caller; SELECT is granted to anon + authenticated.

-- sources + their latest snapshot status + correction count (was list_sources_with_status).
create or replace view sources_with_status
with (security_invoker = on) as
select
    s.*,
    latest.id AS last_snapshot_id,
    latest.fetched_at AS last_fetched_at,
    latest.status AS last_status,
    latest.row_count AS last_row_count,
    latest.message AS last_message,
    latest.source_date AS last_source_date,
    latest.source_date_kind AS last_source_date_kind,
    COALESCE(corrections.correction_count, 0) AS correction_count
from sources s
left join (
    select snapshots.*
    from snapshots
    inner join (
        select source_id, MAX(id) AS max_id
        from snapshots
        group by source_id
    ) latest_ids on latest_ids.max_id = snapshots.id
) latest on latest.source_id = s.id
left join (
    select source_id, COUNT(*) AS correction_count
    from player_name_corrections
    group by source_id
) corrections on corrections.source_id = s.id
order by s.name, s.ranking_type;

-- corrections joined to their source's display names (was list_player_name_corrections).
create or replace view player_name_corrections_with_source
with (security_invoker = on) as
select
    c.*,
    s.name AS source_name,
    s.short_name AS source_short_name
from player_name_corrections c
join sources s on s.id = c.source_id
order by s.name, c.original_name;

grant select on sources_with_status to anon, authenticated;
grant select on player_name_corrections_with_source to anon, authenticated;
