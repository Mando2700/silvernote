-- The broker's positions as of the last sync. Balancing rows (openings before the synced history,
-- removals when the history holds more than the broker) are derived from this snapshot whenever the
-- ledger is read, so they always agree with how splits are applied to the trades at that moment.
alter table public.broker_accounts add column if not exists positions jsonb;
alter table public.broker_accounts add column if not exists positions_as_of date;
