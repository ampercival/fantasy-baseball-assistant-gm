-- Persist platform-level sampling configuration and the latest randomly sampled
-- Ottoneu salary curve. The sample itself changes on every refresh.

create table if not exists platform_value_curve_settings (
    platform      text primary key,
    sample_size   integer not null default 20 check (sample_size between 1 and 500),
    created_at    text not null,
    updated_at    text not null
);

insert into platform_value_curve_settings (platform, sample_size, created_at, updated_at)
values ('ottoneu', 20, now()::text, now()::text)
on conflict (platform) do nothing;

create table if not exists platform_value_curves (
    platform                  text primary key references platform_value_curve_settings(platform) on delete cascade,
    parameters                jsonb not null,
    points                    jsonb not null,
    sampled_leagues           jsonb not null,
    failed_leagues            jsonb not null default '[]'::jsonb,
    sample_size               integer not null check (sample_size between 1 and 500),
    successful_league_count   integer not null check (successful_league_count >= 1),
    attempted_league_count    integer not null check (attempted_league_count >= successful_league_count),
    rank_count                integer not null check (rank_count >= 8),
    observation_count         integer not null check (observation_count >= rank_count),
    rmse                      real not null check (rmse >= 0),
    model_version             integer not null default 1,
    generated_at              text not null
);

alter table platform_value_curve_settings enable row level security;
drop policy if exists public_read on platform_value_curve_settings;
create policy public_read on platform_value_curve_settings
    for select to anon, authenticated using (true);

alter table platform_value_curves enable row level security;
drop policy if exists public_read on platform_value_curves;
create policy public_read on platform_value_curves
    for select to anon, authenticated using (true);

grant select on platform_value_curve_settings, platform_value_curves to anon, authenticated;
