-- When a security's price was last taken from a live quote. The universe screener trails the quote
-- API by a session, so its prices carry no timestamp of their own: rows priced only by the screener
-- keep this null, and readers treat them as stale.
alter table public.securities add column if not exists price_at timestamptz;
