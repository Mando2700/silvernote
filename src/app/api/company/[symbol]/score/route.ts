import { route, symbolSchema } from '@/lib/api';
import { getDetailedScore, getScoreHistory } from '@/lib/services/scores';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const [score, history] = await Promise.all([getDetailedScore(symbol), getScoreHistory(symbol)]);
  return { score, history };
});
