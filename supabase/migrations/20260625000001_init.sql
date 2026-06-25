-- Initial schema for Fantasy Baseball Assistant GM (ported from the local SQLite DB).
-- Types resolved for Postgres: SERIAL ids, TEXT/INTEGER/REAL columns, FK ON DELETE CASCADE.
--
-- RLS posture (Phase 1 / M1): row-level security is ON for every table with a public
-- SELECT policy, so the static site can read the board anonymously. No INSERT/UPDATE/DELETE
-- policies exist yet, so writes are only possible via the service role (data migration and
-- Edge Functions). Authenticated write policies + per-user ownership (user_id) arrive in
-- Phase 5. Source-registry rows are loaded by the one-time data migration, not seeded here.

-- ───────────────────────────── Rankings (global reference data) ─────────────────────────────

create table if not exists sources (
    id           text primary key,
    name         text not null,
    short_name   text not null,
    ranking_type text not null,
    url          text not null,
    scraper      text not null,
    access       text not null,
    notes        text not null,
    source_tag   text not null default 'Updated',
    included     integer not null default 1,
    can_update   integer not null
);

create table if not exists snapshots (
    id               serial primary key,
    source_id        text not null references sources(id),
    fetched_at       text not null,
    status           text not null,
    row_count        integer not null default 0,
    message          text not null default '',
    source_url       text not null,
    source_date      text,
    source_date_kind text
);

create table if not exists ranking_entries (
    id          serial primary key,
    snapshot_id integer not null references snapshots(id) on delete cascade,
    source_id   text not null references sources(id),
    rank        integer not null,
    player_name text not null,
    player_key  text not null,
    team        text,
    positions   text,
    age         real
);

create index if not exists idx_snapshots_source_status
    on snapshots(source_id, status, fetched_at desc);
create index if not exists idx_entries_snapshot
    on ranking_entries(snapshot_id);
create index if not exists idx_entries_player_key
    on ranking_entries(player_key);

create table if not exists player_name_corrections (
    id                   serial primary key,
    source_id            text not null references sources(id) on delete cascade,
    original_name        text not null,
    original_player_key  text not null,
    corrected_name       text not null,
    corrected_player_key text not null,
    created_at           text not null,
    updated_at           text not null,
    unique(source_id, original_player_key)
);

create index if not exists idx_player_name_corrections_source_key
    on player_name_corrections(source_id, original_player_key);

-- ───────────────────────────── Fantasy teams / leagues ─────────────────────────────

create table if not exists fantasy_teams (
    team_uid    text primary key,
    platform    text not null,
    league_id   integer not null,
    team_id     integer not null,
    league_name text,
    team_name   text not null,
    owner       text,
    url         text not null,
    created_at  text not null,
    updated_at  text not null
);

create table if not exists fantasy_leagues (
    league_uid  text primary key,
    platform    text not null,
    league_id   integer not null,
    league_name text not null,
    url         text not null,
    created_at  text not null,
    updated_at  text not null
);

create table if not exists league_team_memberships (
    league_uid     text not null references fantasy_leagues(league_uid) on delete cascade,
    team_uid       text not null references fantasy_teams(team_uid) on delete cascade,
    team_name      text not null,
    team_url       text not null,
    standings_rank integer,
    points         real,
    change         real,
    updated_at     text not null,
    primary key (league_uid, team_uid)
);

create table if not exists team_snapshots (
    id                  serial primary key,
    team_uid            text not null references fantasy_teams(team_uid),
    fetched_at          text not null,
    status              text not null,
    roster_count        integer,
    roster_limit        integer,
    cap_used            integer,
    cap_limit           integer,
    salary_total        integer,
    penalty_total       integer,
    loans_in            integer,
    loans_out           integer,
    standings_rank      text,
    points              real,
    last_transaction    text,
    trade_block_updated text,
    trade_block_note    text,
    message             text not null default '',
    source_url          text not null
);

create table if not exists team_roster_entries (
    id                serial primary key,
    snapshot_id       integer not null references team_snapshots(id) on delete cascade,
    team_uid          text not null references fantasy_teams(team_uid),
    section           text not null,
    ottoneu_player_id integer,
    player_name       text not null,
    player_key        text not null,
    mlb_team          text,
    status            text,
    salary            integer not null,
    positions         text,
    games             integer,
    plate_appearances integer,
    games_started     integer,
    innings_pitched   real,
    points_per_game   real,
    points_per_ip     real,
    points            real
);

create table if not exists team_cap_penalties (
    id          serial primary key,
    snapshot_id integer not null references team_snapshots(id) on delete cascade,
    team_uid    text not null references fantasy_teams(team_uid),
    player_name text not null,
    player_key  text not null,
    penalty     integer not null,
    cut_date    text
);

create table if not exists team_loans (
    id           serial primary key,
    snapshot_id  integer not null references team_snapshots(id) on delete cascade,
    team_uid     text not null references fantasy_teams(team_uid),
    direction    text not null,
    counterparty text not null,
    amount       integer not null
);

create table if not exists team_trade_block (
    id          serial primary key,
    snapshot_id integer not null references team_snapshots(id) on delete cascade,
    team_uid    text not null references fantasy_teams(team_uid),
    side        text not null,
    player_name text not null,
    player_key  text not null,
    positions   text,
    salary      integer
);

create index if not exists idx_team_snapshots_team_status
    on team_snapshots(team_uid, status, fetched_at desc);
create index if not exists idx_team_roster_snapshot
    on team_roster_entries(snapshot_id);
create index if not exists idx_team_roster_player_key
    on team_roster_entries(player_key);

-- ───────────────────────────── Lineup helper ─────────────────────────────

create table if not exists pitcher_xfip_stats (
    pitcher_key  text primary key,
    pitcher_name text not null,
    season       integer not null,
    xfip_minus   real not null,
    source       text not null,
    updated_at   text not null
);

create index if not exists idx_pitcher_xfip_stats_season
    on pitcher_xfip_stats(season, pitcher_name);

create table if not exists lineup_always_start_players (
    league_uid  text not null references fantasy_leagues(league_uid) on delete cascade,
    team_uid    text not null references fantasy_teams(team_uid) on delete cascade,
    player_key  text not null,
    player_name text not null,
    created_at  text not null,
    updated_at  text not null,
    primary key (league_uid, team_uid, player_key)
);

create table if not exists lineup_always_sit_players (
    league_uid  text not null references fantasy_leagues(league_uid) on delete cascade,
    team_uid    text not null references fantasy_teams(team_uid) on delete cascade,
    player_key  text not null,
    player_name text not null,
    created_at  text not null,
    updated_at  text not null,
    primary key (league_uid, team_uid, player_key)
);

-- ───────────────────────────── Row-Level Security ─────────────────────────────
-- Enable RLS everywhere and grant anonymous SELECT (data is public-read). Writes have no
-- policy yet, so only the service role can mutate until Phase 5 adds authenticated policies.

do $$
declare
    t text;
    tables text[] := array[
        'sources', 'snapshots', 'ranking_entries', 'player_name_corrections',
        'fantasy_teams', 'fantasy_leagues', 'league_team_memberships',
        'team_snapshots', 'team_roster_entries', 'team_cap_penalties',
        'team_loans', 'team_trade_block', 'pitcher_xfip_stats',
        'lineup_always_start_players', 'lineup_always_sit_players'
    ];
begin
    foreach t in array tables loop
        execute format('alter table %I enable row level security', t);
        execute format(
            'create policy %I on %I for select to anon, authenticated using (true)',
            t || '_public_read', t
        );
    end loop;
end $$;
