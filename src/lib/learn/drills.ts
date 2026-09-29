/**
 * Randomized numeric drills with worked solutions — the paper-and-pencil problems of IB and CFA prep.
 * Every generator is deterministic for a seed, so a drill can be replayed and tested.
 */

import type { TrackId } from '@/lib/learn/curriculum';

export type DrillType =
  | 'pv'
  | 'cagr'
  | 'ev'
  | 'wacc'
  | 'terminal'
  | 'comps'
  | 'sharpe'
  | 'portfolio-vol'
  | 'var'
  | 'lbo'
  | 'accretion'
  | 'bond';

export type Drill = {
  type: DrillType;
  seed: number;
  prompt: string;
  given: Array<{ label: string; value: string }>;
  answer: number;
  /** Absolute tolerance in answer units. */
  tolerance: number;
  unit: '%' | '$' | '$M' | '×' | '';
  steps: string[];
};

export const DRILL_TYPES: Array<{ type: DrillType; label: string; track: TrackId; lesson: string; blurb: string }> = [
  { type: 'pv', label: 'Present value', track: 'foundations', lesson: 'time-value-of-money', blurb: 'Discount a future amount to today.' },
  { type: 'cagr', label: 'CAGR', track: 'foundations', lesson: 'time-value-of-money', blurb: 'Compound annual growth between two values.' },
  { type: 'ev', label: 'Enterprise value', track: 'foundations', lesson: 'enterprise-value', blurb: 'Bridge from market cap to EV.' },
  { type: 'wacc', label: 'WACC', track: 'valuation', lesson: 'wacc', blurb: 'CAPM cost of equity, after-tax debt, weights.' },
  { type: 'terminal', label: 'Terminal value', track: 'valuation', lesson: 'dcf', blurb: 'Gordon growth terminal value.' },
  { type: 'comps', label: 'Comps → price', track: 'valuation', lesson: 'comps', blurb: 'Peer EV/EBITDA to an implied share price.' },
  { type: 'sharpe', label: 'Sharpe ratio', track: 'risk', lesson: 'sharpe-ratio', blurb: 'Excess return per unit of volatility.' },
  { type: 'portfolio-vol', label: 'Portfolio volatility', track: 'risk', lesson: 'diversification', blurb: 'Two assets with a correlation.' },
  { type: 'var', label: 'Value at Risk', track: 'risk', lesson: 'value-at-risk', blurb: 'Parametric VaR over a horizon.' },
  { type: 'lbo', label: 'Paper LBO', track: 'deals', lesson: 'lbo', blurb: 'Entry, paydown, exit → IRR.' },
  { type: 'accretion', label: 'Accretion / dilution', track: 'deals', lesson: 'm-and-a', blurb: 'Pro forma EPS for a mixed deal.' },
  { type: 'bond', label: 'Bond price', track: 'deals', lesson: 'bonds', blurb: 'Price an annual-coupon bond from its yield.' },
];

export const DRILL_META = new Map(DRILL_TYPES.map((item) => [item.type, item]));

function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random value from `min` to `max` in increments of `step`. */
function pick(random: () => number, min: number, max: number, step: number) {
  const count = Math.round((max - min) / step);
  return Math.round((min + Math.floor(random() * (count + 1)) * step) * 1e6) / 1e6;
}

