import { route, searchParam } from '@/lib/api';
import { disposalsCsv } from '@/lib/finance/tax-lots';
import { getPortfolio } from '@/lib/services/portfolio';
import { getLedger, getTaxReport } from '@/lib/services/tax';

export const dynamic = 'force-dynamic';

/** Tax lots, realized gains by year, wash sales and harvesting ideas. `?format=csv&year=2025` exports Form 8949 rows. */
export const GET = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  if (searchParam(request, 'format') === 'csv') {
    const year = searchParam(request, 'year');
    const { disposals } = await getLedger(portfolio);
    const rows = year ? disposals.filter((disposal) => disposal.sold.startsWith(`${year}-`)) : disposals;
    const filename = `${portfolio.name.replace(/[^\w-]+/g, '-')}-realized${year ? `-${year}` : ''}.csv`;
    return new Response(disposalsCsv(rows), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
    });
  }
  return getTaxReport(portfolio, user.id);
});
