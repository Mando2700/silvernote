import 'server-only';

import { q, q1 } from '@/lib/db';
import { compactNumber, pct } from '@/lib/format';
import type { StatementPeriod } from '@/lib/finance/statement-types';
import { THESIS_SECTION_META, type ThesisSection } from '@/lib/schemas';
import { getCompanyProfile, getLiveQuote } from '@/lib/services/market';
import { getGroupStats, getListings } from '@/lib/services/screener';
import { getDetailedScore } from '@/lib/services/scores';
import { getCompanyStatements } from '@/lib/services/statements';

export type PitchSection = { id: string; kind: string; title: string; content: string; included: boolean };

function money(value: number | null | undefined, currency = 'USD') {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value < 0 ? '−' : ''}${currency === 'USD' ? '$' : `${currency} `}${compactNumber(Math.abs(value), 1)}`;
}

function multiple(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(1)}×`;
}

const PLACEHOLDER: Partial<Record<ThesisSection, string>> = {
  thesis: '_Write the thesis in the company Workspace, then refresh this section — or draft it here._',
  drivers: '- _Driver 1: …_\n- _Driver 2: …_',
  catalysts: '- _Catalyst and expected timing…_',
  risks: '- _Risk, probability and cost if it happens…_',
  disconfirming: '- _A specific, observable signal that would break the thesis…_',
  valuation: '_Fair-value range, method and key assumptions…_',
};

/** Structured facts for the export cover and charts. */
export async function pitchFacts(symbol: string) {
  const [universe, profile, quote, statements, score] = await Promise.all([
    getListings(),
    getCompanyProfile(symbol).catch(() => null),
    getLiveQuote(symbol).catch(() => null),
    getCompanyStatements(symbol).catch(() => null),
    getDetailedScore(symbol).catch(() => null),
  ]);
  const entry = universe.find((item) => item.symbol === symbol);
  const annual = [...(statements?.annual ?? [])].slice(0, 6).reverse();
  return {
    symbol,
    name: profile?.name ?? entry?.name ?? symbol,
    sector: entry?.sector ?? profile?.sector ?? null,
    industry: entry?.industry ?? profile?.industry ?? null,
    price: quote?.price ?? entry?.price ?? null,
    marketCap: entry?.marketCap ?? null,
    currency: statements?.currency ?? 'USD',
    score: score ? { overall: score.overallScore, label: score.label, confidence: score.confidence, components: score.subScores.map((item) => ({ name: item.name, score: item.score })) } : null,
    annual: annual.map((period) => ({
      label: period.label,
      revenue: period.revenue ?? null,
      netIncome: period.netIncome ?? null,
      freeCashFlow: period.freeCashFlow ?? null,
      operatingMargin: period.operatingMargin ?? null,
    })),
    multiples: entry ? { pe: entry.pe, ps: entry.ps, evEbitda: entry.evEbitda, fcfYield: entry.fcfYield } : null,
  };
}

function financialTable(periods: StatementPeriod[], currency: string) {
  const rows = periods.slice(0, 4).reverse();
  if (!rows.length) return '_No filed financials available._';
  const header = `| | ${rows.map((period) => period.label).join(' | ')} |\n|---|${rows.map(() => '---:').join('|')}|`;
  const line = (label: string, values: string[]) => `| ${label} | ${values.join(' | ')} |`;
  const growth = rows.map((period, index) => {
    const previous = index > 0 ? rows[index - 1] : periods[rows.length];
    return period.revenue && previous?.revenue ? pct(period.revenue / previous.revenue - 1) : 'n/a';
  });
  return [
    header,
    line('Revenue', rows.map((period) => money(period.revenue, currency))),
    line('Revenue growth', growth),
    line('Gross margin', rows.map((period) => pct(period.grossMargin ?? null))),
    line('Operating margin', rows.map((period) => pct(period.operatingMargin ?? null))),
    line('Net income', rows.map((period) => money(period.netIncome, currency))),
    line('Free cash flow', rows.map((period) => money(period.freeCashFlow, currency))),
    line('Diluted EPS', rows.map((period) => (period.epsDiluted != null ? period.epsDiluted.toFixed(2) : 'n/a'))),
  ].join('\n');
}

