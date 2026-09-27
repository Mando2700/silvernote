/**
 * Nasdaq's screener uses a legacy, SIC-derived sector scheme (Tesla under Industrials, Visa under
 * Consumer Discretionary). SilverNote maps its finer "industry" field onto the 11 GICS-style sectors
 * investors expect, with SEC SIC codes as the fallback and a short list of well-known exceptions.
 */

export const SECTORS = [
  'Information Technology',
  'Health Care',
  'Financials',
  'Consumer Discretionary',
  'Communication Services',
  'Industrials',
  'Consumer Staples',
  'Energy',
  'Utilities',
  'Real Estate',
  'Materials',
] as const;

export type Sector = (typeof SECTORS)[number];

const SYMBOL_OVERRIDES: Record<string, Sector> = {
  GOOGL: 'Communication Services', GOOG: 'Communication Services', META: 'Communication Services', NFLX: 'Communication Services',
  DIS: 'Communication Services', CMCSA: 'Communication Services', T: 'Communication Services', VZ: 'Communication Services',
  TMUS: 'Communication Services', CHTR: 'Communication Services', EA: 'Communication Services', TTWO: 'Communication Services',
  WBD: 'Communication Services', SPOT: 'Communication Services', RDDT: 'Communication Services', PINS: 'Communication Services',
  SNAP: 'Communication Services', ROKU: 'Communication Services', LYV: 'Communication Services', OMC: 'Communication Services',
  AMZN: 'Consumer Discretionary', TSLA: 'Consumer Discretionary', BKNG: 'Consumer Discretionary', ABNB: 'Consumer Discretionary',
  EBAY: 'Consumer Discretionary', GM: 'Consumer Discretionary', F: 'Consumer Discretionary', RIVN: 'Consumer Discretionary',
  MELI: 'Consumer Discretionary', PDD: 'Consumer Discretionary', BABA: 'Consumer Discretionary', DASH: 'Consumer Discretionary',
  V: 'Financials', MA: 'Financials', PYPL: 'Financials', FI: 'Financials', FIS: 'Financials', GPN: 'Financials', AXP: 'Financials',
  'BRK.A': 'Financials', 'BRK.B': 'Financials', COIN: 'Financials', HOOD: 'Financials', SPGI: 'Financials', MCO: 'Financials',
  AAPL: 'Information Technology', MSFT: 'Information Technology', NVDA: 'Information Technology', AVGO: 'Information Technology',
  ORCL: 'Information Technology', CRM: 'Information Technology', ADBE: 'Information Technology', CSCO: 'Information Technology',
  IBM: 'Information Technology', ACN: 'Information Technology', TSM: 'Information Technology', ASML: 'Information Technology',
  WMT: 'Consumer Staples', COST: 'Consumer Staples', PG: 'Consumer Staples', KO: 'Consumer Staples', PEP: 'Consumer Staples',
  PM: 'Consumer Staples', MO: 'Consumer Staples', CL: 'Consumer Staples', KMB: 'Consumer Staples', EL: 'Consumer Staples',
  UBER: 'Industrials', ADP: 'Industrials', PAYX: 'Industrials', GE: 'Industrials', GEV: 'Industrials', ETN: 'Industrials', EMR: 'Industrials',
  VRT: 'Industrials', HWM: 'Industrials', CARR: 'Industrials', TT: 'Industrials', JCI: 'Industrials', LIN: 'Materials', APD: 'Materials', SHW: 'Materials',
};

type Rule = [RegExp, Sector];

// Order matters: the first matching industry pattern wins.
const INDUSTRY_RULES: Rule[] = [
  [/real estate investment trust|building operators|^real estate$/i, 'Real Estate'],
  [/bank|savings institution|investment bankers|investment managers|finance|insur|trusts except|diversified financial|blank check/i, 'Financials'],
  [/biotech|pharma|medic|ophthalmic|hospital|nursing|health|drug/i, 'Health Care'],
  [/semiconductor|computer|edp services|software|electronic components|electronics distribution|radio and television broadcasting and communications equipment|telecommunications equipment|communications equipment/i, 'Information Technology'],
  [/cable|broadcasting|advertising|publishing|newspaper|movies|entertainment|books/i, 'Communication Services'],
  [/electric utilities|water supply|power generation|natural gas distribution|oil\/gas transmission/i, 'Utilities'],
  [/oil|gas production|coal|integrated oil|oilfield/i, 'Energy'],
  [/precious metals|metal mining|chemical|paper|forest|steel|aluminum|containers|packaging|mining & quarrying|paints|plastic|other metals/i, 'Materials'],
  [/beverages|packaged foods|food|meat|farming|tobacco|package goods|cosmetics|retail-drug|consumer specialties/i, 'Consumer Staples'],
  [/retail|stores|restaurant|hotel|homebuilding|auto|apparel|shoe|clothing|garments|home furnishings|recreational|consumer electronics|catalog|motor vehicles|durable goods|textiles|other consumer services|amusement|leisure/i, 'Consumer Discretionary'],
  [/aerospace|military|railroads|trucking|freight|marine|transportation|machinery|construction|engineering|metal fabrications|electrical products|fluid controls|building|pollution|environmental|professional services|business services|commercial services|rental|leasing|ordnance|tools|wholesale|office equipment|industrial specialties|manufacturing|precision instruments|multi-sector/i, 'Industrials'],
];

