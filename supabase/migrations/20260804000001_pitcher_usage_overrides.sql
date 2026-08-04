-- Persist manual pitcher usage classifications alongside each fantasy team's plan.

alter table pitcher_plans
    add column if not exists usage_overrides jsonb not null default '{}'::jsonb;