export async function buildPitchSections(userId: string, symbol: string) {
  const [universe, profile, quote, statements, score, workspace, versions] = await Promise.all([
    getListings(),
    getCompanyProfile(symbol).catch(() => null),
    getLiveQuote(symbol).catch(() => null),
    getCompanyStatements(symbol).catch(() => null),
    getDetailedScore(symbol).catch(() => null),
    q1<{ stance: string; conviction: number; target_price: number | null; horizon: string | null }>(
      'select stance, conviction, target_price, horizon from public.workspaces where user_id = $1 and symbol = $2',
      [userId, symbol],
    ),
    q<{ section: ThesisSection; content: string }>(
      `select distinct on (section) section, content from public.thesis_versions where user_id = $1 and symbol = $2 order by section, created_at desc`,
      [userId, symbol],
    ),
  ]);
  const entry = universe.find((item) => item.symbol === symbol);
  const sector = entry?.sector ? await getGroupStats('sector', entry.sector).catch(() => null) : null;
  const thesis = Object.fromEntries(versions.map((version) => [version.section, version.content])) as Partial<Record<ThesisSection, string>>;
  const name = profile?.name ?? entry?.name ?? symbol;
  const price = quote?.price ?? entry?.price ?? null;
  const target = workspace?.target_price ?? null;
  const upside = target && price ? target / price - 1 : null;
  const recommendation = workspace?.stance === 'short' ? 'short' : workspace?.stance === 'avoid' ? 'avoid' : workspace?.stance === 'long' ? 'long' : 'hold';
  const currency = statements?.currency ?? 'USD';

  const firstParagraph = (thesis.thesis ?? '').split(/\n\s*\n/)[0]?.trim();
  const summary = [
    `**${recommendation.toUpperCase()} ${name} (${symbol})**${target ? ` · target $${target.toFixed(2)}${upside !== null ? ` (${upside >= 0 ? '+' : '−'}${Math.abs(upside * 100).toFixed(0)}% from $${price?.toFixed(2)})` : ''}` : price ? ` · last price $${price.toFixed(2)}` : ''}${workspace?.horizon ? ` · horizon ${workspace.horizon}` : ''}`,
    '',
    firstParagraph || '_One paragraph: what the market misses, why now, and what it is worth._',
    '',
    `Conviction ${workspace?.conviction ?? 3}/5 · SilverNote Score ${score ? `${score.overallScore} (${score.label})` : 'n/a'} · market value ${money(entry?.marketCap)}`,
  ].join('\n');

  const valuationTable = entry
    ? [
        '| Multiple | ' + symbol + ' | ' + (sector ? `${sector.group} median` : 'Sector median') + ' |',
        '|---|---:|---:|',
        `| P/E | ${multiple(entry.pe)} | ${multiple(sector?.medians.pe)} |`,
        `| P/S | ${multiple(entry.ps)} | ${multiple(sector?.medians.ps)} |`,
        `| EV/EBITDA | ${multiple(entry.evEbitda)} | ${multiple(sector?.medians.evEbitda)} |`,
        `| FCF yield | ${pct(entry.fcfYield)} | ${pct(sector?.medians.fcfYield ?? null)} |`,
        `| Operating margin | ${pct(entry.operatingMargin)} | ${pct(sector?.medians.operatingMargin ?? null)} |`,
        `| Revenue growth | ${pct(entry.revenueGrowth)} | ${pct(sector?.medians.revenueGrowth ?? null)} |`,
      ].join('\n')
    : '';

  const scoreBlock = score
    ? [
        `**${score.overallScore}/100 · ${score.label}** (${score.confidence} confidence)`,
        '',
        score.subScores.map((item) => `- ${item.name}: ${item.score}`).join('\n'),
        '',
        score.shortSummary,
      ].join('\n')
    : '_Not scored._';

  const section = (kind: string, title: string, content: string, included = true): PitchSection => ({ id: kind, kind, title, content, included });
  const sections: PitchSection[] = [
    section('summary', 'Summary', summary),
    section('company', 'The business', `${profile?.description?.slice(0, 900) ?? '_Business description…_'}\n\n${[entry?.sector, entry?.industry].filter(Boolean).join(' · ')}`),
    section('thesis', THESIS_SECTION_META.thesis.title, thesis.thesis ?? PLACEHOLDER.thesis ?? ''),
    section('drivers', THESIS_SECTION_META.drivers.title, thesis.drivers ?? PLACEHOLDER.drivers ?? ''),
    section('financials', 'Financial highlights', financialTable(statements?.annual ?? [], currency)),
    section('valuation', 'Valuation', [thesis.valuation ?? PLACEHOLDER.valuation, valuationTable].filter(Boolean).join('\n\n')),
    section('catalysts', THESIS_SECTION_META.catalysts.title, thesis.catalysts ?? PLACEHOLDER.catalysts ?? ''),
    section('risks', THESIS_SECTION_META.risks.title, thesis.risks ?? PLACEHOLDER.risks ?? ''),
    section('disconfirming', THESIS_SECTION_META.disconfirming.title, thesis.disconfirming ?? PLACEHOLDER.disconfirming ?? ''),
    section('score', 'SilverNote Score', scoreBlock),
  ];
  return { title: `${name}: ${recommendation === 'long' ? 'the case for owning it' : recommendation === 'short' ? 'the case against' : 'investment review'}`, recommendation, targetPrice: target, sections };
}
