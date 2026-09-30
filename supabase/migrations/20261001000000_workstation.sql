-- Workstation upgrade: event alerts (filings, insider buys, earnings, thesis kill criteria), push and
-- Telegram delivery, a database-backed passcode limiter, the decision journal, stored AI briefs and
-- portfolio target weights.

alter table public.alerts drop constraint if exists alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check check (kind in (
  'price_above', 'price_below', 'change_pct', 'score_above', 'score_below', 'score_change',
  'filing', 'insider_buy', 'earnings', 'metric_above', 'metric_below'
));
-- metric_above / metric_below: which fundamental ratio (gross_margin, revenue_growth, …).
alter table public.alerts add column if not exists metric text;
-- 'thesis' when the alert was created from a thesis's "what would prove me wrong" criteria.
alter table public.alerts add column if not exists source text;
-- Per-alert memory for event alerts (last filing accession seen, last insider transaction, …).
alter table public.alerts add column if not exists state jsonb not null default '{}'::jsonb;

alter table public.alert_events add column if not exists delivered_at timestamptz;
create index if not exists alert_events_undelivered_idx on public.alert_events (created_at) where delivered_at is null;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  failed_at   timestamptz
);
select public.silvernote_enable_owner_policy('push_subscriptions');

-- Passcode guesses on shared links, counted across serverless instances.
create table if not exists public.share_attempts (
  key       text primary key,
  count     integer not null default 0,
  reset_at  timestamptz not null
);
alter table public.share_attempts enable row level security;

-- Decision journal: every call logged with price, target and confidence, scored as time passes.
create table if not exists public.decisions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  symbol        text not null,
  direction     text not null check (direction in ('long', 'short', 'avoid')),
  entry_price   double precision not null,
  entry_date    date not null default current_date,
  target_price  double precision,
  stop_price    double precision,
  horizon_date  date,
  confidence    integer not null default 60 check (confidence between 50 and 100),
  rationale     text not null default '',
  tags          text[] not null default '{}',
  status        text not null default 'open' check (status in ('open', 'closed')),
  exit_price    double precision,
  exit_date     date,
  outcome       text check (outcome in ('right', 'wrong', 'mixed')),
  postmortem    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists decisions_user_idx on public.decisions (user_id, status, entry_date desc);
select public.silvernote_enable_owner_policy('decisions');

-- Scheduled Grok output: morning briefs, weekly thesis red-teams, earnings previews.
create table if not exists public.ai_briefs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null check (kind in ('morning', 'redteam', 'earnings_preview')),
  symbol      text,
  title       text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ai_briefs_user_idx on public.ai_briefs (user_id, kind, created_at desc);
select public.silvernote_enable_owner_policy('ai_briefs');

-- Target weights per symbol (fractions summing to ≤ 1) for the rebalancing tool.
alter table public.portfolios add column if not exists targets jsonb not null default '{}'::jsonb;
