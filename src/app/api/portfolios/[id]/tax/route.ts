import { route, searchParam } from '@/lib/api';
import { disposalsCsv } from '@/lib/finance/tax-lots';
import { getPortfolio } from '@/lib/services/portfolio';
import { plDisposalsCsv } from '@/lib/finance/tax-pl';
import { getLedger, getPolishTaxReport, getTaxReport, getTaxSettings } from '@/lib/services/tax';

export const dynamic = 'force-dynamic';

/** Tax lots, realized gains by year, wash sales and harvesting ideas under the user's country rules. `?format=csv&year=2025` exports the disposals. */
export const GET = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  if (searchParam(request, 'jurisdiction') === 'PL') {
    const report = await getPolishTaxReport(portfolio);
    if (searchParam(request, 'format') === 'csv') {
      const year = searchParam(request, 'year');
      const rows = year ? report.disposals.filter((row) => row.sold.startsWith(`${year}-`)) : report.disposals;
      return new Response(plDisposalsCsv(rows), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="PIT-38-${portfolio.name.replace(/[^\w-]+/g, '-')}${year ? `-${year}` : ''}.csv"` },
      });
    }
    return report;
  }
  if (searchParam(request, 'format') === 'csv') {
    const year = searchParam(request, 'year');
    const { rules } = await getTaxSettings(user.id);
    const { disposals } = await getLedger(portfolio, rules);
    const rows = year ? disposals.filter((disposal) => disposal.sold.startsWith(`${year}-`)) : disposals;
    const filename = `${portfolio.name.replace(/[^\w-]+/g, '-')}-realized-${rules.code}${year ? `-${year}` : ''}.csv`;
    return new Response(disposalsCsv(rows, rules.longTermMonths !== null), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
    });
  }
  return getTaxReport(portfolio, user.id);
});
