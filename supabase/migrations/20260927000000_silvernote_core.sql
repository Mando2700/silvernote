-- SilverNote core schema.
-- Runs unchanged on Supabase Postgres and on the local PGlite database.
-- Every statement is idempotent so the file can be applied by the Supabase CLI
-- or by SilverNote's own runner (npm run db:migrate / automatic on startup).

-- ═══════════════════════════════════════════════════════════════════════════
-- Market data cache (shared, server-only; no client policies)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.securities (
  symbol      text primary key,
  name        text not null,
  exchange    text,
  cik         text,
  sector      text,
  industry    text,
  country     text,
  ipo_year    integer,
  price       double precision,
  change      double precision,
  change_pct  double precision,
  volume      double precision,
  market_cap  double precision,
  is_common   boolean not null default true,
  listed      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists securities_sector_idx   on public.securities (sector);
create index if not exists securities_industry_idx on public.securities (industry);
create index if not exists securities_cap_idx      on public.securities (market_cap desc nulls last);
create index if not exists securities_cik_idx      on public.securities (cik);

-- Latest annual fundamentals per company (feeds the explorer and sector medians).
create table if not exists public.fundamentals (
  symbol               text primary key,
  fiscal_year          integer,
  period_end           date,
  currency             text,
  revenue              double precision,
  revenue_prev         double precision,
  revenue_3y_ago       double precision,
  gross_profit         double precision,
  operating_income     double precision,
  ebitda               double precision,
  net_income           double precision,
  net_income_prev      double precision,
  eps                  double precision,
  eps_prev             double precision,
  ocf                  double precision,
  capex                double precision,
  fcf                  double precision,
  fcf_prev             double precision,
  dividends_paid       double precision,
  total_assets         double precision,
  total_liabilities    double precision,
  total_equity         double precision,
  cash                 double precision,
  total_debt           double precision,
  current_assets       double precision,
  current_liabilities  double precision,
  shares               double precision,
  source               text,
  updated_at           timestamptz not null default now()
);

-- Standardized statements per company and frequency (periods newest first).
create table if not exists public.statement_sets (
  symbol      text not null,
  frequency   text not null check (frequency in ('annual', 'quarterly')),
  source      text not null,
  currency    text,
  periods     jsonb not null default '[]'::jsonb,
  meta        jsonb not null default '{}'::jsonb,
  fetched_at  timestamptz not null default now(),
  primary key (symbol, frequency)
);

-- Daily candles, stored compactly: [[epochSeconds, open, high, low, close, volume], ...] ascending.
create table if not exists public.price_history (
  symbol      text primary key,
  candles     jsonb not null default '[]'::jsonb,
  first_date  date,
  last_date   date,
  source      text,
  fetched_at  timestamptz not null default now()
);

-- SilverNote Score: latest result per company plus a compact history for trend lines and alerts.
create table if not exists public.scores (
  symbol         text primary key,
  overall        integer not null,
  label          text not null,
  confidence     text not null,
  data_quality   double precision,
  sub_scores     jsonb not null,
  payload        jsonb not null,
  input_level    text not null default 'universe',
  version        text not null,
  calculated_at  timestamptz not null default now()
);
create index if not exists scores_overall_idx on public.scores (overall desc);

create table if not exists public.score_history (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,
  overall        integer not null,
  sub_scores     jsonb not null,
  calculated_at  timestamptz not null default now()
);
create index if not exists score_history_symbol_idx on public.score_history (symbol, calculated_at desc);

-- Generic provider response cache (quotes, news, profiles, metrics).
create table if not exists public.api_cache (
  key         text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists api_cache_expires_idx on public.api_cache (expires_at);

-- Background jobs (universe refresh, fundamentals ingest, score sweep).
create table if not exists public.jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  status       text not null default 'queued',
  total        integer not null default 0,
  done         integer not null default 0,
  message      text,
  error        text,
  params       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists jobs_kind_idx on public.jobs (kind, created_at desc);

-- Daily call counters for rate-limited providers (FMP free = 250/day).
create table if not exists public.provider_usage (
  provider  text not null,
  day       date not null,
  calls     integer not null default 0,
  primary key (provider, day)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Personal data (row-level security: owner only)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.user_settings (
  user_id     uuid primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.watchlists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  name         text not null,
  description  text,
  color        text,
  columns      jsonb not null default '[]'::jsonb,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists watchlists_user_idx on public.watchlists (user_id, position);

create table if not exists public.watchlist_items (
  id            uuid primary key default gen_random_uuid(),
  watchlist_id  uuid not null references public.watchlists (id) on delete cascade,
  user_id       uuid not null,
  symbol        text not null,
  tags          text[] not null default '{}',
  note          text,
  added_price   double precision,
  position      integer not null default 0,
  added_at      timestamptz not null default now(),
  unique (watchlist_id, symbol)
);
create index if not exists watchlist_items_user_idx on public.watchlist_items (user_id, symbol);

create table if not exists public.alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  symbol        text not null,
  kind          text not null check (kind in ('price_above', 'price_below', 'change_pct', 'score_above', 'score_below', 'score_change')),
  threshold     double precision not null,
  active        boolean not null default true,
  note          text,
  last_value    double precision,
  triggered_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists alerts_user_idx on public.alerts (user_id, active);

create table if not exists public.alert_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  alert_id    uuid references public.alerts (id) on delete set null,
  symbol      text not null,
  kind        text not null,
  message     text not null,
  value       double precision,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists alert_events_user_idx on public.alert_events (user_id, created_at desc);

create table if not exists public.saved_screens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  definition  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.portfolios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  benchmark   text not null default 'SPY',
  cash        double precision not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  user_id       uuid not null,
  symbol        text not null,
  side          text not null check (side in ('buy', 'sell')),
  quantity      double precision not null check (quantity > 0),
  price         double precision not null check (price >= 0),
  fees          double precision not null default 0,
  traded_at     date not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists transactions_portfolio_idx on public.transactions (portfolio_id, traded_at);

-- Research workspace: one per company.
create table if not exists public.workspaces (
  user_id       uuid not null,
  symbol        text not null,
  stance        text not null default 'watch' check (stance in ('long', 'short', 'watch', 'avoid')),
  conviction    integer not null default 3 check (conviction between 1 and 5),
  target_price  double precision,
  horizon       text,
  status        text not null default 'researching',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- Every committed edit of a thesis section is a new row: the latest row is the current view,
-- older rows are the version history.
create table if not exists public.thesis_versions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  symbol        text not null,
  section       text not null check (section in ('thesis', 'drivers', 'risks', 'catalysts', 'disconfirming', 'valuation')),
  content       text not null,
  change_note   text,
  stance        text,
  conviction    integer,
  target_price  double precision,
  price_at      double precision,
  created_at    timestamptz not null default now()
);
create index if not exists thesis_versions_idx on public.thesis_versions (user_id, symbol, section, created_at desc);

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  symbol      text,
  title       text not null default '',
  content     text not null default '',
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);

create table if not exists public.note_versions (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.notes (id) on delete cascade,
  user_id     uuid not null,
  title       text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists note_versions_idx on public.note_versions (note_id, created_at desc);

create table if not exists public.pitches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  symbol          text not null,
  title           text not null,
  recommendation  text not null default 'long',
  target_price    double precision,
  sections        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pitches_user_idx on public.pitches (user_id, updated_at desc);

create table if not exists public.chat_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null default 'New conversation',
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chat_threads_user_idx on public.chat_threads (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads (id) on delete cascade,
  user_id     uuid not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════

-- Personal tables: the signed-in user can only see and change their own rows.
create or replace function public.silvernote_enable_owner_policy(target text) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', target);
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = target and policyname = target || '_owner'
  ) then
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      target || '_owner', target
    );
  end if;
end;
$$;

select public.silvernote_enable_owner_policy(t) from unnest(array[
  'user_settings', 'watchlists', 'watchlist_items', 'alerts', 'alert_events', 'saved_screens',
  'portfolios', 'transactions', 'workspaces', 'thesis_versions', 'notes', 'note_versions',
  'pitches', 'chat_threads', 'chat_messages'
]) as t;

-- Market cache tables: RLS on with no policies, so the public API keys can't read or write them.
-- The SilverNote server connects as the table owner and is unaffected.
alter table public.securities      enable row level security;
alter table public.fundamentals    enable row level security;
alter table public.statement_sets  enable row level security;
alter table public.price_history   enable row level security;
alter table public.scores          enable row level security;
alter table public.score_history   enable row level security;
alter table public.api_cache       enable row level security;
alter table public.jobs            enable row level security;
alter table public.provider_usage  enable row level security;
