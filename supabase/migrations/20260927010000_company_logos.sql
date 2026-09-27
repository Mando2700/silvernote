-- Company logos: fetched once from public logo sources, then served from the database.
-- A row with null data records a miss so the sources are not asked again until retry_after.
create table if not exists public.company_logos (
  symbol       text primary key,
  content_type text,
  data         bytea,
  source       text not null,
  fetched_at   timestamptz not null default now()
);

-- Market cache table: RLS on with no policies (server-only), like the other caches.
alter table public.company_logos enable row level security;
