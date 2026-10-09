/**
 * Capital-gains rules per country for listed shares held by a resident individual. Rates are planning
 * defaults (the user can override them on the Tax tab); thresholds, allowances and surcharges that
 * depend on income are left to the note.
 *
 * Pure data, safe on the client and the server.
 */

export type TaxRegion = 'North America' | 'European Union';

export type TaxRules = {
  code: string;
  name: string;
  region: TaxRegion;
  /** `pl` has its own engine (PLN at NBP rates); everything else runs the lot engine with these rules. */
  engine: 'lots' | 'pl';
  /** Default rates: short-term, and long-term once held `longTermMonths` (equal when there is no split). */
  shortTerm: number;
  longTerm: number;
  /** Months after which a gain is long-term; null when the holding period doesn't change the rate. */
  longTermMonths: number | null;
  /** `choice` lets the account pick FIFO/LIFO/HIFO; otherwise the law fixes the method. */
  costBasis: 'choice' | 'fifo' | 'average';
  /** Days before and after a losing sale in which a repurchase defers the loss; null when there is no such rule. */
  lossDeferralDays: number | null;
  /** What the deferral rule is called locally. */
  lossDeferralName?: string;
  /** Net capital loss that may offset other income each year. */
  ordinaryOffset: number;
  /** Where the figures are reported. */
  form: string;
  note: string;
};

const BASE = { engine: 'lots', longTermMonths: null, costBasis: 'fifo', lossDeferralDays: null, ordinaryOffset: 0 } as const;

const flat = (rate: number) => ({ shortTerm: rate, longTerm: rate });

