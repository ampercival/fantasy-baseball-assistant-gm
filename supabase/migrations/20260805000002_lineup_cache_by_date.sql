-- Store volatile probable-starter data by date and slower-changing reference data by season.
create table if not exists lineup_date_cache (
    game_date text primary key,
    game_count integer not null,
    probable_starter_count integer not null,
    games jsonb not null,
    source text not null,
    fetched_at text not null
);

create table if not exists lineup_reference_cache (
    season integer primary key,
    pitcher_stats jsonb not null,
    team_offense_ranks jsonb not null,
    source text not null,
    fetched_at text not null
);

-- Only the local worker and Edge Functions use these tables. They connect with roles that bypass RLS.
alter table lineup_date_cache enable row level security;
alter table lineup_reference_cache enable row level security;

create index if not exists lineup_date_cache_fetched_at_idx on lineup_date_cache (fetched_at);

create index if not exists lineup_reference_cache_fetched_at_idx on lineup_reference_cache (fetched_at);


-- Backfill the normalized caches from the existing one-row cache without another FanGraphs request.
insert into lineup_reference_cache (
    season, pitcher_stats, team_offense_ranks, source, fetched_at
)
select season, pitcher_stats, team_offense_ranks, source, generated_at
from lineup_data_cache
where cache_key = 'current'
on conflict (season) do nothing;

with cached_games as (
    select
        jsonb_array_elements(games) as game,
        source,
        generated_at
    from lineup_data_cache
    where cache_key = 'current'
),
future_games as (
    select game, source, generated_at, left(game->>'gameDate', 10) as game_date
    from cached_games
    where left(game->>'gameDate', 10) >= current_date::text
)
insert into lineup_date_cache (
    game_date, game_count, probable_starter_count, games, source, fetched_at
)
select
    game_date,
    greatest(1, round(count(*)::numeric / 2)::integer),
    count(*) filter (
        where coalesce(
            game #> '{team,sp}',
            game #> '{team,primaryPitcher}',
            game #> '{team,opener}'
        ) is not null
    )::integer,
    jsonb_agg(game),
    max(source),
    max(generated_at)
from future_games
where game_date is not null and game_date <> ''
group by game_date
on conflict (game_date) do nothing;

delete from lineup_date_cache
where game_date < current_date::text;
