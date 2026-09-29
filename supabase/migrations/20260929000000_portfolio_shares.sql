-- Read-only links to a portfolio. Each link stores what it may reveal (`options`); a snapshot link also
-- stores the already-redacted view it froze, a live link recomputes that view on every visit.
-- The public page reads these rows through the SilverNote server, never through the public API keys.
create table if not exists public.portfolio_shares (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  portfolio_id   uuid not null references public.portfolios (id) on delete cascade,
  token          text not null unique,
  title          text,
  message        text,
  mode           text not null default 'live' check (mode in ('live', 'snapshot')),
  options        jsonb not null,
  snapshot       jsonb,
  passcode_hash  text,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  view_count     integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists portfolio_shares_portfolio_idx on public.portfolio_shares (portfolio_id, created_at desc);

select public.silvernote_enable_owner_policy('portfolio_shares');
