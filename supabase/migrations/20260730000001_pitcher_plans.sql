-- Persist each fantasy team's selected rotation, bubble starters, bullpen, and slot counts.
-- The public site reads and writes this data only through the pitcher-plan Edge Function.

create table if not exists pitcher_plans (
    league_uid       text not null references fantasy_leagues(league_uid) on delete cascade,
    team_uid         text not null references fantasy_teams(team_uid) on delete cascade,
    sp_target        integer not null default 5 check (sp_target between 0 and 20),
    bubble_target    integer not null default 0 check (bubble_target between 0 and sp_target),
    rp_target        integer not null default 5 check (rp_target between 0 and 20),
    selected_sp_keys jsonb not null default '[]'::jsonb,
    bubble_sp_keys   jsonb not null default '[]'::jsonb,
    selected_rp_keys jsonb not null default '[]'::jsonb,
    created_at       text not null,
    updated_at       text not null,
    primary key (league_uid, team_uid)
);

alter table pitcher_plans enable row level security;

-- Deliberately no anon/authenticated policies: the Edge Function owns all public access.
revoke all on table pitcher_plans from anon, authenticated;
