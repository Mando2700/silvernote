'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { TweenedWaterfall as Waterfall } from '@/components/learn/animated-charts';
import { AskGrok, DataState, Readout, Slider, TickerPicker, Widget } from '@/components/learn/blocks';
import { XYChart } from '@/components/learn/xy-chart';
import { Button } from '@/components/ui/button';
import { money, multiple, pct, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

type CompanyPayload = {
  symbol: string;
  security: { name: string; price: number | null; market_cap: number | null } | null;
  quote: { price: number | null } | null;
  fundamentals: { net_income: number | null; ebitda: number | null; total_debt: number | null; cash: number | null; revenue: number | null } | null;
};

/** Price, size and earnings for a company from the universe tables. */
function useCompany(symbol: string) {
  const { data, error, isLoading } = useSWR<CompanyPayload>(`/api/company/${encodeURIComponent(symbol)}`, { keepPreviousData: false });
  const company = useMemo(() => {
    if (!data?.security) return null;
    const price = data.quote?.price ?? data.security.price;
    const marketCap = data.security.market_cap;
    if (!price || !marketCap) return null;
    const shares = marketCap / price;
    const netIncome = data.fundamentals?.net_income ?? null;
    return {
      symbol: data.symbol,
      name: data.security.name,
      price,
      marketCap,
      shares,
      netIncome,
      eps: netIncome !== null ? netIncome / shares : null,
      pe: netIncome && netIncome > 0 ? marketCap / netIncome : null,
      ebitda: data.fundamentals?.ebitda ?? null,
      debt: data.fundamentals?.total_debt ?? 0,
      cash: data.fundamentals?.cash ?? 0,
    };
  }, [data]);
  return { company, error, isLoading };
}

const big = (value: number) => money(value, { compact: true, digits: 1 });

// ─── Accretion / dilution ────────────────────────────────────────────────────

type Deal = { premium: number; stock: number; cash: number; debtRate: number; cashYield: number; tax: number; synergies: number };
type Side = NonNullable<ReturnType<typeof useCompany>['company']> & { netIncome: number; eps: number };

function mergeMath(acquirer: Side, target: Side, deal: Deal) {
  const price = target.marketCap * (1 + deal.premium);
  const debtShare = Math.max(0, 1 - deal.stock - deal.cash);
  const newShares = (price * deal.stock) / acquirer.price;
  const cashCost = price * deal.cash * deal.cashYield * (1 - deal.tax);
  const debtCost = price * debtShare * deal.debtRate * (1 - deal.tax);
  const synergies = deal.synergies * (1 - deal.tax);
  const proForma = (acquirer.netIncome + target.netIncome - cashCost - debtCost + synergies) / (acquirer.shares + newShares);
  const accretion = proForma / acquirer.eps - 1;
  const breakeven = Math.max(0, (acquirer.eps * (acquirer.shares + newShares) - acquirer.netIncome - target.netIncome + cashCost + debtCost) / (1 - deal.tax));
  const targetYield = target.netIncome / price;
  const costOfFunds = deal.stock * (acquirer.netIncome / acquirer.marketCap) + deal.cash * deal.cashYield * (1 - deal.tax) + debtShare * deal.debtRate * (1 - deal.tax);
  return { price, debtShare, newShares, cashCost, debtCost, synergies, proForma, accretion, breakeven, targetYield, costOfFunds };
}

export function AccretionLab() {
  const [acquirerSymbol, setAcquirerSymbol] = useState('CSCO');
  const [targetSymbol, setTargetSymbol] = useState('FTNT');
  const a = useCompany(acquirerSymbol);
  const t = useCompany(targetSymbol);
  const [deal, setDeal] = useState<Deal>({ premium: 0.3, stock: 0.5, cash: 0.2, debtRate: 0.06, cashYield: 0.04, tax: 0.21, synergies: 0 });
  const set = (patch: Partial<Deal>) => setDeal((current) => ({ ...current, ...patch }));
  const acquirer = a.company && a.company.netIncome && a.company.netIncome > 0 ? (a.company as Side) : null;
  const target = t.company && t.company.netIncome !== null ? (t.company as Side) : null;
  const math = acquirer && target && acquirerSymbol !== targetSymbol ? mergeMath(acquirer, target, deal) : null;

  return (
    <Widget
      kicker="Live data · hypothetical deal"
      title={`What if ${acquirerSymbol} bought ${targetSymbol}?`}
      actions={<AskGrok prompt={`Hypothetically, if ${acquirerSymbol} acquired ${targetSymbol} at a ${Math.round(deal.premium * 100)}% premium, paying ${Math.round(deal.stock * 100)}% in stock, ${Math.round(deal.cash * 100)}% cash and the rest in new debt: would it be accretive, what synergies are plausible, and would it make strategic sense? Use the latest financials.`} />}
      footer="Latest annual net income; market values from today’s prices. No purchase-accounting write-ups, fees or target debt refinancing — the first-pass model bankers do on a napkin."
    >
      <div className="mb-3 flex flex-col gap-2">
        <TickerPicker label="Acquirer" value={acquirerSymbol} onChange={setAcquirerSymbol} suggestions={['CSCO', 'JNJ', 'PEP', 'CVX']} />
        <TickerPicker label="Target" value={targetSymbol} onChange={setTargetSymbol} suggestions={['FTNT', 'KVUE', 'MNST', 'DVN']} />
      </div>
      {!math || !acquirer || !target ? (
        <DataState
          loading={a.isLoading || t.isLoading}
          error={a.error ?? t.error}
          empty={acquirerSymbol === targetSymbol ? 'Pick two different companies.' : !acquirer ? 'The acquirer needs positive earnings for EPS accretion to mean anything.' : 'No earnings data for the target.'}
          height={280}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="flex flex-col gap-3.5">
              <Slider label="Premium to current price" value={deal.premium} min={0} max={0.8} step={0.01} onChange={(premium) => set({ premium })} format={(v) => pct(v, 0)} />
              <Slider label="Paid in stock" value={deal.stock} min={0} max={1} step={0.05} onChange={(stock) => set({ stock, cash: Math.min(deal.cash, 1 - stock) })} format={(v) => pct(v, 0)} />
              <Slider label="Paid from cash on hand" value={deal.cash} min={0} max={1 - deal.stock} step={0.05} onChange={(cash) => set({ cash })} format={(v) => `${pct(v, 0)} · debt ${pct(Math.max(0, 1 - deal.stock - v), 0)}`} />
              <Slider label="Interest on new debt" value={deal.debtRate} min={0.03} max={0.1} step={0.0025} onChange={(debtRate) => set({ debtRate })} format={(v) => pct(v, 2)} />
              <Slider label="Interest earned on cash" value={deal.cashYield} min={0} max={0.06} step={0.0025} onChange={(cashYield) => set({ cashYield })} format={(v) => pct(v, 2)} />
              <Slider label="Pre-tax synergies / yr" value={deal.synergies} min={0} max={Math.max(1e8, Math.abs(target.netIncome) * 1.5)} step={Math.max(1e6, Math.abs(target.netIncome) / 100)} onChange={(synergies) => set({ synergies })} format={big} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Readout label="Accretion / dilution" value={signedPct(math.accretion, 1)} tone={math.accretion >= 0 ? 'gain' : 'loss'} sub={math.accretion >= 0 ? 'accretive' : 'dilutive'} />
                <Readout label="Pro forma EPS" value={`$${math.proForma.toFixed(2)}`} sub={`standalone $${acquirer.eps.toFixed(2)}`} />
                <Readout label="Purchase price" value={big(math.price)} sub={`${target.netIncome > 0 ? multiple(math.price / target.netIncome, 1) : '—'} earnings`} />
                <Readout label="Break-even synergies" value={math.breakeven > 0 ? big(math.breakeven) : 'none needed'} tone="brand" sub="pre-tax, per year" />
              </div>
              <Waterfall
                height={230}
                format={(value) => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}`}
                steps={[
                  { label: 'Standalone EPS', value: acquirer.eps, kind: 'start' },
                  { label: 'Target earnings', value: target.netIncome / acquirer.shares, kind: 'delta' },
                  { label: 'Financing cost', value: -(math.cashCost + math.debtCost) / acquirer.shares, kind: 'delta' },
                  { label: 'Synergies', value: math.synergies / acquirer.shares, kind: 'delta' },
                  {
                    label: 'New shares',
                    value: math.proForma - (acquirer.netIncome + target.netIncome - math.cashCost - math.debtCost + math.synergies) / acquirer.shares,
                    kind: 'delta',
                  },
                  { label: 'Pro forma EPS', value: math.proForma, kind: 'total', emphasis: true },
                ]}
              />
              <div className="rounded-md border border-line bg-surface-1 p-3 text-[12px] text-ink-2">
                <div className="mb-2 font-medium text-ink">The rule of thumb: target’s earnings yield vs your cost of funds</div>
                {[
                  { label: `${targetSymbol} earnings yield at the purchase price`, value: math.targetYield, color: 'bg-series-1' },
                  { label: 'Weighted after-tax cost of the funding', value: math.costOfFunds, color: 'bg-series-2' },
                ].map((bar) => (
                  <div key={bar.label} className="mb-1.5 grid grid-cols-[1fr_60px] items-center gap-2">
                    <div>
                      <div className="mb-0.5 text-[11px] text-muted">{bar.label}</div>
                      <div className="h-2 rounded-full bg-surface-4">
                        <div className={cn('h-2 rounded-full transition-[width] duration-300 ease-out', bar.color)} style={{ width: `${Math.max(1, Math.min(100, (bar.value / Math.max(0.12, math.targetYield, math.costOfFunds)) * 100))}%` }} />
                      </div>
                    </div>
                    <span className="num text-right font-mono">{pct(bar.value, 2)}</span>
                  </div>
                ))}
                <div className="mt-1 text-[11.5px] text-muted">
                  Stock costs the acquirer its own earnings yield (1 / P/E = {pct(acquirer.netIncome / acquirer.marketCap, 1)}); cash and debt cost their after-tax interest. {math.targetYield > math.costOfFunds ? 'Target yield is higher → accretive before synergies.' : 'Target yield is lower → dilutive unless synergies close the gap.'}
                </div>
              </div>
            </div>
          </div>
          <AccretionGrid acquirer={acquirer} target={target} deal={deal} />
        </div>
      )}
    </Widget>
  );
}

function AccretionGrid({ acquirer, target, deal }: { acquirer: Side; target: Side; deal: Deal }) {
  const premiums = [0.1, 0.2, 0.3, 0.4, 0.5];
  const stocks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div>
      <div className="mb-1.5 text-[12px] text-ink-2">Sensitivity: accretion by premium (rows) and share paid in stock (columns); the rest is new debt</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-center font-mono text-[11.5px]">
          <thead>
            <tr>
              <th className="text-left text-[10.5px] font-normal text-faint">Premium \ stock</th>
              {stocks.map((stock) => (
                <th key={stock} className="font-normal text-muted">{pct(stock, 0)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {premiums.map((premium) => (
              <tr key={premium}>
                <td className="text-left text-muted">{pct(premium, 0)}</td>
                {stocks.map((stock) => {
                  const value = mergeMath(acquirer, target, { ...deal, premium, stock, cash: 0 }).accretion;
                  return (
                    <td
                      key={stock}
                      className="rounded-xs px-2 py-1.5 text-ink transition-colors duration-300"
                      style={{ background: value >= 0 ? `color-mix(in srgb, var(--color-gain-fill) ${Math.min(55, 8 + value * 250)}%, transparent)` : `color-mix(in srgb, var(--color-loss-fill) ${Math.min(55, 8 - value * 250)}%, transparent)` }}
                    >
                      {signedPct(value, 1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── LBO lab ────────────────────────────────────────────────────────────────

type LboInputs = { ebitda: number; entry: number; leverage: number; rate: number; growth: number; exit: number; years: number; conversion: number };

export function runLbo(input: LboInputs) {
  const tax = 0.25;
  const ev = input.entry * input.ebitda;
  const fees = ev * 0.02;
  const debt0 = input.leverage * input.ebitda;
  const equity0 = ev + fees - debt0;
  const schedule: Array<{ year: number; ebitda: number; interest: number; cash: number; debt: number }> = [];
  let debt = debt0;
  let ebitda = input.ebitda;
  for (let year = 1; year <= input.years; year += 1) {
    ebitda *= 1 + input.growth;
    const interest = debt * input.rate;
    // Pre-interest cash after capex, working capital and taxes, less after-tax interest.
    const cash = ebitda * input.conversion - interest * (1 - tax);
    debt = Math.max(0, debt - cash);
    schedule.push({ year, ebitda, interest, cash, debt });
  }
  const exitEv = input.exit * ebitda;
  const exitEquity = Math.max(0, exitEv - debt);
  const moic = equity0 > 0 ? exitEquity / equity0 : 0;
  const irr = moic > 0 ? moic ** (1 / input.years) - 1 : -1;
  return {
    ev,
    fees,
    debt0,
    equity0,
    schedule,
    exitEv,
    exitEquity,
    moic,
    irr,
    bridge: { growth: input.entry * (ebitda - input.ebitda), multiple: (input.exit - input.entry) * ebitda, paydown: debt0 - debt, fees: -fees },
  };
}

export function LboLab() {
  const [inputs, setInputs] = useState<LboInputs>({ ebitda: 100e6, entry: 10, leverage: 5.5, rate: 0.085, growth: 0.06, exit: 10, years: 5, conversion: 0.45 });
  const [seedSymbol, setSeedSymbol] = useState('DPZ');
  const seed = useCompany(seedSymbol);
  const set = (patch: Partial<LboInputs>) => setInputs((current) => ({ ...current, ...patch }));
  const result = runLbo(inputs);
  const entries = [inputs.entry - 2, inputs.entry - 1, inputs.entry, inputs.entry + 1, inputs.entry + 2];
  const exits = [inputs.exit - 2, inputs.exit - 1, inputs.exit, inputs.exit + 1, inputs.exit + 2];
  const seeded = seed.company && seed.company.ebitda && seed.company.ebitda > 0 ? seed.company : null;
  const seededMultiple = seeded ? (seeded.marketCap + seeded.debt - seeded.cash) / (seeded.ebitda as number) : null;

  return (
    <Widget
      title="Buy a company mostly with debt — then pay it down"
      footer="Fees are 2% of enterprise value, funded with equity. Cash for debt paydown = EBITDA × conversion (after capex, working capital and taxes) − after-tax interest."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-2">
        <TickerPicker label="Seed from a real company" value={seedSymbol} onChange={setSeedSymbol} suggestions={['DPZ', 'HSY', 'CLX', 'ORLY']} />
        <Button
          size="xs"
          variant="outline"
          disabled={!seeded || !seededMultiple || seededMultiple <= 0}
          onClick={() => {
            if (!seeded || !seededMultiple) return;
            const premium = Math.round(seededMultiple * 1.25 * 2) / 2;
            set({ ebitda: seeded.ebitda as number, entry: Math.max(4, Math.min(25, premium)), exit: Math.max(4, Math.min(25, Math.round(seededMultiple * 2) / 2)), leverage: Math.min(7, Math.max(2, Math.round(Math.min(6, premium * 0.55) * 2) / 2)) });
          }}
        >
          {seeded && seededMultiple ? `Load ${seedSymbol}: EBITDA ${big(seeded.ebitda as number)}, trades at ${multiple(seededMultiple, 1)} → buy at +25%` : seed.isLoading ? 'Loading…' : 'No EBITDA for this ticker'}
        </Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-3.5">
          <Slider label="Entry EBITDA" value={inputs.ebitda} min={Math.min(10e6, inputs.ebitda)} max={Math.max(1e9, inputs.ebitda * 2)} step={Math.max(1e6, inputs.ebitda / 100)} onChange={(ebitda) => set({ ebitda })} format={big} />
          <Slider label="Entry multiple (EV / EBITDA)" value={inputs.entry} min={4} max={25} step={0.5} onChange={(entry) => set({ entry, leverage: Math.min(inputs.leverage, entry - 1) })} format={(v) => multiple(v, 1)} />
          <Slider label="Debt (× EBITDA)" value={inputs.leverage} min={0} max={Math.min(8, inputs.entry - 1)} step={0.25} onChange={(leverage) => set({ leverage })} format={(v) => `${multiple(v, 2)} · ${pct(v / inputs.entry, 0)} of EV`} />
          <Slider label="Interest rate" value={inputs.rate} min={0.04} max={0.14} step={0.0025} onChange={(rate) => set({ rate })} format={(v) => pct(v, 2)} />
          <Slider label="EBITDA growth / yr" value={inputs.growth} min={-0.05} max={0.2} step={0.005} onChange={(growth) => set({ growth })} format={(v) => pct(v, 1)} />
          <Slider label="Cash conversion" value={inputs.conversion} min={0.2} max={0.8} step={0.01} onChange={(conversion) => set({ conversion })} format={(v) => pct(v, 0)} />
          <Slider label="Exit multiple" value={inputs.exit} min={4} max={25} step={0.5} onChange={(exit) => set({ exit })} format={(v) => multiple(v, 1)} />
          <Slider label="Hold period" value={inputs.years} min={2} max={8} step={1} onChange={(years) => set({ years })} format={(v) => `${v} yrs`} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Readout label="IRR" value={pct(result.irr, 1)} tone={result.irr >= 0.2 ? 'gain' : result.irr < 0.1 ? 'loss' : 'brand'} sub={result.irr >= 0.2 ? 'clears a typical 20% hurdle' : 'below a typical 20% hurdle'} />
            <Readout label="MOIC" value={multiple(result.moic, 2)} />
            <Readout label="Equity in → out" value={`${big(result.equity0)} → ${big(result.exitEquity)}`} />
            <Readout label="Exit leverage" value={multiple(result.schedule.at(-1)!.debt / result.schedule.at(-1)!.ebitda, 1)} sub={`from ${multiple(inputs.leverage, 1)}`} />
          </div>
          <Waterfall
            height={230}
            format={big}
            steps={[
              { label: 'Equity invested', value: result.equity0, kind: 'start' },
              { label: 'EBITDA growth', value: result.bridge.growth, kind: 'delta' },
              { label: 'Multiple change', value: result.bridge.multiple, kind: 'delta' },
              { label: 'Debt paydown', value: result.bridge.paydown, kind: 'delta' },
              { label: 'Fees', value: result.bridge.fees, kind: 'delta' },
              { label: 'Exit equity', value: result.exitEquity, kind: 'total', emphasis: true },
            ]}
          />
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-[11.5px]">
                <thead className="bg-surface-1 text-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Year</th>
                    <th className="px-2 py-1.5 text-right font-medium">EBITDA</th>
                    <th className="px-2 py-1.5 text-right font-medium">Interest</th>
                    <th className="px-2 py-1.5 text-right font-medium">Paydown</th>
                    <th className="px-2 py-1.5 text-right font-medium">Debt</th>
                  </tr>
                </thead>
                <tbody className="num text-ink-2">
                  <tr className="border-t border-line">
                    <td className="px-2 py-1">0</td>
                    <td className="px-2 py-1 text-right">{big(inputs.ebitda)}</td>
                    <td className="px-2 py-1 text-right">—</td>
                    <td className="px-2 py-1 text-right">—</td>
                    <td className="px-2 py-1 text-right">{big(result.debt0)}</td>
                  </tr>
                  {result.schedule.map((row) => (
                    <tr key={row.year} className="border-t border-line">
                      <td className="px-2 py-1">{row.year}</td>
                      <td className="px-2 py-1 text-right">{big(row.ebitda)}</td>
                      <td className="px-2 py-1 text-right">{big(row.interest)}</td>
                      <td className={cn('px-2 py-1 text-right', row.cash < 0 && 'text-loss')}>{big(row.cash)}</td>
                      <td className="px-2 py-1 text-right">{big(row.debt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mb-1 text-[11.5px] text-ink-2">IRR by entry (rows) and exit (columns) multiple</div>
              <table className="w-full border-separate border-spacing-0.5 text-center font-mono text-[11px]">
                <thead>
                  <tr>
                    <th />
                    {exits.map((exit) => (
                      <th key={exit} className="font-normal text-muted">{multiple(exit, 1)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry}>
                      <td className="text-left text-muted">{multiple(entry, 1)}</td>
                      {exits.map((exit) => {
                        const value = entry > inputs.leverage && exit > 0 ? runLbo({ ...inputs, entry, exit }).irr : null;
                        return (
                          <td
                            key={exit}
                            className={cn('rounded-xs px-1 py-1 text-ink transition-colors duration-300', entry === inputs.entry && exit === inputs.exit && 'ring-1 ring-brand/60')}
                            style={{ background: value === null ? 'transparent' : value >= 0.2 ? `color-mix(in srgb, var(--color-gain-fill) ${Math.min(55, 10 + (value - 0.2) * 150)}%, transparent)` : `color-mix(in srgb, var(--color-loss-fill) ${Math.min(55, 10 + (0.2 - value) * 150)}%, transparent)` }}
                          >
                            {value === null ? '—' : pct(value, 0)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-faint">Green clears 20%. Buying cheap and selling at the same multiple is the sponsor’s best friend.</p>
            </div>
          </div>
        </div>
      </div>
    </Widget>
  );
}

// ─── Bond lab ───────────────────────────────────────────────────────────────

/** Annual-pay bond per 100 face: price, Macaulay and modified duration, convexity. */
export function bondMath(coupon: number, y: number, years: number) {
  let price = 0;
  let weighted = 0;
  let convexity = 0;
  for (let t = 1; t <= years; t += 1) {
    const flow = coupon * 100 + (t === years ? 100 : 0);
    const pv = flow / (1 + y) ** t;
    price += pv;
    weighted += t * pv;
    convexity += (t * (t + 1) * pv) / (1 + y) ** 2;
  }
  const macaulay = weighted / price;
  return { price, macaulay, modified: macaulay / (1 + y), convexity: convexity / price };
}

export function BondLab() {
  const [coupon, setCoupon] = useState(0.045);
  const [yieldRate, setYieldRate] = useState(0.045);
  const [years, setYears] = useState(10);
  const [shock, setShock] = useState(0.01);
  const now = bondMath(coupon, yieldRate, years);
  const shocked = bondMath(coupon, Math.max(0.0001, yieldRate + shock), years).price;
  const durationEstimate = now.price * (1 - now.modified * shock);
  const convexityEstimate = now.price * (1 - now.modified * shock + 0.5 * now.convexity * shock * shock);
  const curve = Array.from({ length: 61 }, (_, i) => {
    const y = 0.0025 + (i / 60) * 0.12;
    return [y, bondMath(coupon, y, years).price] as [number, number];
  });
  const tangent = [0.0025, 0.1225].map((y) => [y, now.price * (1 - now.modified * (y - yieldRate))] as [number, number]);
  const ladder = [2, 5, 10, 30].map((maturity) => {
    const base = bondMath(coupon, yieldRate, maturity);
    return { maturity, change: bondMath(coupon, yieldRate + 0.01, maturity).price / base.price - 1, duration: base.modified };
  });

  return (
    <Widget title="The price–yield curve and the duration shortcut" footer="Annual coupons, 100 face. The straight line is the duration estimate; the gap between it and the curve is convexity — always in the bondholder’s favor.">
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-3.5">
          <Slider label="Coupon" value={coupon} min={0} max={0.1} step={0.0025} onChange={setCoupon} format={(v) => pct(v, 2)} />
          <Slider label="Yield to maturity" value={yieldRate} min={0.0025} max={0.12} step={0.0025} onChange={setYieldRate} format={(v) => pct(v, 2)} />
          <Slider label="Years to maturity" value={years} min={1} max={30} step={1} onChange={setYears} format={(v) => `${v}`} />
          <Slider label="Rate shock" value={shock} min={-0.03} max={0.03} step={0.0025} onChange={setShock} format={(v) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 10000)} bp`} />
          <div className="grid grid-cols-2 gap-2">
            <Readout label="Price" value={now.price.toFixed(2)} tone="brand" sub={coupon > yieldRate ? 'premium' : coupon < yieldRate ? 'discount' : 'par'} />
            <Readout label="Modified duration" value={now.modified.toFixed(2)} sub={`Macaulay ${now.macaulay.toFixed(2)}y`} />
            <Readout label="Convexity" value={now.convexity.toFixed(1)} />
            <Readout label="DV01 per $1M" value={money(now.modified * now.price * 0.0001 * 10_000, { digits: 0 })} sub="price change for 1bp" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <XYChart
            height={260}
            xFormat={(v) => pct(v, 0)}
            yFormat={(v) => v.toFixed(0)}
            layers={[
              { type: 'line', points: tangent, color: 'var(--color-series-2)', dashed: true, width: 1.25 },
              { type: 'line', points: curve, color: 'var(--color-series-1)', width: 2.25 },
              { type: 'vline', x: yieldRate + shock, color: 'rgba(255,255,255,0.35)', label: `${shock >= 0 ? '+' : ''}${Math.round(shock * 10000)}bp` },
              { type: 'dot', x: yieldRate, y: now.price, color: 'var(--color-brand-bright)', label: `today ${now.price.toFixed(1)}` },
              { type: 'dot', x: yieldRate + shock, y: shocked, color: 'var(--color-series-3)', r: 3.5 },
            ]}
          />
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Actual new price" value={shocked.toFixed(2)} sub={signedPct(shocked / now.price - 1, 2)} tone={shocked >= now.price ? 'gain' : 'loss'} />
            <Readout label="Duration estimate" value={durationEstimate.toFixed(2)} sub={`error ${(durationEstimate - shocked).toFixed(2)}`} />
            <Readout label="+ convexity" value={convexityEstimate.toFixed(2)} sub={`error ${(convexityEstimate - shocked).toFixed(2)}`} />
          </div>
          <div className="rounded-md border border-line bg-surface-1 p-3">
            <div className="mb-2 text-[12px] text-ink-2">Same coupon and yield, different maturities: price change for +100bp</div>
            {ladder.map((item) => (
              <div key={item.maturity} className="mb-1 grid grid-cols-[52px_1fr_70px] items-center gap-2 text-[11.5px]">
                <span className="text-muted">{item.maturity}-year</span>
                <div className="h-2 rounded-full bg-surface-4">
                  <div className="h-2 rounded-full bg-loss-fill transition-[width] duration-300 ease-out" style={{ width: `${Math.min(100, (-item.change / 0.25) * 100)}%` }} />
                </div>
                <span className="num text-right font-mono text-loss">{signedPct(item.change, 1)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Widget>
  );
}
