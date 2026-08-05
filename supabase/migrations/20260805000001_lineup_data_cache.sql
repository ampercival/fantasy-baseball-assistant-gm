-- FanGraphs data fetched by the operator's home worker and consumed by hosted lineup functions.
create table if not exists lineup_data_cache (
    cache_key text primary key,
    season integer not null,
    start_date text not null,
    end_date text not null,
    games jsonb not null,
    pitcher_stats jsonb not null,
    team_offense_ranks jsonb not null,
    source text not null,
    generated_at text not null
);

-- Only the local worker and Edge Functions use this table. They connect with roles that bypass RLS.
alter table lineup_data_cache enable row level security;
