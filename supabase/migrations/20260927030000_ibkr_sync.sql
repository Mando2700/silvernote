-- Interactive Brokers sync through the Flex Web Service (token + query id, no gateway process).

-- One IBKR login per user. The Flex token is a read-only reporting token, never an account password.
create table if not exists public.broker_connections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  broker           text not null default 'ibkr' check (broker in ('ibkr')),
  flex_token       text not null,
  flex_query_id    text not null,
  status           text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  error            text,
  message          text,
  last_attempt_at  timestamptz,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, broker)
);

-- Each IBKR account in the Flex statement syncs into its own portfolio.
create table if not exists public.broker_accounts (
  connection_id  uuid not null references public.broker_connections (id) on delete cascade,
  user_id        uuid not null,
  account_id     text not null,
  portfolio_id   uuid not null references public.portfolios (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (connection_id, account_id)
);

-- Synced trades carry the broker's id so re-syncs update instead of double-booking.
-- Manual trades leave it null (nulls never collide in a unique index).
alter table public.transactions add column if not exists broker_execution_id text;
create unique index if not exists transactions_broker_execution_idx on public.transactions (portfolio_id, broker_execution_id);

select public.silvernote_enable_owner_policy(t) from unnest(array['broker_connections', 'broker_accounts']) as t;
