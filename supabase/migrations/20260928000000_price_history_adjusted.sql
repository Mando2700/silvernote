-- When each symbol's stored history was last downloaded in full. Split-adjusted history goes stale
-- when a split happens after it was stored, so rows without this date are re-downloaded once, and
-- later top-ups re-download in full whenever their overlap with the stored closes disagrees.
alter table public.price_history add column if not exists adjusted_at timestamptz;