export const TAX_COUNTRIES: TaxRules[] = [
  // ─── North America ──────────────────────────────────────────────────────────
  {
    ...BASE,
    code: 'US',
    name: 'United States',
    region: 'North America',
    shortTerm: 0.32,
    longTerm: 0.15,
    longTermMonths: 12,
    costBasis: 'choice',
    lossDeferralDays: 30,
    lossDeferralName: 'Wash sale',
    ordinaryOffset: 3000,
    form: 'Form 8949',
    note: 'Short-term gains taxed as income, long-term after one year at 0/15/20%. Wash sales defer losses; up to $3,000 of net loss offsets income.',
  },
  {
    ...BASE,
    code: 'CA',
    name: 'Canada',
    region: 'North America',
    // Half of a capital gain is taxable: the default is half of a ~50% combined top marginal rate.
    ...flat(0.25),
    costBasis: 'average',
    lossDeferralDays: 30,
    lossDeferralName: 'Superficial loss',
    form: 'Schedule 3',
    note: '50% of the gain is included in income, so the rate is half your marginal rate. Cost is the adjusted cost base (average); a repurchase within 30 days makes a loss superficial.',
  },
  {
    ...BASE,
    code: 'MX',
    name: 'Mexico',
    region: 'North America',
    ...flat(0.1),
    costBasis: 'average',
    form: 'Declaración anual',
    note: '10% on gains from listed shares sold through a broker, using average cost.',
  },

  // ─── European Union ─────────────────────────────────────────────────────────
  { ...BASE, code: 'AT', name: 'Austria', region: 'European Union', ...flat(0.275), costBasis: 'average', form: 'E1kv', note: '27.5% flat on gains, using the moving average cost.' },
  { ...BASE, code: 'BE', name: 'Belgium', region: 'European Union', ...flat(0.1), form: 'Tax return', note: '10% on financial gains from 2026, above an annual exemption of about €10,000.' },
  { ...BASE, code: 'BG', name: 'Bulgaria', region: 'European Union', ...flat(0.1), form: 'Annex 5', note: '10% flat; gains on shares sold on an EU-regulated market are exempt — set the rate to 0% if that covers you.' },
  {
    ...BASE,
    code: 'HR',
    name: 'Croatia',
    region: 'European Union',
    shortTerm: 0.12,
    longTerm: 0,
    longTermMonths: 24,
    form: 'JOPPD / annual return',
    note: '12% on gains; shares held more than two years are exempt.',
  },
  { ...BASE, code: 'CY', name: 'Cyprus', region: 'European Union', ...flat(0), form: 'Tax return', note: 'Gains on listed securities are not taxed.' },
  {
    ...BASE,
    code: 'CZ',
    name: 'Czechia',
    region: 'European Union',
    shortTerm: 0.15,
    longTerm: 0,
    longTermMonths: 36,
    costBasis: 'choice',
    form: 'Příloha 2',
    note: '15% (23% on high incomes); shares held over three years are exempt, as are total annual sales under CZK 100,000.',
  },
  { ...BASE, code: 'DK', name: 'Denmark', region: 'European Union', ...flat(0.27), costBasis: 'average', form: 'Share income', note: '27% share-income tax, 42% above the annual threshold. Average cost method.' },
  { ...BASE, code: 'EE', name: 'Estonia', region: 'European Union', ...flat(0.22), form: 'Table 8.2', note: '22% flat income tax on gains; an investment account defers tax until withdrawal.' },
  { ...BASE, code: 'FI', name: 'Finland', region: 'European Union', ...flat(0.3), form: '9A', note: '30% capital-income tax, 34% above €30,000. FIFO; a deemed cost of 20% (40% after ten years) may be used instead.' },
  { ...BASE, code: 'FR', name: 'France', region: 'European Union', ...flat(0.3), costBasis: 'average', form: 'Form 2074', note: 'Flat tax (PFU) of 30% including social charges, on a weighted-average cost (PMP). PEA accounts are exempt after five years.' },
  { ...BASE, code: 'DE', name: 'Germany', region: 'European Union', ...flat(0.26375), form: 'Anlage KAP', note: '25% Abgeltungsteuer plus solidarity surcharge (26.375%), plus church tax if it applies. FIFO is required; €1,000 saver allowance.' },
  { ...BASE, code: 'GR', name: 'Greece', region: 'European Union', ...flat(0.15), form: 'E1', note: '15% on gains; listed shares under a 0.5% stake are generally exempt.' },
  { ...BASE, code: 'HU', name: 'Hungary', region: 'European Union', ...flat(0.15), form: 'SZJA return', note: '15% personal income tax on gains; a long-term investment account (TBSZ) is exempt after five years.' },
  { ...BASE, code: 'IE', name: 'Ireland', region: 'European Union', ...flat(0.33), form: 'Form 11 / CG1', note: '33% CGT above the €1,270 annual exemption. Shares rebought within four weeks match against the sale first.' },
  { ...BASE, code: 'IT', name: 'Italy', region: 'European Union', ...flat(0.26), costBasis: 'average', form: 'Quadro RT', note: '26% substitute tax on a weighted-average cost; losses carry forward four years.' },
  { ...BASE, code: 'LV', name: 'Latvia', region: 'European Union', ...flat(0.255), form: 'Annex D3', note: '25.5% on capital gains.' },
  { ...BASE, code: 'LT', name: 'Lithuania', region: 'European Union', ...flat(0.15), form: 'GPM311', note: '15% (higher bands on large incomes), above a small annual exemption.' },
  {
    ...BASE,
    code: 'LU',
    name: 'Luxembourg',
    region: 'European Union',
    shortTerm: 0.42,
    longTerm: 0,
    longTermMonths: 6,
    form: 'Modèle 100',
    note: 'Speculative gains (held six months or less) taxed at your marginal rate; holdings under 10% are exempt after six months.',
  },
  { ...BASE, code: 'MT', name: 'Malta', region: 'European Union', ...flat(0), form: 'Tax return', note: 'Gains on listed shares are generally not taxed.' },
  { ...BASE, code: 'NL', name: 'Netherlands', region: 'European Union', ...flat(0), form: 'Box 3', note: 'Box 3 taxes a deemed return on your net assets each year, not realized gains — realized results here are for reference.' },
  { ...BASE, code: 'PL', name: 'Poland', region: 'European Union', engine: 'pl', ...flat(0.19), form: 'PIT-38', note: '19% flat on gains converted to PLN at NBP rates, FIFO; losses carry forward five years.' },
  { ...BASE, code: 'PT', name: 'Portugal', region: 'European Union', ...flat(0.28), form: 'Anexo G / J', note: '28% autonomous rate; gains on shares held under a year must be aggregated with income in the top bracket.' },
  { ...BASE, code: 'RO', name: 'Romania', region: 'European Union', ...flat(0.1), form: 'Declarația unică', note: 'Trades through foreign brokers are self-declared; Romanian brokers withhold a lower rate at source.' },
  { ...BASE, code: 'SK', name: 'Slovakia', region: 'European Union', ...flat(0.19), form: 'DP typ B', note: '19% (25% on high incomes), plus health contributions in some cases.' },
  {
    ...BASE,
    code: 'SI',
    name: 'Slovenia',
    region: 'European Union',
    shortTerm: 0.25,
    longTerm: 0.2,
    longTermMonths: 60,
    form: 'Doh-KDVP',
    note: '25% under five years, falling to 20%, 15% and 0% after 5, 10 and 15 years.',
  },
  {
    ...BASE,
    code: 'ES',
    name: 'Spain',
    region: 'European Union',
    ...flat(0.21),
    lossDeferralDays: 60,
    lossDeferralName: 'Two-month rule',
    form: 'Modelo 100',
    note: 'Savings scale of 19–30%. FIFO; a loss is deferred if the same shares are bought within two months.',
  },
  { ...BASE, code: 'SE', name: 'Sweden', region: 'European Union', ...flat(0.3), costBasis: 'average', form: 'K4', note: '30% on gains using the average cost method; ISK accounts are taxed on a flat yield instead.' },
];

export const TAX_CODES = TAX_COUNTRIES.map((country) => country.code) as [string, ...string[]];

export function taxRulesFor(code: string | null | undefined): TaxRules {
  return TAX_COUNTRIES.find((country) => country.code === code) ?? TAX_COUNTRIES[0];
}
