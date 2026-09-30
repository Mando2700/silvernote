/**
 * The Learn curriculum: tracks, lessons and their quizzes. Lesson bodies (prose and interactive
 * widgets) live in components/learn/lessons; this file holds everything the hub, progress and
 * rank code need without loading them.
 *
 * Scope follows what the standard programs teach: Wall Street Prep / BIWS / CFI modeling (3-statement,
 * DCF, comps, M&A, LBO), CFA Level I (quant, FSA, equity, fixed income, portfolio management),
 * Damodaran's NYU valuation course, MIT 15.401 and Wharton investment management (risk, CAPM,
 * diversification), Mauboussin's expectations investing (reverse DCF), and hedge-fund pitch guides.
 */

export type TrackId = 'foundations' | 'valuation' | 'risk' | 'deals' | 'research';

export type Track = { id: TrackId; title: string; description: string; builtFrom: string };

export const TRACKS: Track[] = [
  {
    id: 'foundations',
    title: 'Foundations',
    description: 'Discounting, the three statements and what a company is worth to whom. Everything else is built on these.',
    builtFrom: 'CFA L1 quant & FSA · MIT 15.401 · BIWS core concepts',
  },
  {
    id: 'valuation',
    title: 'Valuation',
    description: 'Intrinsic and relative value: DCF, cost of capital, reading what a price implies, and trading comps.',
    builtFrom: 'Damodaran (NYU Stern) · Wall Street Prep · Mauboussin, Expectations Investing',
  },
  {
    id: 'risk',
    title: 'Risk & portfolios',
    description: 'Volatility, drawdowns, Sharpe, correlation and beta, Monte Carlo and Value at Risk — measured on real prices.',
    builtFrom: 'William Sharpe (Stanford) · Wharton investment management · CFA portfolio management',
  },
  {
    id: 'deals',
    title: 'Deals & credit',
    description: 'The investment-banking toolkit: merger math, leveraged buyouts and how bonds are priced.',
    builtFrom: 'BIWS & WSP M&A / LBO modules · Goldman Sachs analyst training topics · CFA fixed income',
  },
  {
    id: 'research',
    title: 'Research & pitching',
    description: 'Turning analysis into a view: theses with a variant perception, catalysts, and pitches that survive a PM.',
    builtFrom: 'Hedge-fund stock-pitch guides · sell-side initiation format · university pitch-competition rubrics',
  },
];

export type QuizQuestion =
  | { id: string; kind: 'choice'; prompt: string; options: string[]; answer: number; explain: string }
  | {
      id: string;
      kind: 'number';
      prompt: string;
      answer: number;
      /** Absolute tolerance, in the same units as `answer`. */
      tolerance: number;
      /** Shown after the input: '%', '$', '$M', '×'… */
      unit?: string;
      explain: string;
    };

export type Lesson = {
  slug: string;
  track: TrackId;
  title: string;
  summary: string;
  minutes: number;
  level: 'Core' | 'Intermediate' | 'Advanced';
  objectives: string[];
  /** Section anchors rendered by the lesson body, for the outline. */
  sections: Array<{ id: string; title: string }>;
  /** Where to use it in SilverNote afterwards. */
  tryIt: Array<{ href: string; label: string; description: string }>;
  quiz: QuizQuestion[];
};