const $ = (value: number, digits = 0) => `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const $m = (value: number, digits = 0) => `${$(value, digits)}M`;
const p = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const r2 = (value: number) => Math.round(value * 100) / 100;

export function generateDrill(type: DrillType, seed: number): Drill {
  const random = rng(seed);
  switch (type) {
    case 'pv': {
      const future = pick(random, 5, 50, 1) * 1000;
      const rate = pick(random, 0.04, 0.12, 0.01);
      const years = pick(random, 3, 10, 1);
      const factor = (1 + rate) ** years;
      const answer = future / factor;
      return {
        type,
        seed,
        prompt: `What is the present value of ${$(future)} received in ${years} years, discounted at ${p(rate, 0)} a year?`,
        given: [
          { label: 'Future amount', value: $(future) },
          { label: 'Discount rate', value: p(rate, 0) },
          { label: 'Years', value: String(years) },
        ],
        answer: r2(answer),
        tolerance: Math.max(1, answer * 0.002),
        unit: '$',
        steps: [`Discount factor = (1 + ${p(rate, 0)})^${years} = ${factor.toFixed(4)}`, `PV = ${$(future)} / ${factor.toFixed(4)} = ${$(answer, 2)}`],
      };
    }
    case 'cagr': {
      const start = pick(random, 20, 200, 5);
      const years = pick(random, 3, 10, 1);
      const growth = pick(random, -0.05, 0.25, 0.005);
      const end = Math.round(start * (1 + growth) ** years);
      const answer = ((end / start) ** (1 / years) - 1) * 100;
      return {
        type,
        seed,
        prompt: `A stock went from ${$(start)} to ${$(end)} over ${years} years. What was its compound annual growth rate?`,
        given: [
          { label: 'Start', value: $(start) },
          { label: 'End', value: $(end) },
          { label: 'Years', value: String(years) },
        ],
        answer: r2(answer),
        tolerance: 0.15,
        unit: '%',
        steps: [`Growth multiple = ${end} / ${start} = ${(end / start).toFixed(4)}`, `CAGR = ${(end / start).toFixed(4)}^(1/${years}) − 1 = ${answer.toFixed(2)}%`],
      };
    }
    case 'ev': {
      const shares = pick(random, 50, 500, 10);
      const price = pick(random, 10, 150, 1);
      const debt = pick(random, 0, 3000, 50);
      const cash = pick(random, 50, 1500, 25);
      const minority = random() < 0.5 ? pick(random, 25, 300, 25) : 0;
      const preferred = random() < 0.35 ? pick(random, 50, 250, 25) : 0;
      const equity = shares * price;
      const answer = equity + debt + minority + preferred - cash;
      return {
        type,
        seed,
        prompt: `A company has ${shares}M diluted shares at ${$(price)}, ${$m(debt)} of debt and ${$m(cash)} of cash${minority ? `, ${$m(minority)} of minority interest` : ''}${preferred ? ` and ${$m(preferred)} of preferred stock` : ''}. What is its enterprise value?`,
        given: [
          { label: 'Diluted shares', value: `${shares}M` },
          { label: 'Share price', value: $(price) },
          { label: 'Debt', value: $m(debt) },
          { label: 'Cash', value: $m(cash) },
          ...(minority ? [{ label: 'Minority interest', value: $m(minority) }] : []),
          ...(preferred ? [{ label: 'Preferred stock', value: $m(preferred) }] : []),
        ],
        answer: r2(answer),
        tolerance: 0.5,
        unit: '$M',
        steps: [
          `Equity value = ${shares}M × ${$(price)} = ${$m(equity)}`,
          `EV = equity + debt${minority ? ' + minority' : ''}${preferred ? ' + preferred' : ''} − cash`,
          `EV = ${equity} + ${debt}${minority ? ` + ${minority}` : ''}${preferred ? ` + ${preferred}` : ''} − ${cash} = ${$m(answer)}`,
        ],
      };
    }
    case 'wacc': {
      const riskFree = pick(random, 0.03, 0.05, 0.0025);
      const beta = pick(random, 0.6, 1.8, 0.05);
      const premium = pick(random, 0.045, 0.06, 0.005);
      const costOfDebt = pick(random, 0.045, 0.09, 0.0025);
      const tax = pick(random, 0.21, 0.28, 0.01);
      const debtWeight = pick(random, 0.1, 0.5, 0.05);
      const costOfEquity = riskFree + beta * premium;
      const afterTax = costOfDebt * (1 - tax);
      const answer = ((1 - debtWeight) * costOfEquity + debtWeight * afterTax) * 100;
      return {
        type,
        seed,
        prompt: `Compute WACC. Risk-free rate ${p(riskFree, 2)}, beta ${beta.toFixed(2)}, equity risk premium ${p(premium, 1)}, pre-tax cost of debt ${p(costOfDebt, 2)}, tax rate ${p(tax, 0)}, and debt is ${p(debtWeight, 0)} of capital at market value.`,
        given: [
          { label: 'Risk-free', value: p(riskFree, 2) },
          { label: 'Beta', value: beta.toFixed(2) },
          { label: 'ERP', value: p(premium, 1) },
          { label: 'Cost of debt', value: p(costOfDebt, 2) },
          { label: 'Tax rate', value: p(tax, 0) },
          { label: 'Debt / capital', value: p(debtWeight, 0) },
        ],
        answer: r2(answer),
        tolerance: 0.06,
        unit: '%',
        steps: [
          `Cost of equity = ${p(riskFree, 2)} + ${beta.toFixed(2)} × ${p(premium, 1)} = ${p(costOfEquity, 2)}`,
          `After-tax cost of debt = ${p(costOfDebt, 2)} × (1 − ${p(tax, 0)}) = ${p(afterTax, 2)}`,
          `WACC = ${p(1 - debtWeight, 0)} × ${p(costOfEquity, 2)} + ${p(debtWeight, 0)} × ${p(afterTax, 2)} = ${answer.toFixed(2)}%`,
        ],
      };
    }
    case 'terminal': {
      const fcf = pick(random, 50, 800, 10);
      const growth = pick(random, 0.015, 0.035, 0.005);
      const wacc = pick(random, 0.07, 0.12, 0.005);
      const answer = (fcf * (1 + growth)) / (wacc - growth);
      return {
        type,
        seed,
        prompt: `Final-year unlevered FCF is ${$m(fcf)}. With ${p(growth, 1)} perpetual growth and a ${p(wacc, 1)} WACC, what is the Gordon growth terminal value (at the end of the final year)?`,
        given: [
          { label: 'Final-year FCF', value: $m(fcf) },
          { label: 'Perpetual growth', value: p(growth, 1) },
          { label: 'WACC', value: p(wacc, 1) },
        ],
        answer: r2(answer),
        tolerance: Math.max(1, answer * 0.002),
        unit: '$M',
        steps: [`Next year’s FCF = ${fcf} × (1 + ${p(growth, 1)}) = ${$m(fcf * (1 + growth), 1)}`, `TV = ${(fcf * (1 + growth)).toFixed(1)} / (${p(wacc, 1)} − ${p(growth, 1)}) = ${$m(answer, 1)}`],
      };
    }
    case 'comps': {
      const ebitda = pick(random, 40, 900, 10);
      const multiples = Array.from({ length: 5 }, () => pick(random, 6, 18, 0.5)).sort((a, b) => a - b);
      const median = multiples[2];
      const netDebt = pick(random, -200, 1500, 25);
      const shares = pick(random, 20, 400, 5);
      const ev = median * ebitda;
      const answer = (ev - netDebt) / shares;
      if (answer <= 0) return generateDrill(type, seed + 7919);
      return {
        type,
        seed,
        prompt: `Five peers trade at ${multiples.map((m) => `${m.toFixed(1)}×`).join(', ')} EV/EBITDA. Your company has ${$m(ebitda)} of EBITDA, ${netDebt >= 0 ? `${$m(netDebt)} of net debt` : `${$m(-netDebt)} of net cash`} and ${shares}M shares. What share price does the peer median imply?`,
        given: [
          { label: 'Peer multiples', value: multiples.map((m) => `${m.toFixed(1)}×`).join(' · ') },
          { label: 'EBITDA', value: $m(ebitda) },
          { label: netDebt >= 0 ? 'Net debt' : 'Net cash', value: $m(Math.abs(netDebt)) },
          { label: 'Shares', value: `${shares}M` },
        ],
        answer: r2(answer),
        tolerance: 0.05,
        unit: '$',
        steps: [
          `Median multiple = ${median.toFixed(1)}× (the middle of five)`,
          `Implied EV = ${median.toFixed(1)} × ${ebitda} = ${$m(ev, 1)}`,
          `Equity = EV − net debt = ${ev.toFixed(1)} − (${netDebt}) = ${$m(ev - netDebt, 1)}`,
          `Per share = ${(ev - netDebt).toFixed(1)} / ${shares}M = ${$(answer, 2)}`,
        ],
      };
    }
    case 'sharpe': {
      const ret = pick(random, 0.02, 0.25, 0.005);
      const riskFree = pick(random, 0.02, 0.05, 0.0025);
      const vol = pick(random, 0.08, 0.4, 0.01);
      const answer = (ret - riskFree) / vol;
      return {
        type,
        seed,
        prompt: `A fund returned ${p(ret, 1)} a year with ${p(vol, 0)} annualized volatility. The risk-free rate is ${p(riskFree, 2)}. What is its Sharpe ratio?`,
        given: [
          { label: 'Return', value: p(ret, 1) },
          { label: 'Volatility', value: p(vol, 0) },
          { label: 'Risk-free', value: p(riskFree, 2) },
        ],
        answer: r2(answer),
        tolerance: 0.011,
        unit: '',
        steps: [`Excess return = ${p(ret, 1)} − ${p(riskFree, 2)} = ${p(ret - riskFree, 2)}`, `Sharpe = ${p(ret - riskFree, 2)} / ${p(vol, 0)} = ${answer.toFixed(2)}`],
      };
    }
    case 'portfolio-vol': {
      const volA = pick(random, 0.1, 0.45, 0.01);
      const volB = pick(random, 0.05, 0.35, 0.01);
      const weight = pick(random, 0.2, 0.8, 0.05);
      const rho = pick(random, -0.5, 0.9, 0.1);
      const variance = weight ** 2 * volA ** 2 + (1 - weight) ** 2 * volB ** 2 + 2 * weight * (1 - weight) * rho * volA * volB;
      const answer = Math.sqrt(variance) * 100;
      return {
        type,
        seed,
        prompt: `Asset A has ${p(volA, 0)} volatility, asset B ${p(volB, 0)}. You hold ${p(weight, 0)} in A and ${p(1 - weight, 0)} in B, and their correlation is ${rho.toFixed(1)}. What is the portfolio’s volatility?`,
        given: [
          { label: 'σ A', value: p(volA, 0) },
          { label: 'σ B', value: p(volB, 0) },
          { label: 'Weight A', value: p(weight, 0) },
          { label: 'Correlation', value: rho.toFixed(1) },
        ],
        answer: r2(answer),
        tolerance: 0.1,
        unit: '%',
        steps: [
          'σ²p = wA²σA² + wB²σB² + 2·wA·wB·ρ·σA·σB',
          `= ${(weight ** 2 * volA ** 2).toFixed(5)} + ${((1 - weight) ** 2 * volB ** 2).toFixed(5)} + ${(2 * weight * (1 - weight) * rho * volA * volB).toFixed(5)} = ${variance.toFixed(5)}`,
          `σp = √${variance.toFixed(5)} = ${answer.toFixed(2)}%`,
        ],
      };
    }
    case 'var': {
      const position = pick(random, 1, 20, 1) * 100_000;
      const dailyVol = pick(random, 0.008, 0.035, 0.001);
      const confidence = random() < 0.5 ? 0.95 : 0.99;
      const z = confidence === 0.95 ? 1.645 : 2.326;
      const horizon = [1, 5, 10][Math.floor(random() * 3)];
      const answer = z * dailyVol * Math.sqrt(horizon) * position;
      return {
        type,
        seed,
        prompt: `A ${$(position)} position has ${p(dailyVol, 1)} daily volatility. What is its ${Math.round(confidence * 100)}% ${horizon}-day parametric VaR (z = ${z}, ignore the mean, square-root-of-time scaling)?`,
        given: [
          { label: 'Position', value: $(position) },
          { label: 'Daily volatility', value: p(dailyVol, 1) },
          { label: 'Confidence', value: `${Math.round(confidence * 100)}% (z = ${z})` },
          { label: 'Horizon', value: `${horizon} day${horizon > 1 ? 's' : ''}` },
        ],
        answer: Math.round(answer),
        tolerance: Math.max(5, answer * 0.003),
        unit: '$',
        steps: [
          `${horizon}-day volatility = ${p(dailyVol, 1)} × √${horizon} = ${p(dailyVol * Math.sqrt(horizon), 3)}`,
          `VaR = ${z} × ${p(dailyVol * Math.sqrt(horizon), 3)} × ${$(position)} = ${$(answer)}`,
        ],
      };
    }
    case 'lbo': {
      const ebitda = pick(random, 50, 300, 10);
      const entry = pick(random, 7, 12, 0.5);
      const leverage = pick(random, 3, Math.min(6.5, entry - 2), 0.5);
      const growth = pick(random, 0.02, 0.12, 0.01);
      const years = [3, 4, 5, 5, 5, 6][Math.floor(random() * 6)];
      const exit = pick(random, entry - 1.5, entry + 1.5, 0.5);
      const paydownShare = pick(random, 0.2, 0.6, 0.05);
      const ev = entry * ebitda;
      const debt = leverage * ebitda;
      const equity = ev - debt;
      const exitEbitda = ebitda * (1 + growth) ** years;
      const repaid = debt * paydownShare;
      const exitEquity = exit * exitEbitda - (debt - repaid);
      const moic = exitEquity / equity;
      const answer = (moic ** (1 / years) - 1) * 100;
      return {
        type,
        seed,
        prompt: `A sponsor buys a company with ${$m(ebitda)} of EBITDA at ${entry.toFixed(1)}× using ${leverage.toFixed(1)}× debt (ignore fees). EBITDA grows ${p(growth, 0)} a year for ${years} years, ${p(paydownShare, 0)} of the debt is repaid from cash flow, and it exits at ${exit.toFixed(1)}×. What is the IRR?`,
        given: [
          { label: 'EBITDA', value: $m(ebitda) },
          { label: 'Entry multiple', value: `${entry.toFixed(1)}×` },
          { label: 'Debt', value: `${leverage.toFixed(1)}× EBITDA` },
          { label: 'EBITDA growth', value: `${p(growth, 0)} / yr` },
          { label: 'Hold', value: `${years} years` },
          { label: 'Debt repaid', value: p(paydownShare, 0) },
          { label: 'Exit multiple', value: `${exit.toFixed(1)}×` },
        ],
        answer: r2(answer),
        tolerance: 0.5,
        unit: '%',
        steps: [
          `Entry EV = ${entry.toFixed(1)} × ${ebitda} = ${$m(ev, 1)}; debt = ${$m(debt, 1)}; equity = ${$m(equity, 1)}`,
          `Exit EBITDA = ${ebitda} × ${(1 + growth).toFixed(2)}^${years} = ${$m(exitEbitda, 1)}`,
          `Exit EV = ${exit.toFixed(1)} × ${exitEbitda.toFixed(1)} = ${$m(exit * exitEbitda, 1)}; remaining debt = ${$m(debt - repaid, 1)}`,
          `Exit equity = ${$m(exitEquity, 1)} → MOIC = ${moic.toFixed(2)}×`,
          `IRR = ${moic.toFixed(2)}^(1/${years}) − 1 = ${answer.toFixed(1)}%`,
        ],
      };
    }
    case 'accretion': {
      const acquirerNi = pick(random, 200, 2000, 50);
      const acquirerShares = pick(random, 100, 800, 10);
      const acquirerPe = pick(random, 12, 30, 1);
      const acquirerEps = acquirerNi / acquirerShares;
      const acquirerPrice = acquirerEps * acquirerPe;
      const targetNi = pick(random, 20, acquirerNi * 0.4, 5);
      const purchasePe = pick(random, 10, 28, 1);
      const price = targetNi * purchasePe;
      const stockShare = pick(random, 0, 1, 0.25);
      const debtRate = pick(random, 0.05, 0.08, 0.005);
      const tax = 0.25;
      const newShares = (price * stockShare) / acquirerPrice;
      const interest = price * (1 - stockShare) * debtRate * (1 - tax);
      const proForma = (acquirerNi + targetNi - interest) / (acquirerShares + newShares);
      const answer = (proForma / acquirerEps - 1) * 100;
      return {
        type,
        seed,
        prompt: `The acquirer earns ${$m(acquirerNi)} on ${acquirerShares}M shares and trades at ${acquirerPe}× earnings. It buys a target earning ${$m(targetNi)} for ${$m(price)} (${purchasePe}× earnings), paying ${p(stockShare, 0)} in new stock and the rest with new debt at ${p(debtRate, 1)} (25% tax). No synergies. EPS accretion (+) or dilution (−)?`,
        given: [
          { label: 'Acquirer net income', value: $m(acquirerNi) },
          { label: 'Acquirer shares', value: `${acquirerShares}M` },
          { label: 'Acquirer P/E', value: `${acquirerPe}×` },
          { label: 'Target net income', value: $m(targetNi) },
          { label: 'Purchase price', value: $m(price) },
          { label: 'Stock / debt', value: `${p(stockShare, 0)} / ${p(1 - stockShare, 0)}` },
          { label: 'Debt rate · tax', value: `${p(debtRate, 1)} · 25%` },
        ],
        answer: r2(answer),
        tolerance: 0.2,
        unit: '%',
        steps: [
          `Acquirer EPS = ${acquirerNi} / ${acquirerShares} = ${$(acquirerEps, 2)}; share price = ${acquirerPe} × EPS = ${$(acquirerPrice, 2)}`,
          `New shares = ${$m(price * stockShare, 1)} / ${$(acquirerPrice, 2)} = ${newShares.toFixed(2)}M`,
          `After-tax interest = ${$m(price * (1 - stockShare), 1)} × ${p(debtRate, 1)} × 75% = ${$m(interest, 2)}`,
          `Pro forma EPS = (${acquirerNi} + ${targetNi} − ${interest.toFixed(2)}) / (${acquirerShares} + ${newShares.toFixed(2)}) = ${$(proForma, 3)}`,
          `Accretion = ${$(proForma, 3)} / ${$(acquirerEps, 3)} − 1 = ${answer.toFixed(2)}%`,
        ],
      };
    }
    case 'bond': {
      const coupon = pick(random, 0.02, 0.08, 0.0025);
      const yieldRate = pick(random, 0.02, 0.09, 0.0025);
      const years = pick(random, 2, 10, 1);
      let price = 0;
      for (let t = 1; t <= years; t += 1) price += (coupon * 1000) / (1 + yieldRate) ** t;
      price += 1000 / (1 + yieldRate) ** years;
      return {
        type,
        seed,
        prompt: `Price a ${years}-year bond with a ${p(coupon, 2)} annual coupon and $1,000 face value when its yield to maturity is ${p(yieldRate, 2)}.`,
        given: [
          { label: 'Face', value: '$1,000' },
          { label: 'Coupon (annual)', value: `${p(coupon, 2)} = ${$(coupon * 1000, 2)}` },
          { label: 'Yield', value: p(yieldRate, 2) },
          { label: 'Years', value: String(years) },
        ],
        answer: r2(price),
        tolerance: 0.6,
        unit: '$',
        steps: [
          `Coupons: ${$(coupon * 1000, 2)} × annuity factor [1 − (1 + y)^−${years}] / y = ${$((coupon * 1000 * (1 - (1 + yieldRate) ** -years)) / yieldRate, 2)}`,
          `Principal: $1,000 / (1 + ${p(yieldRate, 2)})^${years} = ${$(1000 / (1 + yieldRate) ** years, 2)}`,
          `Price = ${$(price, 2)} (${coupon > yieldRate ? 'premium — coupon above yield' : coupon < yieldRate ? 'discount — coupon below yield' : 'par'})`,
        ],
      };
    }
  }
}
