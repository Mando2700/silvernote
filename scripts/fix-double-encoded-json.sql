-- One-off repair: before commit afbef16, postgres.js double-encoded json/jsonb params, so these
-- columns hold the JSON text as a string scalar. Unwrap them. Safe to re-run.
begin;
update public.user_settings       set data       = (data #>> '{}')::jsonb       where jsonb_typeof(data) = 'string'       and (data #>> '{}') is json;
update public.chat_threads        set context    = (context #>> '{}')::jsonb    where jsonb_typeof(context) = 'string'    and (context #>> '{}') is json;
update public.api_cache           set payload    = (payload #>> '{}')::jsonb    where jsonb_typeof(payload) = 'string'    and (payload #>> '{}') is json;
update public.jobs                set params     = (params #>> '{}')::jsonb     where jsonb_typeof(params) = 'string'     and (params #>> '{}') is json;
update public.price_history       set candles    = (candles #>> '{}')::jsonb    where jsonb_typeof(candles) = 'string'    and (candles #>> '{}') is json;
update public.backtest_strategies set definition = (definition #>> '{}')::jsonb where jsonb_typeof(definition) = 'string' and (definition #>> '{}') is json;
update public.learn_progress      set data       = (data #>> '{}')::jsonb       where jsonb_typeof(data) = 'string'       and (data #>> '{}') is json;
commit;
