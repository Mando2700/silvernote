/**
 * Technical interview questions in the categories banks and funds actually ask (the BIWS / WSP /
 * M&I "400 questions" canon): accounting, enterprise value, valuation & DCF, M&A, LBO, markets.
 * Each has a model answer and the key points a grader looks for.
 */

export type QuestionCategory = 'accounting' | 'ev' | 'valuation' | 'ma' | 'lbo' | 'markets';

export const CATEGORIES: Array<{ id: QuestionCategory; label: string }> = [
  { id: 'accounting', label: 'Accounting' },
  { id: 'ev', label: 'EV & equity value' },
  { id: 'valuation', label: 'Valuation & DCF' },
  { id: 'ma', label: 'M&A' },
  { id: 'lbo', label: 'LBO' },
  { id: 'markets', label: 'Markets & portfolio' },
];

export type InterviewQuestion = {
  id: string;
  category: QuestionCategory;
  difficulty: 1 | 2 | 3;
  question: string;
  /** Markdown model answer. */
  answer: string;
  /** What a strong answer must cover; also the fallback self-check list. */
  keyPoints: string[];
};

export const QUESTIONS: InterviewQuestion[] = [
  // ─── Accounting ─────────────────────────────────────────────────────────────
  {
    id: 'acc-walk',
    category: 'accounting',
    difficulty: 1,
    question: 'Walk me through the three financial statements.',
    answer:
      'The **income statement** shows revenue and expenses over a period and ends in net income. The **balance sheet** is a snapshot of assets, liabilities and equity at a point in time; assets = liabilities + equity. The **cash flow statement** starts with net income, adjusts for non-cash items and working capital to get cash from operations, then adds investing (capex, acquisitions) and financing (debt, equity, dividends) to show the change in cash.',
    keyPoints: ['Income statement: revenue to net income over a period', 'Balance sheet: assets = liabilities + equity at a point in time', 'Cash flow: starts from net income, adjusts non-cash and working capital', 'Operating, investing, financing sections', 'Ends with the change in cash'],
  },
  {
    id: 'acc-link',
    category: 'accounting',
    difficulty: 1,
    question: 'How do the three statements link together?',
    answer:
      'Net income from the income statement is the first line of the cash flow statement and flows into retained earnings on the balance sheet. Non-cash charges (D&A, stock comp) are added back on the cash flow statement and reduce the related balance-sheet items (PP&E, or increase equity for SBC). Changes in working capital accounts show up in operating cash flow; capex increases PP&E; debt and equity issuance change those balances; and the net change in cash on the cash flow statement updates cash on the balance sheet.',
    keyPoints: ['Net income → top of cash flow statement', 'Net income → retained earnings (equity)', 'Non-cash items added back and reflected in PP&E / equity', 'Working capital changes tie to balance sheet accounts', 'Ending cash from CFS = cash on balance sheet'],
  },
  {
    id: 'acc-dep10',
    category: 'accounting',
    difficulty: 1,
    question: 'Depreciation goes up by $10. Walk me through the three statements (25% tax rate).',
    answer:
      '**Income statement:** operating income falls $10, taxes fall $2.50, net income falls $7.50.\n\n**Cash flow:** net income −$7.50, add back the $10 non-cash depreciation → cash from operations **+$2.50**.\n\n**Balance sheet:** cash +$2.50, PP&E −$10, so assets −$7.50. Retained earnings (equity) −$7.50. Both sides fall $7.50 and it balances.',
    keyPoints: ['Net income falls $7.50 (after $2.50 tax saving)', 'Add back $10 depreciation on cash flow statement', 'Cash up $2.50', 'PP&E down $10, total assets down $7.50', 'Retained earnings down $7.50 — balances'],
  },
  {
    id: 'acc-inventory',
    category: 'accounting',
    difficulty: 1,
    question: 'A company buys $10 of inventory with cash. Walk me through the statements.',
    answer:
      'No change on the income statement — inventory is expensed only when sold. On the cash flow statement the increase in inventory is a use of working capital: cash from operations −$10. On the balance sheet cash −$10 and inventory +$10; total assets unchanged, so it balances.',
    keyPoints: ['No income statement effect until the inventory is sold', 'Working capital increase reduces operating cash flow by $10', 'Cash −$10, inventory +$10', 'Total assets unchanged'],
  },
  {
    id: 'acc-one-statement',
    category: 'accounting',
    difficulty: 2,
    question: 'If you could use only one statement to judge a company, which would you choose and why?',
    answer:
      'The **cash flow statement**: it shows how much cash the business actually generates, is hardest to manipulate with accruals, and reveals capex needs, working-capital swings and how the company is funding itself. (A reasonable alternative: the balance sheet, because with two balance sheets you can reconstruct much of the others — but the cash flow statement is the standard answer.)',
    keyPoints: ['Cash flow statement', 'Shows real cash generation', 'Less affected by accrual accounting choices', 'Reveals capex, working capital and financing'],
  },
  {
    id: 'acc-ebitda-cash',
    category: 'accounting',
    difficulty: 2,
    question: 'Why isn’t EBITDA the same as cash flow?',
    answer:
      'EBITDA ignores four real cash costs: **capex** (the reinvestment that D&A only approximates), **changes in working capital**, **cash taxes** and **interest**. It also ignores stock-based compensation, which is a real cost paid in dilution. For capital-intensive or fast-growing companies the gap is huge. Buffett’s line: "Does management think the tooth fairy pays for capital expenditures?"',
    keyPoints: ['Excludes capex', 'Excludes working capital investment', 'Excludes taxes and interest', 'Stock-based compensation is a real cost', 'Gap is largest for capital-intensive or growing firms'],
  },
  {
    id: 'acc-goodwill',
    category: 'accounting',
    difficulty: 2,
    question: 'What is goodwill, and what happens when it is impaired?',
    answer:
      'Goodwill is the excess of the purchase price over the fair value of the target’s identifiable net assets (after writing up assets and recognizing intangibles like customer relationships). It isn’t amortized under US GAAP; it is tested for impairment. An impairment is a non-cash charge: it lowers pre-tax income (usually not tax-deductible), is added back on the cash flow statement, and reduces goodwill and retained earnings.',
    keyPoints: ['Purchase price above fair value of identifiable net assets', 'Not amortized, tested for impairment (US GAAP)', 'Impairment is a non-cash charge', 'Reduces goodwill and equity', 'No direct cash effect (usually not tax-deductible)'],
  },
  {
    id: 'acc-deferred-rev',
    category: 'accounting',
    difficulty: 1,
    question: 'What’s the difference between accounts receivable and deferred revenue?',
    answer:
      '**Accounts receivable** is revenue already recognized but not yet collected — an asset. **Deferred revenue** is cash already collected for a product or service not yet delivered — a liability. Subscription businesses with big deferred revenue effectively get financed by their customers.',
    keyPoints: ['AR: recognized revenue not yet collected (asset)', 'Deferred revenue: cash collected before delivery (liability)', 'Deferred revenue is a source of cash / customer financing'],
  },
  {
    id: 'acc-sbc',
    category: 'accounting',
    difficulty: 2,
    question: 'How should you treat stock-based compensation in a valuation?',
    answer:
      'SBC is non-cash, so it is added back in cash from operations, but it is a real economic cost: shareholders are diluted. Either **deduct it as an expense** in free cash flow (and use today’s share count), or add it back and **project the future dilution** in the share count. Doing neither double-counts the benefit and overstates value, especially for tech companies where SBC can be 10–20% of revenue.',
    keyPoints: ['Non-cash, added back in CFO', 'Real cost via dilution', 'Either treat as a cash expense or model future dilution', 'Not both / not neither', 'Material for tech companies'],
  },
  {
    id: 'acc-wc',
    category: 'accounting',
    difficulty: 1,
    question: 'What is working capital, and why does it matter for cash flow?',
    answer:
      'Operating working capital is current operating assets (receivables, inventory) minus current operating liabilities (payables, deferred revenue). When it rises, cash is tied up in the business and cash flow is lower than earnings; when it falls, the business releases cash. A growing company usually needs more working capital each year — unless, like many software or retail businesses, customers pay before suppliers are paid.',
    keyPoints: ['Current operating assets minus current operating liabilities', 'Increase uses cash, decrease releases cash', 'Growth usually requires more working capital', 'Negative working capital businesses are funded by customers/suppliers'],
  },
  // ─── EV & equity value ──────────────────────────────────────────────────────
  {
    id: 'ev-diff',
    category: 'ev',
    difficulty: 1,
    question: 'What’s the difference between enterprise value and equity value?',
    answer:
      '**Equity value** (market cap on a diluted basis) is what the company’s core business and other assets are worth to **common shareholders** only. **Enterprise value** is the value of the core operating business to **all capital providers** — debt, preferred, minority interest and equity. EV = equity value + debt + preferred + minority interest − cash (and non-operating assets).',
    keyPoints: ['Equity value: to common shareholders only', 'EV: core operations, to all capital providers', 'EV = equity + debt + preferred + minority − cash', 'EV is capital-structure neutral'],
  },
  {
    id: 'ev-cash',
    category: 'ev',
    difficulty: 1,
    question: 'Why do you subtract cash when calculating enterprise value?',
    answer:
      'Cash is a non-operating asset — it isn’t needed to run the core business and it’s already reflected in the equity value. An acquirer effectively gets it back (it could pay out the cash or use it to repay debt), so it reduces the net cost of buying the business. EV measures only the core operations.',
    keyPoints: ['Cash is non-operating', 'Already included in equity value', 'Buyer effectively gets it back', 'EV isolates the core business'],
  },
  {
    id: 'ev-negative',
    category: 'ev',
    difficulty: 2,
    question: 'Can a company have a negative enterprise value?',
    answer:
      'Yes — when its cash exceeds market cap plus debt. It usually happens to distressed or cash-burning companies (the market expects the cash to be burned) or tiny companies after an asset sale. It suggests the market values the operating business below zero.',
    keyPoints: ['Yes', 'Cash greater than equity value + debt', 'Typical of distressed or cash-burning companies', 'Market values the operations below zero'],
  },
  {
    id: 'ev-buyback',
    category: 'ev',
    difficulty: 2,
    question: 'A company does a $100M buyback funded with cash. What happens to equity value and enterprise value?',
    answer:
      '**Equity value falls $100M** (fewer shares outstanding, share price unchanged in theory). **Cash falls $100M**, which is subtracted in the EV bridge, so **EV is unchanged** — the operating business is the same.',
    keyPoints: ['Equity value down $100M', 'Cash down $100M', 'EV unchanged', 'Operating business unaffected'],
  },
  {
    id: 'ev-multiples',
    category: 'ev',
    difficulty: 1,
    question: 'Why does EV/EBITDA use enterprise value while P/E uses equity value?',
    answer:
      'Match the numerator to whoever owns the metric. **EBITDA** is earned before interest, so it belongs to both debt and equity holders → EV. **Net income** is after interest to lenders, so it belongs only to shareholders → equity value (price). Mismatching (e.g. EV/net income) mixes claims and makes comparisons between companies with different leverage meaningless.',
    keyPoints: ['Match numerator and denominator to the same capital providers', 'EBITDA is pre-interest → all providers → EV', 'Net income is post-interest → shareholders → equity value', 'Mismatches distort comparisons across leverage'],
  },
  {
    id: 'ev-diluted',
    category: 'ev',
    difficulty: 2,
    question: 'How do you calculate diluted shares? Explain the treasury stock method.',
    answer:
      'Start with basic shares, then add in-the-money options, warrants, RSUs and convertibles. For options, the **treasury stock method** assumes they are exercised and the company uses the exercise proceeds to buy back shares at the current price: net new shares = options × (1 − strike / price). Out-of-the-money options are ignored. Convertibles are added if converting is worth more than holding the bond (the if-converted method).',
    keyPoints: ['Basic shares plus dilutive securities', 'Only in-the-money options count', 'Exercise proceeds buy back shares at current price', 'Net new shares = options × (1 − strike/price)', 'Convertibles via if-converted method'],
  },
  // ─── Valuation & DCF ────────────────────────────────────────────────────────
  {
    id: 'val-dcf-walk',
    category: 'valuation',
    difficulty: 1,
    question: 'Walk me through a DCF.',
    answer:
      'A DCF values a company as the present value of its future cash flows. 1) Project **unlevered free cash flow** for 5–10 years: revenue → EBIT → less taxes (NOPAT) → plus D&A → less capex → less change in working capital. 2) Compute the **discount rate** — WACC, from the cost of equity (CAPM), after-tax cost of debt and market-value weights. 3) Compute a **terminal value** with the Gordon growth method or an exit multiple. 4) **Discount** the cash flows and the terminal value to today and add them to get **enterprise value**. 5) Bridge to **equity value** (subtract net debt, etc.) and divide by diluted shares for a per-share value. Finish with a sensitivity table on WACC and terminal growth.',
    keyPoints: ['Project unlevered FCF (EBIT → NOPAT → +D&A − capex − ΔNWC)', 'Discount at WACC (CAPM for equity, after-tax debt)', 'Terminal value: perpetuity growth or exit multiple', 'Sum of PVs = enterprise value', 'Bridge to equity value and per-share value', 'Sensitivity analysis'],
  },
  {
    id: 'val-wacc',
    category: 'valuation',
    difficulty: 1,
    question: 'How do you calculate WACC?',
    answer:
      'WACC = E/(D+E) × cost of equity + D/(D+E) × cost of debt × (1 − tax rate), with market-value weights (plus preferred if relevant). Cost of equity comes from CAPM: risk-free rate + beta × equity risk premium. Cost of debt is the yield on the company’s debt (or comparable credit), multiplied by (1 − tax) because interest is deductible.',
    keyPoints: ['Weighted average of cost of equity and after-tax cost of debt', 'Market-value weights', 'CAPM: risk-free + beta × equity risk premium', 'Cost of debt × (1 − tax rate)'],
  },
  {
    id: 'val-tv',
    category: 'valuation',
    difficulty: 2,
    question: 'What are the two ways to calculate terminal value, and which do you prefer?',
    answer:
      '**Gordon growth / perpetuity growth:** TV = FCF_{n+1} / (WACC − g), with g at or below long-run nominal GDP growth (~2–3%). **Exit multiple:** TV = final-year EBITDA × an EV/EBITDA multiple from comps. Bankers often show the exit multiple because it ties to market reality; the perpetuity method is more theoretically grounded and is independent of today’s possibly inflated multiples. Best practice is to use one and cross-check the other: the implied growth rate of the exit multiple, or the implied multiple of the growth method.',
    keyPoints: ['Perpetuity growth: FCF×(1+g)/(WACC−g)', 'Growth ≤ long-run GDP/inflation', 'Exit multiple on final-year EBITDA', 'Cross-check implied growth vs implied multiple', 'Trade-offs: theory vs market anchoring'],
  },
  {
    id: 'val-levered',
    category: 'valuation',
    difficulty: 2,
    question: 'What’s the difference between levered and unlevered free cash flow? When do you use each?',
    answer:
      '**Unlevered FCF** (FCFF) is before interest payments and debt flows — cash available to all capital providers; discount it at **WACC** to get enterprise value. **Levered FCF** (FCFE) is after interest and net borrowing — cash available to equity holders; discount it at the **cost of equity** to get equity value directly. Unlevered is standard because it is independent of capital structure; levered is used for banks and when leverage changes a lot (e.g. LBOs).',
    keyPoints: ['Unlevered: before interest, to all providers, at WACC → EV', 'Levered: after interest and net borrowing, to equity, at cost of equity → equity value', 'Unlevered is standard / capital-structure independent', 'Levered for financials or changing leverage'],
  },
  {
    id: 'val-private-beta',
    category: 'valuation',
    difficulty: 3,
    question: 'How would you estimate beta for a private company?',
    answer:
      'Take levered betas of comparable public companies, **unlever** each to remove their capital structure: βu = βL / (1 + (1 − t) × D/E). Take the median unlevered beta, then **relever** it at the private company’s target (or industry) D/E: βL = βu × (1 + (1 − t) × D/E). Use that in CAPM, often adding a size or illiquidity premium.',
    keyPoints: ['Use public comparable companies', 'Unlever: βu = βL / (1 + (1−t)D/E)', 'Take median/average', 'Relever at the target capital structure', 'Possibly add size/illiquidity premium'],
  },
  {
    id: 'val-three',
    category: 'valuation',
    difficulty: 1,
    question: 'What are the main valuation methodologies, and which usually gives the highest value?',
    answer:
      '**Trading comps** (public peer multiples), **precedent transactions** (multiples paid in past acquisitions), and **DCF** (intrinsic). Others: LBO analysis (a floor from what a PE buyer could pay), sum-of-the-parts, liquidation, DDM. **Precedents usually give the highest value** because they include a control premium; the DCF has the widest range since it is most sensitive to assumptions; LBO analysis tends to set a floor.',
    keyPoints: ['Trading comps, precedent transactions, DCF', 'Also LBO, SOTP, liquidation', 'Precedents usually highest (control premium)', 'DCF most variable', 'LBO often a floor'],
  },
  {
    id: 'val-no-dcf',
    category: 'valuation',
    difficulty: 2,
    question: 'When would you not use a DCF?',
    answer:
      'When cash flows are unpredictable or meaningless: **early-stage companies** with negative cash flows for years, **banks and insurers** (debt is raw material, not financing — use P/B, P/TBV, dividend discount or excess-return models), and companies whose value is mainly in assets (e.g. some REITs use NAV, or liquidation). Also when you are asked for a market-based view, like a fairness opinion leaning on comps.',
    keyPoints: ['Unpredictable or deeply negative cash flows (startups)', 'Financial institutions — debt is operational', 'Use P/B, P/TBV, DDM for banks', 'Asset-heavy: NAV / liquidation'],
  },
  {
    id: 'val-sensitivity',
    category: 'valuation',
    difficulty: 1,
    question: 'If WACC rises, what happens to a DCF value? What if terminal growth rises?',
    answer:
      'Higher **WACC → lower value**: every future cash flow and the terminal value are discounted more heavily (and TV’s denominator WACC − g grows). Higher **terminal growth → higher value**, often sharply, because TV = FCF(1+g)/(WACC − g) explodes as g approaches WACC. That is why terminal growth must stay below long-run economic growth.',
    keyPoints: ['Higher WACC lowers value', 'Higher terminal growth raises value', 'TV very sensitive as g approaches WACC', 'Keep g below long-run GDP growth'],
  },
  {
    id: 'val-bank',
    category: 'valuation',
    difficulty: 3,
    question: 'How would you value a bank?',
    answer:
      'Not with EV or unlevered DCF — deposits and debt are the bank’s raw material. Use **P/E, P/B and P/TBV** multiples, a **dividend discount model** or excess-return model (equity value = book value + PV of (ROE − cost of equity) × book value). The key driver: a bank earning an ROE above its cost of equity deserves to trade above book. Regulatory capital (CET1 ratio) caps how much it can pay out.',
    keyPoints: ['No EV/unlevered DCF — debt is operational', 'P/E, P/B, P/TBV', 'Dividend discount or excess return model', 'ROE vs cost of equity drives P/B', 'Regulatory capital constraints'],
  },
  // ─── M&A ────────────────────────────────────────────────────────────────────
  {
    id: 'ma-walk',
    category: 'ma',
    difficulty: 1,
    question: 'Walk me through a merger model.',
    answer:
      '1) Project both companies’ financials. 2) Set the **purchase price** (premium to the target’s price) and the **financing mix**: cash, debt, stock. 3) Compute the costs: forgone interest on cash, interest on new debt, new shares issued. 4) Combine net incomes, adjust for those costs, **synergies** and new D&A from asset write-ups, all after tax. 5) Divide by the new share count to get **pro forma EPS**, compare with the acquirer’s standalone EPS → accretion/dilution. Also build the combined balance sheet (goodwill, new debt) and check credit metrics.',
    keyPoints: ['Purchase price and premium', 'Financing mix: cash, debt, stock', 'After-tax cost of each funding source', 'Combine net incomes plus synergies and adjustments', 'Pro forma EPS vs standalone → accretion/dilution', 'Combined balance sheet with goodwill'],
  },
  {
    id: 'ma-why',
    category: 'ma',
    difficulty: 1,
    question: 'Why would a company want to acquire another company?',
    answer:
      'To grow faster than it could organically; to buy a product, technology, talent or customer base; to gain market share and pricing power; for **cost synergies** (overlapping facilities and SG&A) or **revenue synergies** (cross-selling); for vertical integration; or because the target looks undervalued. Sometimes for less noble reasons — empire building or to use expensive stock.',
    keyPoints: ['Growth and market share', 'Buy capabilities: technology, products, talent, customers', 'Cost and revenue synergies', 'Undervaluation', 'Agency motives are possible'],
  },
  {
    id: 'ma-accretion',
    category: 'ma',
    difficulty: 2,
    question: 'How can you tell quickly whether a deal is accretive or dilutive?',
    answer:
      'Compare the **target’s earnings yield at the purchase price** (target net income / price paid, i.e. 1 / purchase P/E) with the **weighted after-tax cost of acquisition**: for cash, forgone interest × (1 − t); for debt, interest × (1 − t); for stock, the acquirer’s earnings yield (1 / acquirer P/E). If the target’s yield is higher, the deal is accretive (before synergies and new D&A). For an all-stock deal that reduces to: buying a lower-P/E target is accretive.',
    keyPoints: ['Target earnings yield = 1 / purchase P/E', 'Cost of cash and debt after tax', 'Cost of stock = acquirer earnings yield', 'Weighted cost vs target yield', 'All-stock: lower P/E target is accretive'],
  },
  {
    id: 'ma-synergies',
    category: 'ma',
    difficulty: 1,
    question: 'What are synergies? Which kind do bankers trust more?',
    answer:
      '**Cost synergies** — combining overlapping functions, facilities, procurement — and **revenue synergies** — cross-selling, pricing, new markets. Cost synergies are more credible because the acquirer controls them; revenue synergies depend on customers and are often discounted or excluded. Synergies take time to phase in and come with integration costs.',
    keyPoints: ['Cost synergies: consolidation, headcount, procurement', 'Revenue synergies: cross-sell, pricing', 'Cost synergies more reliable', 'Phase-in and integration costs'],
  },
  {
    id: 'ma-cash-stock',
    category: 'ma',
    difficulty: 2,
    question: 'Why would an acquirer pay in stock rather than cash?',
    answer:
      'When its **stock is expensive** (high P/E makes stock a cheap currency), when it lacks cash or **debt capacity**, when it wants the target’s shareholders to **share the risk** of the combination, or when the deal is too large to finance otherwise. Cash is preferred when the acquirer thinks its stock is undervalued, wants certainty for the seller, or has cheap debt available. Stock deals can also be tax-deferred for sellers.',
    keyPoints: ['Acquirer stock is highly valued', 'Limited cash or debt capacity', 'Risk sharing with target shareholders', 'Cash when stock is cheap or debt is cheap', 'Tax considerations for sellers'],
  },
  // ─── LBO ────────────────────────────────────────────────────────────────────
  {
    id: 'lbo-walk',
    category: 'lbo',
    difficulty: 1,
    question: 'Walk me through a basic LBO model.',
    answer:
      '1) Set the **purchase price** (entry multiple × EBITDA) and the **sources & uses**: debt tranches and sponsor equity fund the price plus fees. 2) Project the financials and **free cash flow** after interest. 3) Use free cash flow to **pay down debt** each year (debt schedule). 4) At exit (typically 5 years), apply an **exit multiple** to EBITDA for EV, subtract remaining net debt for exit equity. 5) Compute **MOIC** (exit equity / equity invested) and **IRR**. Sensitize to entry/exit multiples and leverage.',
    keyPoints: ['Purchase price = entry multiple × EBITDA', 'Sources & uses: debt + sponsor equity', 'Project FCF and pay down debt', 'Exit: multiple × EBITDA − net debt', 'MOIC and IRR', 'Sensitivity tables'],
  },
  {
    id: 'lbo-leverage',
    category: 'lbo',
    difficulty: 1,
    question: 'Why do private equity firms use leverage when buying a company?',
    answer:
      'To **amplify returns**: debt lets them buy the same business with a smaller equity check, so any increase in value accrues to less equity. Interest is tax-deductible, and debt paydown from the company’s own cash flow transfers value from lenders to equity. The cost: higher default risk, covenants, and magnified losses if things go wrong.',
    keyPoints: ['Smaller equity check amplifies returns', 'Interest tax shield', 'Deleveraging builds equity value', 'Higher risk and magnified losses'],
  },
  {
    id: 'lbo-candidate',
    category: 'lbo',
    difficulty: 1,
    question: 'What makes a good LBO candidate?',
    answer:
      '**Stable, predictable cash flows** to service debt; **low capex and working-capital needs**; a **strong market position** or moat; a reasonable purchase price; **operational improvement** opportunities (cost cuts, pricing, add-on acquisitions); assets that can support debt; a management team that can execute; and a credible **exit** route (strategic sale, IPO, sponsor-to-sponsor).',
    keyPoints: ['Stable cash flow', 'Low capex / working capital needs', 'Strong market position', 'Room for operational improvement', 'Reasonable valuation', 'Clear exit'],
  },
  {
    id: 'lbo-paper',
    category: 'lbo',
    difficulty: 2,
    question: 'Paper LBO: buy at 10× $100M EBITDA with 5× debt. EBITDA grows to $150M in 5 years, you exit at 10×, and $250M of debt is repaid. What are MOIC and IRR?',
    answer:
      'Entry EV = 10 × 100 = **$1,000M**; debt = 5 × 100 = $500M; equity = **$500M**. Exit EV = 10 × 150 = $1,500M; remaining debt = 500 − 250 = $250M; exit equity = **$1,250M**. MOIC = 1,250 / 500 = **2.5×**. Over 5 years, 2.5× ≈ **20% IRR** (exact 2.5^(1/5) − 1 = 20.1%). Returns came from EBITDA growth ($500M) and debt paydown ($250M), none from multiple expansion.',
    keyPoints: ['Entry EV $1,000M, equity $500M', 'Exit EV $1,500M, net debt $250M', 'Exit equity $1,250M', 'MOIC 2.5×', 'IRR ≈ 20%', 'Attribute returns to growth and paydown'],
  },
  {
    id: 'lbo-divrecap',
    category: 'lbo',
    difficulty: 3,
    question: 'How does a dividend recapitalization affect IRR and MOIC?',
    answer:
      'The company borrows new debt and pays a dividend to the sponsor. Getting cash back **early raises IRR** (time value), while **MOIC is roughly unchanged or slightly lower** because the extra debt (and interest) reduces exit equity by about as much as the dividend. It also increases risk for the company and its lenders.',
    keyPoints: ['New debt funds a dividend to the sponsor', 'Early cash raises IRR', 'MOIC roughly flat or lower', 'Higher leverage and risk'],
  },
  {
    id: 'lbo-irr-shortcut',
    category: 'lbo',
    difficulty: 2,
    question: 'How do you estimate IRR from MOIC in your head?',
    answer:
      'Memorize the grid for common holds. **Over 5 years:** 1.5× ≈ 8%, 2× ≈ 15%, 2.5× ≈ 20%, 3× ≈ 25%, 4× ≈ 32%. **Over 3 years:** 2× ≈ 26%, 3× ≈ 44%. Or use the Rule of 72: doubling in 5 years ≈ 72/5 ≈ 14.4%.',
    keyPoints: ['2× over 5 years ≈ 15%', '2.5× ≈ 20%, 3× ≈ 25% over 5 years', 'Rule of 72 for doubling', 'Shorter holds mean higher IRR for the same MOIC'],
  },
  // ─── Markets & portfolio ────────────────────────────────────────────────────
  {
    id: 'mkt-sharpe',
    category: 'markets',
    difficulty: 1,
    question: 'What is the Sharpe ratio, and what are its limitations?',
    answer:
      'Excess return over the risk-free rate divided by volatility: (R − Rf) / σ — return per unit of total risk. Limitations: it treats upside and downside volatility alike (Sortino fixes that), assumes returns are roughly normal (ignores skew and fat tails, so option-selling strategies look great until they don’t), can be flattered by smoothed or illiquid returns, and — as Sharpe himself notes — ignores correlation with the rest of the portfolio.',
    keyPoints: ['(Return − risk-free) / volatility', 'Penalizes upside volatility too', 'Ignores skew and fat tails', 'Smoothed returns inflate it', 'Ignores correlation with the rest of the portfolio'],
  },
  {
    id: 'mkt-beta',
    category: 'markets',
    difficulty: 1,
    question: 'What is beta? Can it be negative?',
    answer:
      'Beta measures a stock’s sensitivity to the market: covariance(stock, market) / variance(market), the slope of a regression of its returns on the market’s. Beta 1.3 means it tends to move 1.3% for a 1% market move. It can be **negative** — gold miners or put options sometimes rise when markets fall — though negative-beta stocks are rare. Beta only captures systematic risk; a stock can have low beta and still be very volatile.',
    keyPoints: ['Cov(stock, market) / Var(market)', 'Slope of the regression on the market', 'Measures systematic risk only', 'Can be negative (gold, puts)', 'Low beta ≠ low volatility'],
  },
  {
    id: 'mkt-rates-bonds',
    category: 'markets',
    difficulty: 1,
    question: 'What happens to bond prices when interest rates rise, and why?',
    answer:
      'They **fall**. A bond’s price is the present value of fixed cash flows; when market yields rise, those cash flows are discounted at a higher rate, and investors won’t pay the old price for a lower coupon than new bonds offer. The size of the move is measured by **duration**: longer maturity and lower coupon → bigger price change.',
    keyPoints: ['Prices fall', 'PV of fixed cash flows at a higher discount rate', 'New bonds offer higher coupons', 'Duration measures sensitivity', 'Long maturity / low coupon most sensitive'],
  },
  {
    id: 'mkt-rates-equity',
    category: 'markets',
    difficulty: 2,
    question: 'How do rising interest rates affect stock valuations?',
    answer:
      'Higher rates raise the **discount rate** (risk-free rate in CAPM), lowering the present value of future cash flows — most for **long-duration growth stocks** whose cash flows are far in the future. They also raise borrowing costs, can slow the economy, and make bonds more competitive with stocks. Banks can benefit from wider net interest margins; highly levered companies and REITs usually suffer.',
    keyPoints: ['Higher discount rate lowers PVs', 'Growth / long-duration stocks hit hardest', 'Higher borrowing costs', 'Bonds become more competitive', 'Sector differences (banks vs levered/REITs)'],
  },
  {
    id: 'mkt-montecarlo',
    category: 'markets',
    difficulty: 2,
    question: 'What is a Monte Carlo simulation, and when would you use one in finance?',
    answer:
      'It generates thousands of random scenarios from assumed distributions (or resampled history) and reports the **distribution** of outcomes. Uses: retirement and portfolio planning (probability of hitting a goal), risk (VaR), pricing path-dependent derivatives, project valuation with uncertain inputs. The output is only as good as the inputs — mean, volatility, correlations and the shape of the distribution.',
    keyPoints: ['Many random scenarios from assumed distributions', 'Output is a distribution / probabilities', 'Portfolio planning, VaR, derivatives pricing', 'Sensitive to input assumptions'],
  },
  {
    id: 'mkt-inverted',
    category: 'markets',
    difficulty: 2,
    question: 'What does an inverted yield curve signal?',
    answer:
      'Short-term yields above long-term yields. It typically means the market expects the central bank to **cut rates** in the future — usually because it expects **slower growth or a recession**. Inversions of the 10y–3m or 10y–2y spread have preceded most US recessions, though with long and variable lags (and the 2022–24 inversion was followed by no immediate recession). It also squeezes bank margins (borrow short, lend long).',
    keyPoints: ['Short rates above long rates', 'Market expects future rate cuts', 'Historically precedes recessions', 'Long, variable lags / not infallible', 'Pressures bank net interest margins'],
  },
  {
    id: 'mkt-pitch',
    category: 'markets',
    difficulty: 3,
    question: 'Pitch me a stock.',
    answer:
      'Structure it: **1) Recommendation** — long/short, current price, target, time frame. **2) Thesis** — two or three reasons, each backed by numbers. **3) Variant view** — what the market believes and why it is wrong. **4) Catalysts** — dated events in 6–12 months that close the gap. **5) Valuation** — method and upside vs downside (bull/base/bear). **6) Risks** — what would prove you wrong and how you would know. Keep it to ~2 minutes; avoid consensus mega-caps unless you have a genuinely different angle.',
    keyPoints: ['Recommendation with price, target, horizon', '2–3 thesis points with evidence', 'Variant perception vs consensus', 'Dated catalysts', 'Valuation with upside/downside', 'Risks and disconfirming signals'],
  },
];

export const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));

/**
 * Fallback self-check when Grok isn't available: the share of key points whose main words appear in
 * the answer. Crude by design — it rewards covering the ground, not phrasing.
 */
export function keyPointCoverage(answer: string, keyPoints: string[]) {
  const text = answer.toLowerCase();
  const stop = new Set(['the', 'and', 'for', 'with', 'are', 'its', 'from', 'that', 'this', 'into', 'than', 'what', 'when', 'only', 'more', 'less', 'each', 'not', 'all', 'but', 'use', 'via', 'vs']);
  const covered = keyPoints.map((point) => {
    const words = point
      .toLowerCase()
      .replace(/[^a-z0-9%$.×/ ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word));
    if (!words.length) return false;
    const hits = words.filter((word) => text.includes(word.replace(/\.$/, ''))).length;
    return hits / words.length >= 0.5;
  });
  return { covered, score: keyPoints.length ? covered.filter(Boolean).length / keyPoints.length : 0 };
}
