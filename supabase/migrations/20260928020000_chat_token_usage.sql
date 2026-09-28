alter table public.chat_messages
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists cost_usd numeric(12, 6);
