import 'server-only';

import { q, q1 } from '@/lib/db';
import { todayInNewYork } from '@/lib/dates';
import { calibration, scoreDecision, type Decision } from '@/lib/finance/journal';
import { getLiveQuote, getQuotes } from '@/lib/services/market';

export type DecisionRow = Decision & {
  user_id: string;
  rationale: string;
  tags: string[];
  exit_date: string | null;
  postmortem: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `id, user_id, symbol, direction, entry_price, entry_date::text as entry_date, target_price, stop_price, horizon_date::text as horizon_date,
  confidence, rationale, tags, status, exit_price, exit_date::text as exit_date, outcome, postmortem, created_at, updated_at`;

export async function listDecisions(userId: string) {
  const rows = await q<DecisionRow>(`select ${COLUMNS} from public.decisions where user_id = $1 order by status, entry_date desc, created_at desc`, [userId]);
  const quotes = await getQuotes(rows.map((row) => row.symbol));
  const today = todayInNewYork();
  const scored = rows.map((row) => ({ ...row, price: quotes[row.symbol]?.price ?? null, score: scoreDecision(row, quotes[row.symbol]?.price ?? null, today) }));
  return { decisions: scored, stats: calibration(rows, scored.map((row) => row.score)) };
}

export type DecisionInput = {
  symbol: string;
  direction: 'long' | 'short' | 'avoid';
  entry_price?: number | null;
  entry_date?: string;
  target_price?: number | null;
  stop_price?: number | null;
  horizon_date?: string | null;
  confidence: number;
  rationale?: string;
  tags?: string[];
};

export async function createDecision(userId: string, input: DecisionInput) {
  const symbol = input.symbol.toUpperCase();
  // Default the entry to the current price so a call can be logged in one step.
  const entry = input.entry_price ?? (await getLiveQuote(symbol).catch(() => null))?.price ?? null;
  if (!entry) throw new Error(`No price for ${symbol}; enter the entry price.`);
  return q1<DecisionRow>(
    `insert into public.decisions (user_id, symbol, direction, entry_price, entry_date, target_price, stop_price, horizon_date, confidence, rationale, tags)
     values ($1, $2, $3, $4, coalesce($5::date, current_date), $6, $7, $8, $9, $10, $11) returning ${COLUMNS}`,
    [userId, symbol, input.direction, entry, input.entry_date ?? null, input.target_price ?? null, input.stop_price ?? null, input.horizon_date ?? null, input.confidence, input.rationale ?? '', input.tags ?? []],
  );
}

export async function updateDecision(
  userId: string,
  id: string,
  patch: Partial<DecisionInput> & { status?: 'open' | 'closed'; exit_price?: number | null; exit_date?: string | null; outcome?: 'right' | 'wrong' | 'mixed' | null; postmortem?: string | null },
) {
  const current = await q1<DecisionRow>(`select ${COLUMNS} from public.decisions where id = $1 and user_id = $2`, [id, userId]);
  if (!current) return null;
  // Closing without an exit price: use the live price.
  let exitPrice = patch.exit_price ?? current.exit_price;
  if (patch.status === 'closed' && exitPrice == null) exitPrice = (await getLiveQuote(current.symbol).catch(() => null))?.price ?? null;
  const next = { ...current, ...patch, exit_price: exitPrice };
  return q1<DecisionRow>(
    `update public.decisions set direction = $3, entry_price = $4, entry_date = $5::date, target_price = $6, stop_price = $7, horizon_date = $8::date,
       confidence = $9, rationale = $10, tags = $11, status = $12, exit_price = $13,
       exit_date = case when $12 = 'closed' then coalesce($14::date, exit_date, current_date) else null end,
       outcome = $15, postmortem = $16, updated_at = now()
     where id = $1 and user_id = $2 returning ${COLUMNS}`,
    [id, userId, next.direction, next.entry_price, next.entry_date, next.target_price, next.stop_price, next.horizon_date, next.confidence, next.rationale, next.tags, next.status, next.exit_price, next.exit_date, next.outcome, next.postmortem],
  );
}

export async function deleteDecision(userId: string, id: string) {
  await q('delete from public.decisions where id = $1 and user_id = $2', [id, userId]);
}
