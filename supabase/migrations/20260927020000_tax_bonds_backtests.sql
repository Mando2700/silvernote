-- Tax lots, individual bonds and rule backtests.

-- How sells relieve tax lots, and whether the account is taxed at all.
alter table public.portfolios add column if not exists lot_method text not null default 'fifo';
alter table public.portfolios add column if not exists account_type text not null default 'taxable';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'portfolios_lot_method_check') then
    alter table public.portfolios add constraint portfolios_lot_method_check check (lot_method in ('fifo', 'lifo', 'hifo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolios_account_type_check') then
    alter table public.portfolios add constraint portfolios_account_type_check check (account_type in ('taxable', 'tax_deferred', 'tax_free'));
  end if;
end $$;

-- Individual bonds held in a portfolio. Prices are per 100 of face value; coupon is an annual percent.
create table if not exists public.bond_holdings (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid not null references public.portfolios (id) on delete cascade,
  user_id         uuid not null,
  name            text not null,
  cusip           text,
  kind            text not null default 'treasury' check (kind in ('treasury', 'agency', 'corporate', 'municipal', 'cd', 'other')),
  face            double precision not null check (face > 0),
  coupon          double precision not null default 0 check (coupon >= 0 and coupon < 50),
  frequency       integer not null default 2 check (frequency in (0, 1, 2, 4, 12)),
  maturity        date not null,
  purchase_date   date not null,
  purchase_price  double precision not null check (purchase_price > 0),
  -- Optional quoted price that overrides the curve model.
  market_price    double precision check (market_price is null or market_price > 0),
  -- Optional spread over Treasuries (bp) that overrides the spread implied at purchase.
  spread_bps      double precision,
  day_count       text not null default '30/360' check (day_count in ('30/360', 'act/act')),
  rating          text,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists bond_holdings_portfolio_idx on public.bond_holdings (portfolio_id, maturity);

-- Point-in-time SilverNote Scores at each month end, rebuilt from filings available on that date.
create table if not exists public.score_panel (
  symbol      text not null,
  as_of       date not null,
  overall     integer not null,
  sub_scores  jsonb not null,
  price       double precision not null,
  market_cap  double precision,
  primary key (symbol, as_of)
);
create index if not exists score_panel_as_of_idx on public.score_panel (as_of);

create table if not exists public.backtest_strategies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  definition  jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists backtest_strategies_user_idx on public.backtest_strategies (user_id, updated_at desc);

select public.silvernote_enable_owner_policy(t) from unnest(array['bond_holdings', 'backtest_strategies']) as t;
alter table public.score_panel enable row level security;