export const LESSONS: Lesson[] = [
  // ─── Foundations ────────────────────────────────────────────────────────────
  {
    slug: 'time-value-of-money',
    track: 'foundations',
    title: 'Time value of money',
    summary: 'Why a dollar today beats a dollar next year, and the four tools that follow: PV, NPV, IRR and CAGR.',
    minutes: 12,
    level: 'Core',
    objectives: ['Discount a future cash flow to today', 'Compute NPV and read an IRR', 'Use CAGR and the Rule of 72 in your head'],
    sections: [
      { id: 'why', title: 'Why money has a time value' },
      { id: 'compounding', title: 'Compounding and discounting' },
      { id: 'npv', title: 'NPV and IRR' },
      { id: 'cagr', title: 'CAGR on a real stock' },
    ],
    tryIt: [
      { href: '/portfolio', label: 'Portfolio performance', description: 'Your time-weighted and money-weighted returns use exactly this math.' },
      { href: '/simulations', label: 'Simulations', description: 'Project contributions compounding over decades.' },
    ],
    quiz: [
      { id: 'tvm-1', kind: 'choice', prompt: 'You are offered $1,000 today or $1,100 in one year. At what annual discount rate are the two equal?', options: ['9.1%', '10%', '11%', '1.1%'], answer: 1, explain: '$1,100 / $1,000 − 1 = 10%. Above 10% you prefer the money today; below it, the $1,100.' },
      { id: 'tvm-2', kind: 'number', prompt: 'Present value of $1,000 received in 5 years, discounted at 8% a year?', answer: 680.58, tolerance: 1.5, unit: '$', explain: '1,000 / 1.08⁵ = 1,000 / 1.4693 = $680.58.' },
      { id: 'tvm-3', kind: 'choice', prompt: 'By the Rule of 72, money compounding at 9% a year doubles in about…', options: ['6 years', '8 years', '9 years', '12 years'], answer: 1, explain: '72 / 9 = 8 years. (Exact: ln 2 / ln 1.09 = 8.04.)' },
      { id: 'tvm-4', kind: 'choice', prompt: 'A project has a positive NPV at a 10% discount rate. What does that tell you about its IRR?', options: ['IRR is below 10%', 'IRR equals 10%', 'IRR exceeds 10%', 'Nothing'], answer: 2, explain: 'For a normal project (outflow first, inflows after), NPV falls as the rate rises and hits zero at the IRR. Still positive at 10% means the IRR is higher.' },
      { id: 'tvm-5', kind: 'number', prompt: 'A stock went from $50 to $80 over 4 years. What was its CAGR?', answer: 12.47, tolerance: 0.25, unit: '%', explain: '(80 / 50)^(1/4) − 1 = 1.6^0.25 − 1 = 12.47%. Not 60% / 4 = 15% — that ignores compounding.' },
    ],
  },
  {
    slug: 'three-statements',
    track: 'foundations',
    title: 'How the three statements link',
    summary: 'Income statement, cash flow statement and balance sheet as one machine — and the "depreciation goes up by $10" question.',
    minutes: 15,
    level: 'Core',
    objectives: ['Trace any transaction through all three statements', 'Explain why net income is not cash', 'Bridge revenue to free cash flow on a real company'],
    sections: [
      { id: 'statements', title: 'Three views of one business' },
      { id: 'links', title: 'Where they connect' },
      { id: 'simulator', title: 'Transaction simulator' },
      { id: 'real', title: 'Revenue to free cash flow, live' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Explorer', description: 'Open any company and switch to Financials for its filed statements.' },
      { href: '/assistant', label: 'Ask Grok', description: 'Have Grok walk a transaction through a company you follow.' },
    ],
    quiz: [
      { id: 'ts-1', kind: 'choice', prompt: 'Depreciation rises by $10 and the tax rate is 25%. What happens to cash at the end of the period?', options: ['Down $10', 'Down $7.50', 'Up $2.50', 'No change'], answer: 2, explain: 'Pre-tax income −10, taxes −2.5, net income −7.5. Cash flow adds back the non-cash $10: CFO = −7.5 + 10 = +2.5. The tax saving is the only cash effect.' },
      { id: 'ts-2', kind: 'choice', prompt: 'Which line ties the income statement to shareholders’ equity?', options: ['Revenue → accounts receivable', 'Net income → retained earnings', 'Capital spending → cash and PP&E', 'Interest expense → long-term debt balance'], answer: 1, explain: 'Net income (less dividends) flows into retained earnings, part of equity. That is why a change to net income always shows up on the balance sheet.' },
      { id: 'ts-3', kind: 'choice', prompt: 'A company buys $100 of inventory with cash. What happens to net income today?', options: ['Falls $100', 'Falls $75 after tax', 'No change', 'Rises $100'], answer: 2, explain: 'Inventory is an asset until it is sold. Cash −100, inventory +100; the cost only hits the income statement (as COGS) when the goods are sold.' },
      { id: 'ts-4', kind: 'choice', prompt: 'A customer prepays $50 for next year’s subscription. Today…', options: ['Revenue +50 and cash +50, since the money has been received', 'Cash +50 and deferred revenue (a liability) +50', 'Accounts receivable +50 and revenue +50 once the invoice is sent', 'Nothing is recorded until the service is delivered next year'], answer: 1, explain: 'Cash arrives now but the service is owed, so it is a liability (deferred revenue). Revenue is recognized as the service is delivered.' },
      { id: 'ts-5', kind: 'choice', prompt: 'Why is stock-based compensation added back in cash flow from operations?', options: ['It is not a real cost, so it should never reduce earnings at all', 'It is a non-cash expense — the cost is paid in dilution, not cash', 'It is tax-deductible, so the tax saving is added back as cash', 'It is a financing inflow that the company received from employees'], answer: 1, explain: 'SBC reduces net income but no cash leaves. It is still a real cost to shareholders (dilution), which is why careful analysts deduct it in valuation.' },
    ],
  },
  {
    slug: 'enterprise-value',
    track: 'foundations',
    title: 'Enterprise value vs equity value',
    summary: 'What the whole business is worth versus what the shareholders own — and which multiples pair with which.',
    minutes: 10,
    level: 'Core',
    objectives: ['Build the bridge from market cap to enterprise value', 'Match multiples to the right numerator', 'Answer the classic cash and debt trick questions'],
    sections: [
      { id: 'idea', title: 'Buying the house, not just the equity' },
      { id: 'bridge', title: 'The bridge, on a real company' },
      { id: 'multiples', title: 'Which multiple goes with which' },
      { id: 'traps', title: 'Interview traps' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Explorer', description: 'Sort the market by EV/EBITDA versus P/E and see where they disagree.' },
    ],
    quiz: [
      { id: 'ev-1', kind: 'number', prompt: 'Market cap $800M, debt $300M, cash $100M, nothing else. Enterprise value?', answer: 1000, tolerance: 0.5, unit: '$M', explain: '800 + 300 − 100 = $1,000M.' },
      { id: 'ev-2', kind: 'choice', prompt: 'Which multiple is internally consistent?', options: ['EV / net income', 'Equity value / EBITDA', 'EV / EBITDA', 'Equity value / EBIT'], answer: 2, explain: 'EBITDA is earned for all capital providers, so it pairs with EV. Net income is what is left for shareholders, so it pairs with equity value (P/E).' },
      { id: 'ev-3', kind: 'choice', prompt: 'A company borrows $100M and keeps it as cash. What happens to enterprise value?', options: ['Up $100M', 'Down $100M', 'Unchanged', 'Up $200M'], answer: 2, explain: 'Debt +100 and cash +100 cancel. Equity value is also unchanged. EV only moves when the operating business is worth more or less.' },
      { id: 'ev-4', kind: 'choice', prompt: 'Why is minority (non-controlling) interest added in the bridge to EV?', options: ['It is a debt-like claim that must be repaid at maturity', 'EBITDA counts 100% of partly owned subsidiaries', 'Accounting rules require it in every valuation, whatever the multiple', 'It is not — it is subtracted, as it reduces what shareholders own'], answer: 1, explain: 'If you use consolidated EBITDA (which counts all of a 70%-owned sub), the numerator must include the 30% owned by others too.' },
      { id: 'ev-5', kind: 'choice', prompt: 'A company issues $200M of new shares for cash. What happens?', options: ['EV +200, equity value unchanged', 'Equity value +200, EV unchanged', 'Both rise by 200, as the company is now bigger', 'Neither changes, because the cash offsets the new shares'], answer: 1, explain: 'Equity value rises by the new shares; cash rises by the same amount, which is subtracted in the bridge, so EV is unchanged.' },
    ],
  },
  // ─── Valuation ──────────────────────────────────────────────────────────────
  {
    slug: 'dcf',
    track: 'valuation',
    title: 'Discounted cash flow (DCF)',
    summary: 'Forecast unlevered free cash flow, discount it at WACC, add a terminal value, bridge to a price per share — on a real company.',
    minutes: 20,
    level: 'Intermediate',
    objectives: ['Build unlevered FCF from revenue', 'Compute terminal value two ways', 'Read a sensitivity table and know which inputs matter'],
    sections: [
      { id: 'logic', title: 'The logic in one line' },
      { id: 'fcf', title: 'Unlevered free cash flow' },
      { id: 'terminal', title: 'Terminal value' },
      { id: 'lab', title: 'DCF lab on a real company' },
      { id: 'pitfalls', title: 'How DCFs go wrong' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Company → DCF tab', description: 'The full model: bear/base/bull cases, reverse solve, analyst forecasts.' },
      { href: '/pitches', label: 'Pitches', description: 'Put your DCF value into a pitch’s valuation section.' },
    ],
    quiz: [
      { id: 'dcf-1', kind: 'choice', prompt: 'An unlevered DCF discounts which cash flow, at which rate?', options: ['Free cash flow to equity at the cost of equity, plus net debt', 'Free cash flow to the firm (before interest) at WACC', 'Net income at WACC, since earnings are what shareholders get', 'EBITDA at the risk-free rate, because it is the safest rate'], answer: 1, explain: 'Unlevered FCF belongs to debt and equity holders together, so it is discounted at their blended required return, WACC. The result is enterprise value.' },
      { id: 'dcf-2', kind: 'number', prompt: 'Final-year FCF is $100M, perpetual growth 2.5%, WACC 9%. Gordon growth terminal value (at the end of the final year)?', answer: 1576.9, tolerance: 2, unit: '$M', explain: 'TV = FCF × (1 + g) / (WACC − g) = 100 × 1.025 / 0.065 = $1,576.9M. Remember to discount it back to today.' },
      { id: 'dcf-3', kind: 'choice', prompt: 'Terminal value is 80% of enterprise value. What should you conclude?', options: ['The model is wrong — a sound DCF keeps terminal value under 50%', 'Value leans on long-run assumptions — stress-test growth and WACC', 'The company is overvalued, because most value is far in the future', 'Use a higher discount rate until terminal value shrinks to half'], answer: 1, explain: '60–80% is normal for healthy companies. It means the answer is dominated by the terminal assumptions, so the sensitivity table matters more than year-3 revenue.' },
      { id: 'dcf-4', kind: 'choice', prompt: 'Raising WACC by one point lowers value the most for…', options: ['A mature utility paying out most of its cash now', 'A fast grower whose cash flows arrive far out', 'Both equally, because WACC applies to every cash flow the same way', 'Neither — WACC only affects the cost of the debt in the capital structure'], answer: 1, explain: 'Distant cash flows are discounted over more periods, so they are more rate-sensitive — the same reason long bonds have high duration.' },
      { id: 'dcf-5', kind: 'choice', prompt: 'Why does the mid-year convention raise value slightly?', options: ['It adds half a year of extra growth to every forecast period in the model', 'Flows arrive through the year, so each is discounted half a period less', 'It lowers the tax rate applied to any cash flow that arrives mid-year', 'It removes the terminal value from the final year of the forecast entirely'], answer: 1, explain: 'Discounting year 1 at t = 0.5 instead of t = 1 reflects cash coming in steadily rather than all on December 31.' },
    ],
  },
  {
    slug: 'wacc',
    track: 'valuation',
    title: 'Cost of capital: WACC & CAPM',
    summary: 'Where the discount rate comes from: the risk-free rate, beta, the equity risk premium and the after-tax cost of debt.',
    minutes: 12,
    level: 'Intermediate',
    objectives: ['Compute cost of equity with CAPM', 'Weight equity and debt on market values', 'See how capital structure moves WACC'],
    sections: [
      { id: 'idea', title: 'The opportunity cost of capital' },
      { id: 'capm', title: 'Cost of equity with CAPM' },
      { id: 'debt', title: 'Cost of debt and the tax shield' },
      { id: 'builder', title: 'WACC builder with live inputs' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Company → DCF tab', description: 'Every DCF in SilverNote builds WACC from live beta and the 10-year Treasury.' },
      { href: '/settings', label: 'Settings', description: 'Set the risk-free rate your portfolio analytics use.' },
    ],
    quiz: [
      { id: 'wacc-1', kind: 'number', prompt: 'Risk-free rate 4%, beta 1.2, equity risk premium 5%. Cost of equity?', answer: 10, tolerance: 0.05, unit: '%', explain: '4% + 1.2 × 5% = 10%.' },
      { id: 'wacc-2', kind: 'number', prompt: 'Pre-tax cost of debt 6%, tax rate 25%. After-tax cost of debt?', answer: 4.5, tolerance: 0.05, unit: '%', explain: '6% × (1 − 25%) = 4.5%. Interest is tax-deductible, so the government pays part of it.' },
      { id: 'wacc-3', kind: 'number', prompt: '70% equity at 10% and 30% debt at 4.5% after tax. WACC?', answer: 8.35, tolerance: 0.05, unit: '%', explain: '0.7 × 10% + 0.3 × 4.5% = 7.0% + 1.35% = 8.35%.' },
      { id: 'wacc-4', kind: 'choice', prompt: 'Why weight WACC on market values rather than book values?', options: ['Book values are unaudited and so cannot be trusted for valuation', 'Required returns apply to what each claim is worth today', 'It always gives a lower WACC, which makes projects look better', 'Regulators require market weights in every published valuation'], answer: 1, explain: 'The opportunity cost is on the current value of each claim. Book equity can be far from market equity (buybacks, decades of retained earnings).' },
      { id: 'wacc-5', kind: 'choice', prompt: 'Adding moderate debt to an all-equity company usually…', options: ['Raises WACC right away, because debt is riskier than equity', 'Lowers WACC at first, until distress risk pushes both costs up', 'Has no effect ever, since capital structure is irrelevant in practice', 'Lowers WACC without limit, since debt is always cheaper than equity'], answer: 1, explain: 'Debt is cheaper and tax-deductible, so WACC dips; but more leverage raises beta and the cost of debt. WACC is U-shaped in leverage.' },
    ],
  },
  {
    slug: 'reverse-dcf',
    track: 'valuation',
    title: 'Reverse DCF: what’s priced in',
    summary: 'Start from the price and solve for the growth or margins it implies — then ask whether that is plausible.',
    minutes: 12,
    level: 'Advanced',
    objectives: ['Solve a DCF backwards for implied growth', 'Compare implied expectations with history and base rates', 'Frame a variant view as "the market expects X, I expect Y"'],
    sections: [
      { id: 'flip', title: 'Flip the question' },
      { id: 'solver', title: 'Solve a real stock' },
      { id: 'base-rates', title: 'Sanity-check with base rates' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Company → DCF → Solve', description: 'The full DCF tab can solve for implied growth or margin on any company.' },
      { href: '/notes', label: 'Theses', description: 'Write "the market implies X; I believe Y because…" as your variant view.' },
    ],
    quiz: [
      { id: 'rdcf-1', kind: 'choice', prompt: 'What does a reverse DCF solve for?', options: ['The fair price, by projecting cash flows and discounting at WACC', 'The growth or margins the current price implies', 'The WACC that the market is using to discount cash flows', 'The price target that sell-side analysts have published'], answer: 1, explain: 'The price is the one number you know for sure. Solving for the operating performance it requires turns "is it cheap?" into "will they beat what’s priced in?".' },
      { id: 'rdcf-2', kind: 'choice', prompt: 'The price implies 25% annual revenue growth for 5 years. The company grew 8% historically. What follows?', options: ['It is a buy, because the market expects strong growth to continue', 'Expectations are demanding; you need a reason to expect far faster growth', 'The DCF is broken, because no model should imply growth above history', 'Growth doesn’t matter here, because price already reflects everything'], answer: 1, explain: 'Few large companies sustain 25% growth for five years. That doesn’t make it a short, but the burden of proof sits with the bull.' },
      { id: 'rdcf-3', kind: 'choice', prompt: 'Mauboussin and Rappaport’s core point in Expectations Investing is that returns come from…', options: ['Buying great companies and holding them patiently through every cycle', 'Revisions to expectations — being right where the market is wrong', 'Low P/E stocks, which are systematically mispriced by the crowd', 'Following earnings momentum until estimates stop rising'], answer: 1, explain: 'A great company priced for greatness is a fair bet. Excess returns need expectations to change in your favor.' },
      { id: 'rdcf-4', kind: 'choice', prompt: 'In a reverse DCF, raising WACC makes the growth needed to justify today’s price…', options: ['Lower', 'Higher', 'Unchanged', 'Negative'], answer: 1, explain: 'Future cash flows are worth less at a higher rate, so more of them (more growth) is needed to reach the same price.' },
    ],
  },
  {
    slug: 'comps',
    track: 'valuation',
    title: 'Comparable companies & multiples',
    summary: 'Relative valuation the way bankers do it: pick peers, spread multiples, take the range, draw the football field.',
    minutes: 15,
    level: 'Intermediate',
    objectives: ['Choose a defensible peer set', 'Turn a peer multiple into an implied share price', 'Read a football-field chart'],
    sections: [
      { id: 'idea', title: 'Pricing by analogy' },
      { id: 'peers', title: 'Live comps table' },
      { id: 'football', title: 'The football field' },
      { id: 'precedents', title: 'Precedent transactions' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Company → Peers tab', description: 'Edit the peer set and see sector and industry medians.' },
      { href: '/explorer', label: 'Explorer', description: 'Screen for companies cheap on EV/EBITDA versus their sector.' },
    ],
    quiz: [
      { id: 'comps-1', kind: 'number', prompt: 'Peer median EV/EBITDA is 12×. Target EBITDA $50M, net debt $100M, 20M shares. Implied share price?', answer: 25, tolerance: 0.1, unit: '$', explain: 'EV = 12 × 50 = 600; equity = 600 − 100 = 500; per share = 500 / 20 = $25.' },
      { id: 'comps-2', kind: 'choice', prompt: 'Why is P/E a poor comparison between companies with very different debt levels?', options: ['P/E ignores growth entirely, so it cannot compare any two firms', 'Net income is after interest, so debt levels distort it', 'P/E is not reported for private companies or for firms with debt', 'It isn’t a poor comparison — P/E is always the best multiple to use'], answer: 1, explain: 'Two identical businesses with different debt have different net income and P/E but the same EV/EBITDA.' },
      { id: 'comps-3', kind: 'choice', prompt: 'Precedent transaction multiples are usually higher than trading multiples because…', options: ['They are older deals, so they reflect higher historical prices', 'Buyers pay a control premium (and for synergies)', 'They use EBITDA from a later year than trading multiples do', 'Of accounting differences between deal and trading financials'], answer: 1, explain: 'Acquirers typically pay 20–40% over the undisturbed price to get control.' },
      { id: 'comps-4', kind: 'choice', prompt: 'Which is the best peer for a comps set?', options: ['Any company in the same sector, since the sector sets the multiple', 'A company with a similar business model, growth, margins and size', 'The largest company in the industry, since it is the benchmark', 'A company with a similar share price, so multiples are comparable'], answer: 1, explain: 'Sector labels are too coarse. Multiples reflect growth, returns and risk, so peers should share those.' },
      { id: 'comps-5', kind: 'choice', prompt: 'A stock trades at 30× earnings, peers at 20×. Most defensible conclusion?', options: ['It is overvalued by 50% and should fall back toward the peer multiple', 'Growth or returns may justify it — check growth-adjusted multiples', 'It will fall to 20× as the market corrects the premium over time', 'Peers are undervalued, so the whole sector should re-rate upward soon'], answer: 1, explain: 'Multiples are shorthand for a DCF. Higher growth and ROIC justify a higher multiple; the question is whether the premium is too big.' },
    ],
  },
  // ─── Risk & portfolios ──────────────────────────────────────────────────────
  {
    slug: 'risk-return',
    track: 'risk',
    title: 'Return, volatility & drawdowns',
    summary: 'Measure what you earned and what you endured: annualized return, volatility, volatility drag and maximum drawdown.',
    minutes: 12,
    level: 'Core',
    objectives: ['Annualize return and volatility', 'Understand why losses need bigger gains to recover', 'Read a drawdown ("underwater") chart'],
    sections: [
      { id: 'return', title: 'Return: arithmetic vs compound' },
      { id: 'vol', title: 'Volatility' },
      { id: 'lab', title: 'A real stock against the market' },
      { id: 'drawdown', title: 'Drawdowns' },
    ],
    tryIt: [
      { href: '/portfolio', label: 'Portfolio → Risk', description: 'Your own volatility, max drawdown and more, from your holdings.' },
      { href: '/backtest', label: 'Backtest', description: 'See drawdowns of rule-based strategies over ten years.' },
    ],
    quiz: [
      { id: 'rr-1', kind: 'choice', prompt: 'Daily volatility is 1.5%. Approximate annualized volatility?', options: ['1.5% × 252 trading days = 378%', '1.5% × √252 ≈ 23.8%', '1.5% × 12 months = 18%', 'It stays 1.5%'], answer: 1, explain: 'Variance scales with time, so standard deviation scales with √time: 1.5% × 15.87 ≈ 23.8%.' },
      { id: 'rr-2', kind: 'number', prompt: 'A stock falls 50%. What percentage gain does it need to get back to even?', answer: 100, tolerance: 0.5, unit: '%', explain: '$100 → $50 needs +$50, which is +100% of $50.' },
      { id: 'rr-3', kind: 'choice', prompt: 'Maximum drawdown measures…', options: ['The worst loss on any single day', 'The biggest peak-to-trough fall', 'The annualized volatility of returns', 'The lowest price the asset has ever traded at'], answer: 1, explain: 'It is the worst loss an investor who bought at a high and sold at the subsequent low would have suffered.' },
      { id: 'rr-4', kind: 'choice', prompt: '+50% one year, −50% the next. The average return is 0%. What did you actually end with?', options: ['Break-even', '−25%', '+25%', '−50%'], answer: 1, explain: '1.5 × 0.5 = 0.75. Volatility drags compound returns below arithmetic averages.' },
      { id: 'rr-5', kind: 'number', prompt: 'Arithmetic mean return 10%, volatility 20%. Approximate compound (geometric) return using μ − σ²/2?', answer: 8, tolerance: 0.1, unit: '%', explain: '10% − 0.20² / 2 = 10% − 2% = 8%.' },
    ],
  },
  {
    slug: 'sharpe-ratio',
    track: 'risk',
    title: 'Sharpe, Sortino & risk-adjusted return',
    summary: 'Return per unit of risk — Sharpe’s own definition, its cousins (Sortino, Treynor, information ratio, Calmar) and their blind spots.',
    minutes: 14,
    level: 'Intermediate',
    objectives: ['Compute and interpret the Sharpe ratio', 'Know when Sortino or Calmar tell a better story', 'Compare real stocks and your portfolio on one chart'],
    sections: [
      { id: 'definition', title: 'Sharpe’s definition' },
      { id: 'family', title: 'The family of ratios' },
      { id: 'lab', title: 'Compare real stocks' },
      { id: 'limits', title: 'What Sharpe doesn’t see' },
    ],
    tryIt: [
      { href: '/portfolio', label: 'Portfolio → Risk', description: 'Sharpe, Sortino, beta and VaR for your actual holdings.' },
      { href: '/simulations', label: 'What-if', description: 'See how adding a stock changes your portfolio Sharpe.' },
    ],
    quiz: [
      { id: 'sr-1', kind: 'number', prompt: 'Annual return 12%, risk-free rate 4%, volatility 16%. Sharpe ratio?', answer: 0.5, tolerance: 0.01, explain: '(12% − 4%) / 16% = 0.5.' },
      { id: 'sr-2', kind: 'choice', prompt: 'The Sortino ratio differs from Sharpe by…', options: ['Using the benchmark index instead of cash as the reference return', 'Dividing by downside deviation only, so upside isn’t penalized', 'Using maximum drawdown instead of standard deviation as the risk', 'Using beta instead of volatility as the risk measure'], answer: 1, explain: 'Investors mind losses more than gains; Sortino only counts returns below the target in the denominator.' },
      { id: 'sr-3', kind: 'choice', prompt: 'Fund A: Sharpe 1.2 at 5% volatility. Fund B: Sharpe 0.8 at 20% volatility. Which is better risk-adjusted?', options: ['B — higher volatility means it earns a higher return', 'A — levered to 20% volatility it would out-earn B', 'They are equal, since risk-adjusted returns always converge', 'Cannot tell without knowing each fund’s benchmark and fees'], answer: 1, explain: 'Sharpe is invariant to leverage (ignoring costs): A levered 4× has 20% vol and a 24% excess return versus B’s 16%.' },
      { id: 'sr-4', kind: 'choice', prompt: 'Why can a hedge fund’s reported Sharpe be misleading?', options: ['Hedge funds don’t have to report their returns to anyone', 'Smoothed marks and tail risk hide volatility until it hits', 'Sharpe is only valid for bond portfolios, not equity strategies', 'Fees are excluded from Sharpe, so results are always too high'], answer: 1, explain: 'Selling crash insurance produces steady small gains and a great Sharpe — until the crash.' },
      { id: 'sr-5', kind: 'choice', prompt: 'Which caveat does William Sharpe himself stress?', options: ['It only works for equities, not for bonds or other assets', 'It ignores correlation with the rest of your portfolio', 'It needs daily data, so monthly returns give misleading numbers', 'It can’t be annualized without assuming normal returns'], answer: 1, explain: 'A low-Sharpe asset can still improve a portfolio if it is uncorrelated. Sharpe of the parts ≠ Sharpe of the whole.' },
    ],
  },
  {
    slug: 'diversification',
    track: 'risk',
    title: 'Correlation, beta & diversification',
    summary: 'Why two risky assets can be less risky together, what beta measures, and which risk diversification can and can’t remove.',
    minutes: 15,
    level: 'Intermediate',
    objectives: ['Compute two-asset portfolio volatility', 'Estimate beta from a scatter of returns', 'Separate market risk from company-specific risk'],
    sections: [
      { id: 'math', title: 'The one formula that matters' },
      { id: 'frontier', title: 'Correlation playground' },
      { id: 'beta', title: 'Beta on a real stock' },
      { id: 'systematic', title: 'Systematic vs idiosyncratic risk' },
    ],
    tryIt: [
      { href: '/portfolio', label: 'Portfolio → Risk', description: 'Your correlation matrix and each holding’s risk contribution.' },
      { href: '/simulations', label: 'What-if', description: 'Test whether a new name diversifies or concentrates your risk.' },
    ],
    quiz: [
      { id: 'div-1', kind: 'number', prompt: 'Two assets, each 20% volatility, held 50/50 with zero correlation. Portfolio volatility?', answer: 14.14, tolerance: 0.1, unit: '%', explain: '√(0.5²·0.2² + 0.5²·0.2²) = √0.02 = 14.14%. Zero correlation cuts risk by ~30%.' },
      { id: 'div-2', kind: 'choice', prompt: 'With correlation +1, portfolio volatility equals…', options: ['Zero, because the two risks cancel out completely', 'The weighted average of the two volatilities', 'The lower of the two volatilities, as the safer asset dominates', 'The sum of both volatilities, with no weighting applied'], answer: 1, explain: 'At ρ = 1 the formula collapses to (w₁σ₁ + w₂σ₂)². Every point below that line is diversification.' },
      { id: 'div-3', kind: 'choice', prompt: 'A stock’s beta is 1.5. If the market falls 10%, its expected move is…', options: ['−10%, the same as the market', '−15%, plus company-specific noise', '−1.5%, one tenth of the market move', '+15%, because beta above 1 means it rises'], answer: 1, explain: 'Beta is the slope of the stock’s returns on the market’s; the rest is idiosyncratic.' },
      { id: 'div-4', kind: 'choice', prompt: 'Which risk does holding many stocks remove?', options: ['Market (systematic) risk that hits all stocks', 'Company-specific (idiosyncratic) risk', 'Interest-rate risk that affects every asset', 'All risk, so a large portfolio has zero volatility'], answer: 1, explain: 'Idiosyncratic shocks average out; the market factor doesn’t. That is why CAPM rewards only beta.' },
      { id: 'div-5', kind: 'choice', prompt: 'A stock has beta 0.5 but R² of 0.05. This means…', options: ['It is very safe, since low beta means the stock barely moves', 'Beta explains little of its risk; most of it is company-specific', 'It will fall half as much as the market, with little noise', 'The regression is broken, since a valid beta needs R² above 0.5'], answer: 1, explain: 'Low beta with low R² is typical of volatile small caps or biotechs: most of their risk is their own.' },
    ],
  },
  {
    slug: 'monte-carlo',
    track: 'risk',
    title: 'Monte Carlo simulation',
    summary: 'Replace one forecast with thousands of random futures — built from a real stock’s returns — and read the distribution.',
    minutes: 14,
    level: 'Intermediate',
    objectives: ['Explain how random paths are generated', 'Compare bootstrap and lognormal (GBM) methods', 'Read percentiles, probability of loss and the mean–median gap'],
    sections: [
      { id: 'idea', title: 'Many futures instead of one' },
      { id: 'lab', title: 'Simulate a real stock' },
      { id: 'methods', title: 'Bootstrap vs lognormal' },
      { id: 'limits', title: 'Garbage in, garbage out' },
    ],
    tryIt: [
      { href: '/simulations', label: 'Simulations → Monte Carlo', description: 'Run 10,000 paths on your whole portfolio with contributions and a target.' },
    ],
    quiz: [
      { id: 'mc-1', kind: 'choice', prompt: 'What does a Monte Carlo simulation give you that a single forecast can’t?', options: ['The exact future value once enough paths are run', 'A distribution of outcomes with probabilities', 'A guaranteed higher return than a forecast', 'A lower volatility than the historical data'], answer: 1, explain: 'It answers "how likely is X?" — e.g. the chance of ending below what you invested.' },
      { id: 'mc-2', kind: 'choice', prompt: 'Bootstrap simulation differs from a lognormal (GBM) one by…', options: ['Using no randomness at all, so every run gives the same answer', 'Resampling actual historical returns, keeping fat tails and skew', 'Using only the mean return, which removes the noise in the paths', 'Ignoring volatility and simulating the drift on its own'], answer: 1, explain: 'GBM assumes normally distributed log returns; bootstrap uses what really happened, blocks of it at a time.' },
      { id: 'mc-3', kind: 'choice', prompt: 'Quadrupling the number of simulations…', options: ['Fixes wrong assumptions because there is more data behind them', 'Halves the sampling error of the estimates, but not model error', 'Doubles the expected return by averaging over more paths', 'Has no effect, because the simulations are all independent'], answer: 1, explain: 'Sampling error shrinks with 1/√N. More paths make a wrong model more precisely wrong.' },
      { id: 'mc-4', kind: 'choice', prompt: 'In a lognormal simulation the mean outcome is above the median because…', options: ['Of a bug in the random number generator used by the model', 'Outcomes are right-skewed: a few huge paths pull the mean up', 'Losses are capped at zero, which removes downside paths only', 'The median is biased downward by the compounding of losses'], answer: 1, explain: 'Compounding produces a long right tail. The median is the "typical" outcome.' },
      { id: 'mc-5', kind: 'choice', prompt: 'The biggest risk in using a Monte Carlo result is…', options: ['Too few decimals in the reported outputs and percentiles', 'The assumptions behind it (returns, volatility) — model risk', 'Chart colors that make the distribution hard to read', 'Running it on a day when markets are open and volatile'], answer: 1, explain: 'The output inherits every assumption. Stress tests (2008, 2020, 2022) complement it.' },
    ],
  },
  {
    slug: 'value-at-risk',
    track: 'risk',
    title: 'Value at Risk & tail risk',
    summary: 'The number risk managers report — what it says, what it hides, and why expected shortfall and stress tests exist.',
    minutes: 12,
    level: 'Advanced',
    objectives: ['Compute historical and parametric VaR', 'Explain expected shortfall (CVaR)', 'See fat tails in a real return histogram'],
    sections: [
      { id: 'definition', title: 'What VaR says' },
      { id: 'lab', title: 'VaR on a real stock' },
      { id: 'es', title: 'Expected shortfall and fat tails' },
    ],
    tryIt: [
      { href: '/portfolio', label: 'Portfolio → Risk', description: 'Historical VaR and CVaR for your holdings.' },
      { href: '/simulations', label: 'Stress tests', description: 'Replay 2008, 2020 and 2022 on your portfolio.' },
    ],
    quiz: [
      { id: 'var-1', kind: 'choice', prompt: 'A 1-day 95% VaR of $10,000 on a $1M portfolio means…', options: ['You can’t lose more than $10,000 in a day at 95% confidence', 'About 1 day in 20 you should lose at least $10,000', 'You lose $10,000 on a typical day of trading', 'Your average loss across the worst 5% of days is $10,000'], answer: 1, explain: 'VaR is a threshold, not a maximum. It says nothing about how bad the worst 5% of days are.' },
      { id: 'var-2', kind: 'number', prompt: 'Daily volatility 2%, $1M position. Parametric 95% 1-day VaR (z = 1.645, ignore the mean)?', answer: 32900, tolerance: 100, unit: '$', explain: '1.645 × 2% × $1,000,000 = $32,900.' },
      { id: 'var-3', kind: 'choice', prompt: 'Expected shortfall (CVaR) at 95% is…', options: ['The same number as VaR, computed a different way', 'The average loss on the worst 5% of days', 'The average gain on the best 5% of days', 'The maximum loss the portfolio could ever suffer'], answer: 1, explain: 'It looks inside the tail VaR ignores, and is what Basel III now uses for market risk.' },
      { id: 'var-4', kind: 'number', prompt: '1-day VaR is $10,000. Using the square-root-of-time rule, 10-day VaR?', answer: 31623, tolerance: 60, unit: '$', explain: '$10,000 × √10 = $31,623. The rule assumes independent days — false in a crisis.' },
      { id: 'var-5', kind: 'choice', prompt: 'Why can historical VaR understate risk?', options: ['It uses too much data, which dilutes the recent volatility', 'The window may hold no crisis, and real returns have fatter tails', 'It ignores the mean return, which biases the tail estimate', 'It is always too high, because it includes every bad day'], answer: 1, explain: 'A VaR estimated on 2017 data said little about March 2020.' },
    ],
  },
  // ─── Deals & credit ─────────────────────────────────────────────────────────
  {
    slug: 'm-and-a',
    track: 'deals',
    title: 'M&A: accretion / dilution',
    summary: 'The merger model at the heart of banking: purchase price, financing mix, synergies — and whether the buyer’s EPS goes up.',
    minutes: 18,
    level: 'Advanced',
    objectives: ['Build pro forma EPS for cash, stock and debt deals', 'Use the P/E and cost-of-funds rules of thumb', 'Know why accretion isn’t value creation'],
    sections: [
      { id: 'why', title: 'Why companies buy companies' },
      { id: 'model', title: 'The merger model in five steps' },
      { id: 'lab', title: 'Merge two real companies' },
      { id: 'rules', title: 'Rules of thumb and traps' },
    ],
    tryIt: [
      { href: '/explorer', label: 'Explorer', description: 'Find targets: filter by P/E below your acquirer’s and positive earnings.' },
      { href: '/assistant', label: 'Ask Grok', description: 'Ask why a recent deal was accretive or dilutive.' },
    ],
    quiz: [
      { id: 'ma-1', kind: 'choice', prompt: 'All-stock deal: acquirer trades at 20× earnings, the target is bought at 15× (premium included). Accretive or dilutive (no synergies)?', options: ['Dilutive — the buyer pays a premium, which always cuts EPS', 'Accretive — cheaper earnings are bought with expensive paper', 'Neutral, since both companies issue shares at fair value', 'Depends on the tax rate, which changes both earnings streams'], answer: 1, explain: 'The acquirer’s earnings yield is 5%; the target’s (at the price paid) is 6.7%. Buying higher-yielding earnings with lower-yielding stock raises EPS.' },
      { id: 'ma-2', kind: 'choice', prompt: 'In an all-cash deal funded from the balance sheet, compare the target’s earnings yield to…', options: ['The acquirer’s own P/E ratio at the announcement date', 'The after-tax interest income the cash was earning', 'The target’s dividend yield after the premium is paid', 'The market return on the S&P 500 over the last year'], answer: 1, explain: 'The cost of cash is the interest you give up, after tax. If the target yields more, the deal is accretive.' },
      { id: 'ma-3', kind: 'number', prompt: 'A target is bought at 12.5× its earnings. What is its earnings yield at the purchase price?', answer: 8, tolerance: 0.05, unit: '%', explain: '1 / 12.5 = 8%.' },
      { id: 'ma-4', kind: 'choice', prompt: 'An accretive deal…', options: ['Always creates value, since EPS rises for shareholders', 'Can destroy value if the price exceeds worth plus synergies', 'Always raises the acquirer’s share price on announcement', 'Means the target was cheap relative to its peer group'], answer: 1, explain: 'EPS is an accounting outcome. Value depends on price paid versus intrinsic value + synergies, and on the risk added.' },
      { id: 'ma-5', kind: 'choice', prompt: 'Goodwill created in an acquisition is…', options: ['The value of the target’s brand and customer relationships', 'Purchase price above the fair value of identifiable net assets', 'The value of the synergies the acquirer expects to realize', 'Just the control premium paid over the undisturbed share price'], answer: 1, explain: 'After writing up identifiable assets (and creating new intangibles), whatever is left over is goodwill, tested yearly for impairment.' },
    ],
  },
  {
    slug: 'lbo',
    track: 'deals',
    title: 'Leveraged buyouts (LBO)',
    summary: 'How private equity turns a mostly-debt-funded purchase into equity returns — sources & uses, debt paydown, IRR and MOIC.',
    minutes: 18,
    level: 'Advanced',
    objectives: ['Lay out sources & uses and the debt schedule', 'Compute MOIC and IRR (and estimate them in your head)', 'Split returns into EBITDA growth, multiple and deleveraging'],
    sections: [
      { id: 'idea', title: 'Buying a house with a mortgage' },
      { id: 'lab', title: 'LBO lab' },
      { id: 'drivers', title: 'Where returns come from' },
      { id: 'paper', title: 'The paper LBO' },
    ],
    tryIt: [
      { href: '/learn/practice', label: 'Practice → Paper LBO', description: 'Randomized paper LBOs with the solution walkthrough.' },
      { href: '/explorer', label: 'Explorer', description: 'Screen for LBO candidates: high FCF margin, low debt, modest EV/EBITDA.' },
    ],
    quiz: [
      { id: 'lbo-1', kind: 'number', prompt: 'A company is bought for $500M with 60% debt. At exit, equity is worth $600M. MOIC?', answer: 3, tolerance: 0.01, unit: '×', explain: 'Equity in = 40% × 500 = $200M. 600 / 200 = 3.0×.' },
      { id: 'lbo-2', kind: 'choice', prompt: '3.0× over 5 years is roughly what IRR?', options: ['~15%', '~20%', '~25%', '~35%'], answer: 2, explain: '3^(1/5) − 1 = 24.6%. Memorize: over 5 years 2× ≈ 15%, 2.5× ≈ 20%, 3× ≈ 25%.' },
      { id: 'lbo-3', kind: 'choice', prompt: 'The three drivers of LBO equity returns are…', options: ['Revenue, margin and tax-rate changes over the holding period', 'EBITDA growth, multiple expansion, debt paydown', 'Fees, dividends and buybacks paid out during the hold', 'Beta, alpha and leverage relative to the market index'], answer: 1, explain: 'Equity at exit = exit multiple × exit EBITDA − remaining debt. Each term is a lever.' },
      { id: 'lbo-4', kind: 'choice', prompt: 'Why does private equity use so much debt?', options: ['Debt is effectively free, since it does not need repaying', 'A small equity check amplifies returns; interest is tax-deductible', 'Banks require it before they agree to finance any buyout', 'It lowers the purchase price the sponsor pays for the target'], answer: 1, explain: 'If the business grows, gains accrue to a small equity base. The flip side: losses do too.' },
      { id: 'lbo-5', kind: 'choice', prompt: 'The ideal LBO candidate has…', options: ['High growth and heavy capex, reinvesting all the cash flow', 'Stable cash flows, low capex, a solid market position and upside', 'Volatile earnings, with little existing debt capacity to use', 'Negative EBITDA today, with a big turnaround story ahead'], answer: 1, explain: 'Predictable cash is what services the debt.' },
    ],
  },
  {
    slug: 'bonds',
    track: 'deals',
    title: 'Bonds: yield, duration & convexity',
    summary: 'Price–yield math, why long bonds swing more, and the duration shortcut every rates desk uses.',
    minutes: 14,
    level: 'Intermediate',
    objectives: ['Price a bond from its yield', 'Estimate price moves with duration', 'See convexity in the price–yield curve'],
    sections: [
      { id: 'pricing', title: 'A bond is a bundle of cash flows' },
      { id: 'lab', title: 'Price–yield lab' },
      { id: 'duration', title: 'Duration and convexity' },
    ],
    tryIt: [
      { href: '/portfolio', label: 'Portfolio → Bonds', description: 'Your bonds on the live Treasury curve: duration, DV01 and rate shocks.' },
    ],
    quiz: [
      { id: 'bond-1', kind: 'choice', prompt: 'Market yields rise. Prices of existing fixed-rate bonds…', options: ['Rise', 'Fall', 'Don’t change', 'Go to par'], answer: 1, explain: 'New bonds pay more, so old ones must get cheaper to offer the same yield.' },
      { id: 'bond-2', kind: 'number', prompt: 'Modified duration 7. Yields rise 1 point. Approximate price change?', answer: -7, tolerance: 0.05, unit: '%', explain: 'ΔP/P ≈ −D_mod × Δy = −7 × 1% = −7%.' },
      { id: 'bond-3', kind: 'choice', prompt: 'Which has the most interest-rate risk?', options: ['2-year 5% coupon bond', '10-year 5% coupon bond', '30-year 5% coupon bond', '30-year zero-coupon'], answer: 3, explain: 'Longest maturity and all cash at the end: its duration equals its 30-year maturity.' },
      { id: 'bond-4', kind: 'number', prompt: 'Price of a 2-year, 5% annual-coupon bond (face 100) when its yield is 5%?', answer: 100, tolerance: 0.05, unit: '$', explain: 'When coupon = yield, the bond prices at par: 5/1.05 + 105/1.05² = 100.' },
      { id: 'bond-5', kind: 'choice', prompt: 'Positive convexity means…', options: ['Price moves linearly with yield, so duration is a perfect guide', 'Gains from falling yields exceed losses from rising ones', 'The bond is callable, so the issuer can redeem it early', 'Duration is negative, so the price rises as yields go up'], answer: 1, explain: 'The price–yield curve bends upward, so duration alone overstates losses and understates gains for big moves.' },
    ],
  },
  // ─── Research & pitching ────────────────────────────────────────────────────
  {
    slug: 'investment-thesis',
    track: 'research',
    title: 'Writing an investment thesis',
    summary: 'A thesis is a falsifiable claim about value the market is missing. Variant perception, drivers, and what would prove you wrong.',
    minutes: 14,
    level: 'Intermediate',
    objectives: ['State a variant perception in one sentence', 'Pick the 3–5 drivers that move value', 'Write disconfirming signals with thresholds'],
    sections: [
      { id: 'what', title: 'What a thesis is (and isn’t)' },
      { id: 'anatomy', title: 'Anatomy of a strong thesis' },
      { id: 'compare', title: 'Weak vs strong' },
      { id: 'discipline', title: 'Keep it honest' },
    ],
    tryIt: [
      { href: '/notes', label: 'Notes & theses', description: 'Every company has a versioned thesis workspace: drivers, risks, catalysts, "what would prove me wrong".' },
      { href: '/learn/examples', label: 'Case library', description: 'Famous theses that worked — and ones that didn’t.' },
    ],
    quiz: [
      { id: 'th-1', kind: 'choice', prompt: 'A variant perception is…', options: ['A contrarian view on everything, whatever the facts say', 'A well-founded view that differs from consensus', 'The analyst consensus, as published by the sell side', 'A technical signal from the price and volume chart'], answer: 1, explain: 'Michael Steinhardt’s term: different from the market, and right. Different alone isn’t enough.' },
      { id: 'th-2', kind: 'choice', prompt: 'Which is the best disconfirming signal?', options: ['"If the story changes materially over the coming year"', '"Gross margin below 60% for two consecutive quarters"', '"If the stock falls more than the rest of the market does"', '"If management disappoints investors on a conference call"'], answer: 1, explain: 'Specific, measurable and decided in advance, so you can’t rationalize it away later.' },
      { id: 'th-3', kind: 'choice', prompt: 'Which is the weakest thesis statement?', options: ['"The market prices 5% growth; new capacity supports 12% through FY27"', '"It’s a great company with strong management"', '"Margins will expand 300bp as the mix shifts to software"', '"Consensus misses the $2B buyback funded by the asset sale"'], answer: 1, explain: 'It is consensus, unfalsifiable and says nothing about price.' },
      { id: 'th-4', kind: 'choice', prompt: 'Value drivers in a thesis should be…', options: ['As many as possible so nothing important is missed', 'The 3–5 measurable variables that move value most', 'Only macro factors, since company detail is noise', 'Only qualitative ones, since numbers hide the story'], answer: 1, explain: 'If you can’t name what to track each quarter, you don’t have a thesis to monitor.' },
    ],
  },
  {
    slug: 'stock-pitch',
    track: 'research',
    title: 'Pitching a stock',
    summary: 'The structure hedge funds and pitch competitions expect: recommendation, thesis, variant view, catalysts, valuation, risks — with asymmetric payoff.',
    minutes: 16,
    level: 'Advanced',
    objectives: ['Deliver a pitch in the order a PM expects', 'Tell hard catalysts from soft ones', 'Show risk/reward with probability-weighted scenarios'],
    sections: [
      { id: 'structure', title: 'The 90-second structure' },
      { id: 'catalysts', title: 'Hard vs soft catalysts' },
      { id: 'asymmetry', title: 'Risk/reward on a real stock' },
      { id: 'judged', title: 'How pitches are judged' },
    ],
    tryIt: [
      { href: '/learn/pitch', label: 'Pitch studio', description: 'Write a pitch on any company and get it rated — by the rubric and by Grok.' },
      { href: '/pitches', label: 'Pitches', description: 'Build the full pitch document and export it to PDF or slides.' },
    ],
    quiz: [
      { id: 'sp-1', kind: 'choice', prompt: 'The expected order of a stock pitch is…', options: ['Company history → products → management → industry → financials → valuation', 'Recommendation → thesis → variant view → catalysts → valuation → risks', 'Valuation → financial model → risks → business description → recommendation', 'Technical chart pattern → recent news flow → analyst targets → own target'], answer: 1, explain: 'Lead with the answer. A PM decides in the first 30 seconds whether to keep listening.' },
      { id: 'sp-2', kind: 'choice', prompt: 'Which is a hard catalyst?', options: ['"Management could expand internationally"', '"FDA decision date set for March 14"', '"The market will realize its value"', '"Sentiment should improve"'], answer: 1, explain: 'Hard catalysts are dated events with a knowable outcome: earnings, regulatory decisions, deal closings, investor days.' },
      { id: 'sp-3', kind: 'number', prompt: 'Bull $150 (25%), base $120 (50%), bear $70 (25%). Probability-weighted value?', answer: 115, tolerance: 0.1, unit: '$', explain: '0.25 × 150 + 0.5 × 120 + 0.25 × 70 = 37.5 + 60 + 17.5 = $115.' },
      { id: 'sp-4', kind: 'choice', prompt: 'Stock at $100, base-case target $130, downside case $85. Upside-to-downside ratio?', options: ['1:1', '2:1', '3:1', '0.5:1'], answer: 1, explain: '+30 upside versus −15 downside = 2:1. Many funds want at least 2–3:1.' },
      { id: 'sp-5', kind: 'choice', prompt: 'The most common reason interviewers reject a pitch is…', options: ['Too many slides for the time available in the interview', 'It is a consensus long with no variant view', 'The company is too small for the fund to own', 'The price target is too precise to be credible'], answer: 1, explain: '"Apple is a great company" isn’t a pitch. Why is it mispriced, and what closes the gap?' },
    ],
  },
];

export const LESSON_BY_SLUG = new Map(LESSONS.map((lesson) => [lesson.slug, lesson]));

export function lessonsInTrack(track: TrackId) {
  return LESSONS.filter((lesson) => lesson.track === track);
}

export function adjacentLessons(slug: string) {
  const index = LESSONS.findIndex((lesson) => lesson.slug === slug);
  return { previous: index > 0 ? LESSONS[index - 1] : null, next: index >= 0 && index < LESSONS.length - 1 ? LESSONS[index + 1] : null };
}

/** True when a typed numeric answer is within tolerance. Accepts "12.5", "12.5%", "$1,576", "3x". */
export function checkNumber(input: string, answer: number, tolerance: number) {
  const cleaned = input.replace(/[,$%×x\s]/gi, '').replace(/[−–]/g, '-');
  if (!cleaned) return false;
  const value = Number(cleaned);
  return Number.isFinite(value) && Math.abs(value - answer) <= tolerance + 1e-9;
}

/** The sources the curriculum was designed from, shown on the hub. */
export const SOURCES = [
  { name: 'Wall Street Prep', what: 'Financial & valuation modeling: 3-statement, DCF, comps, M&A, LBO', url: 'https://www.wallstreetprep.com/self-study-programs/premium-package/' },
  { name: 'Breaking Into Wall Street', what: 'IB interview guide: accounting, EV, DCF, merger and LBO technicals', url: 'https://breakingintowallstreet.com/investment-banking-interview-guide/' },
  { name: 'Mergers & Inquisitions', what: 'Stock pitch structure, hard vs soft catalysts, example pitches', url: 'https://mergersandinquisitions.com/stock-pitch-guide/' },
  { name: 'CFA Institute (Level I)', what: 'Quant, FSA, equity, fixed income, derivatives, portfolio management', url: 'https://finance.uworld.com/cfa/level-1-topics/' },
  { name: 'Aswath Damodaran, NYU Stern', what: 'Valuation: DCF inputs, relative valuation, acquisitions', url: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqsyl.htm' },
  { name: 'MIT 15.401 Finance Theory', what: 'Present value, fixed income, risk & return, CAPM, efficient markets', url: 'https://ocw.mit.edu/courses/15-401-finance-theory-i-fall-2008/' },
  { name: 'William F. Sharpe, Stanford', what: 'The Sharpe ratio: definition, annualization, limitations', url: 'https://web.stanford.edu/~wfsharpe/art/sr/sr.htm' },
  { name: 'Morgan Stanley Counterpoint Global', what: 'Mauboussin & Rappaport: expectations investing, reverse DCF', url: 'https://www.morganstanley.com/im/en-us/individual-investor/insights/series/consilient-observer.html' },
  { name: 'Wharton investment management', what: 'Diversification, factor models, performance evaluation', url: 'https://finance.wharton.upenn.edu/~stambaug/syllabus.pdf' },
  { name: 'Corporate Finance Institute (FMVA)', what: 'Modeling, scenario analysis, pitchbooks, sell-side research', url: 'https://corporatefinanceinstitute.com/certifications/financial-modeling-valuation-analyst-fmva-program/' },
  { name: 'University pitch competitions', what: 'Judging rubrics from Kentucky Gatton and Young Investors Society', url: 'https://gatton.uky.edu/uk-stock-pitch-competition' },
];