const LEGACY_SECTOR: Record<string, Sector> = {
  Technology: 'Information Technology',
  'Health Care': 'Health Care',
  Financials: 'Financials',
  Finance: 'Financials',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Staples': 'Consumer Staples',
  Industrials: 'Industrials',
  Energy: 'Energy',
  Utilities: 'Utilities',
  'Real Estate': 'Real Estate',
  'Basic Materials': 'Materials',
  Telecom: 'Communication Services',
  Telecommunications: 'Communication Services',
};

export function mapSector(input: { symbol: string; nasdaqSector: string | null; industry: string | null }): Sector | null {
  const override = SYMBOL_OVERRIDES[input.symbol];
  if (override) return override;
  if (input.industry) {
    for (const [pattern, sector] of INDUSTRY_RULES) if (pattern.test(input.industry)) return sector;
  }
  return input.nasdaqSector ? (LEGACY_SECTOR[input.nasdaqSector] ?? null) : null;
}

/** SEC Standard Industrial Classification → GICS-style sector (used when Nasdaq has no sector). */
export function sectorFromSic(sicCode: string | null | undefined): Sector | null {
  const sic = Number(sicCode);
  if (!Number.isFinite(sic) || sic <= 0) return null;
  if (sic < 1000) return 'Consumer Staples';
  if (sic === 1311 || (sic >= 1381 && sic <= 1389)) return 'Energy';
  if (sic < 1500) return 'Materials';
  if (sic < 1800) return 'Industrials';
  if (sic < 2200) return 'Consumer Staples';
  if (sic < 2400) return 'Consumer Discretionary';
  if (sic < 2500) return 'Materials';
  if (sic < 2600) return 'Consumer Discretionary';
  if (sic < 2700) return 'Materials';
  if (sic < 2800) return 'Communication Services';
  if (sic >= 2830 && sic <= 2836) return 'Health Care';
  if (sic < 2900) return 'Materials';
  if (sic < 3000) return 'Energy';
  if (sic < 3100) return 'Materials';
  if (sic < 3200) return 'Consumer Discretionary';
  if (sic < 3400) return 'Materials';
  if (sic < 3570) return 'Industrials';
  if (sic < 3580) return 'Information Technology';
  if (sic < 3600) return 'Industrials';
  if (sic === 3630 || sic === 3651) return 'Consumer Discretionary';
  if (sic < 3690) return 'Information Technology';
  if (sic < 3700) return 'Industrials';
  if (sic === 3711 || sic === 3714 || sic === 3751) return 'Consumer Discretionary';
  if (sic < 3800) return 'Industrials';
  if (sic >= 3841 && sic <= 3851) return 'Health Care';
  if (sic < 3900) return 'Information Technology';
  if (sic < 4000) return 'Consumer Discretionary';
  if (sic < 4800) return 'Industrials';
  if (sic < 4900) return 'Communication Services';
  if (sic < 5000) return 'Utilities';
  if (sic === 5122) return 'Health Care';
  if (sic < 5200) return 'Industrials';
  if (sic === 5411 || sic === 5912) return 'Consumer Staples';
  if (sic < 6000) return 'Consumer Discretionary';
  if ((sic >= 6500 && sic < 6600) || sic === 6798) return 'Real Estate';
  if (sic < 7000) return 'Financials';
  if (sic < 7100) return 'Consumer Discretionary';
  if (sic >= 7370 && sic <= 7379) return 'Information Technology';
  if (sic >= 7800 && sic < 7900) return 'Communication Services';
  if (sic >= 8000 && sic < 8100) return 'Health Care';
  return 'Industrials';
}
