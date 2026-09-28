-- Changes Grok proposes in chat (save a note, add to a watchlist, set an alert, …). Nothing is applied
-- until the investor confirms it on the card under the answer.
create table if not exists public.ai_actions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  thread_id    uuid references public.chat_threads (id) on delete cascade,
  message_id   uuid references public.chat_messages (id) on delete cascade,
  kind         text not null,
  payload      jsonb not null default '{}'::jsonb,
  summary      text not null,
  status       text not null default 'pending' check (status in ('pending', 'done', 'declined', 'failed')),
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists ai_actions_thread_idx on public.ai_actions (thread_id, created_at);
create index if not exists ai_actions_message_idx on public.ai_actions (message_id);

select public.silvernote_enable_owner_policy('ai_actions');
