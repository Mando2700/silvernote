-- Learn: lesson, drill and flashcard progress (one row per item) and graded practice work (pitches,
-- written interview answers) with the rubric score and Grok's grade.
create table if not exists public.learn_progress (
  user_id     uuid not null,
  item_id     text not null,
  kind        text not null check (kind in ('lesson', 'drill', 'card')),
  score       double precision,
  best        double precision,
  attempts    integer not null default 0,
  data        jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.learn_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null check (kind in ('pitch', 'answer')),
  ref         text,
  title       text not null,
  content     jsonb not null,
  rubric      jsonb,
  grade       jsonb,
  score       double precision,
  created_at  timestamptz not null default now()
);
create index if not exists learn_attempts_user_idx on public.learn_attempts (user_id, kind, created_at desc);

select public.silvernote_enable_owner_policy('learn_progress');
select public.silvernote_enable_owner_policy('learn_attempts');
