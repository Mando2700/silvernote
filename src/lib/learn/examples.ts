/**
 * Case library: well-documented historical investment theses — winners and failures — retold in the
 * pitch format taught in Learn, plus a fully worked model pitch on a fictional company. Figures are
 * rounded and simplified for teaching; each case notes what to check before relying on a number.
 */

import type { PitchDraft } from '@/lib/learn/rubric';

export type CaseStudy = {
  id: string;
  title: string;
  company: string;
  /** Current ticker when the company still trades, for opening it in SilverNote. */
  symbol: string | null;
  investor: string;
  period: string;
  direction: 'long' | 'short';
  outcome: 'worked' | 'failed';
  tagline: string;
  setup: string;
  consensus: string;
  variant: string;
  evidence: string[];
  catalysts: string[];
  valuation: string;
  risks: string[];
  whatHappened: string;
  lessons: string[];
  concepts: Array<{ label: string; lesson: string }>;
};

export const CASES: CaseStudy[] = [
  {
    id: 'amex-1964',
    title: 'American Express and the salad-oil scandal',
    company: 'American Express',
    symbol: 'AXP',
    investor: 'Warren Buffett (Buffett Partnership)',
    period: '1963–1966',
    direction: 'long',
    outcome: 'worked',
    tagline: 'A scary headline, an intact franchise.',
    setup:
      'In late 1963 a commodities fraud at Allied Crude Vegetable Oil left an American Express warehousing subsidiary facing claims for salad oil that didn’t exist. Liabilities looked open-ended and the stock fell by roughly half.',
    consensus: 'The liability could cripple the company; its reputation for trust — the product it sells — was damaged.',
    variant:
      'The loss was large but finite and one-off. The earning power came from travelers cheques and the charge card, and customers hadn’t stopped using either. The market was pricing a permanent impairment for a temporary problem.',
    evidence: [
      'Scuttlebutt: Buffett watched restaurants and shops in Omaha — card and cheque usage hadn’t dropped.',
      'The core businesses kept growing through the scandal.',
      'Even a large settlement was small against several years of franchise earnings.',
    ],
    catalysts: ['Settlement of the salad-oil claims', 'Continued growth in cheque and card volumes, visible in reported results'],
    valuation: 'Normalize earnings excluding the one-off loss and value the franchise on those; the settlement becomes a one-time deduction, not a reason for a permanently lower multiple.',
    risks: ['Claims far larger than estimated', 'A lasting loss of customer trust'],
    whatHappened:
      'American Express settled the claims, its franchise kept compounding, and the stock recovered strongly over the next few years. The partnership had put an unusually large share of its capital — reportedly around 40% — into the idea.',
    lessons: ['Separate one-off losses from damage to earning power.', 'Primary research (scuttlebutt) can answer the question the market is afraid of.', 'Big mispricings often come with frightening headlines.'],
    concepts: [
      { label: 'Normalized earnings in a DCF', lesson: 'dcf' },
      { label: 'Variant perception', lesson: 'investment-thesis' },
    ],
  },
  {
    id: 'coke-1988',
    title: 'Coca-Cola: paying up for a global moat',
    company: 'Coca-Cola',
    symbol: 'KO',
    investor: 'Berkshire Hathaway',
    period: '1988–1998',
    direction: 'long',
    outcome: 'worked',
    tagline: 'A fair price for a wonderful business.',
    setup:
      'After the 1987 crash, Berkshire bought about $1 billion of Coca-Cola — then its largest investment — at a premium to the market multiple. New management under Roberto Goizueta was refocusing on concentrate, pushing internationally and buying back stock.',
    consensus: 'A mature soft-drink company with limited growth, fairly valued after its run.',
    variant:
      'Per-capita consumption outside the US was a fraction of US levels, the concentrate model needed little capital, and the brand gave pricing power. Growth would last far longer than a "mature" label implied — so the multiple wasn’t high for what it was.',
    evidence: ['High returns on capital from the concentrate model', 'International volume growth far above the US', 'Consistent buybacks shrinking the share count'],
    catalysts: ['International volume growth showing up in earnings', 'Continued buybacks'],
    valuation: 'A DCF with a long competitive-advantage period: sustained high-single to low-double-digit earnings growth justified a premium multiple to the market.',
    risks: ['Emerging-market volatility and currency', 'Paying a premium multiple leaves less margin of safety'],
    whatHappened: 'The stake was worth roughly ten times its cost a decade later, though the shares then went sideways for years once the valuation got ahead of growth in the late 1990s.',
    lessons: [
      'Quality can be cheap if the market underestimates how long returns stay high (the competitive-advantage period).',
      'Even a great business is a poor investment at too high a price — the post-1998 decade shows it.',
    ],
    concepts: [
      { label: 'Terminal value and long growth runways', lesson: 'dcf' },
      { label: 'Multiples vs growth', lesson: 'comps' },
    ],
  },
  {
    id: 'msft-2014',
    title: 'Microsoft’s cloud re-rating',
    company: 'Microsoft',
    symbol: 'MSFT',
    investor: 'Value and GARP investors (widely held idea)',
    period: '2013–2018',
    direction: 'long',
    outcome: 'worked',
    tagline: 'The market priced a melting ice cube; the installed base was a distribution advantage.',
    setup:
      'In 2013 Microsoft traded around 10–12× earnings with a large net cash pile. PC sales were shrinking, Windows 8 was poorly received and the Nokia handset deal looked like a mistake. Satya Nadella became CEO in February 2014.',
    consensus: 'A legacy PC-software company in secular decline, worth a low multiple of shrinking earnings.',
    variant:
      'Enterprise customers were locked into Office, Windows Server and Active Directory. Moving them to Office 365 subscriptions and Azure would raise revenue per user and make it recurring; the market valued none of the cloud optionality.',
    evidence: ['Commercial cloud revenue growing fast from a small base', 'Office 365 subscriber growth', 'Low multiple net of cash versus other software companies'],
    catalysts: ['Quarterly disclosure of commercial cloud run-rate', 'Strategy reset and Nokia write-down under new CEO', 'Office 365 subscriber milestones'],
    valuation: 'Sum-of-the-parts: legacy franchises on a low multiple, plus cloud on a growth-software multiple — well above the price, with the low multiple limiting downside.',
    risks: ['Amazon Web Services’ lead in cloud', 'Subscription transition depressing reported revenue for a while', 'Continued PC decline'],
    whatHappened: 'Cloud became the growth engine, margins expanded and the market re-rated the stock; it more than tripled by 2018 and kept compounding.',
    lessons: ['Low multiples plus a credible new growth engine is a powerful combination.', 'Transitions (license → subscription) temporarily hurt reported numbers — the variant view is looking through them.'],
    concepts: [
      { label: 'Reverse DCF: what the price implied', lesson: 'reverse-dcf' },
      { label: 'Comps and re-rating', lesson: 'comps' },
    ],
  },
  {
    id: 'nflx-2012',
    title: 'Netflix after the Qwikster collapse',
    company: 'Netflix',
    symbol: 'NFLX',
    investor: 'Growth investors; Carl Icahn disclosed a stake in 2012',
    period: '2011–2013',
    direction: 'long',
    outcome: 'worked',
    tagline: 'A self-inflicted wound, not a broken model.',
    setup:
      'In 2011 Netflix raised prices sharply by splitting DVD and streaming plans, then announced (and quickly scrapped) spinning DVDs off as "Qwikster." It lost subscribers for the first time and the stock fell roughly 75–80% from its peak.',
    consensus: 'Customers had turned on the brand, content costs would crush margins, and studios held all the power.',
    variant:
      'Streaming was cheaper to deliver than mailing discs, the subscriber base was still large and growing internationally, and original content (House of Cards, 2013) could give Netflix its own must-have library.',
    evidence: ['Streaming subscribers resumed growth within a few quarters', 'International expansion adding millions of members', 'Low churn among streaming-only members'],
    catalysts: ['Quarterly subscriber reports', 'Launch of original series in 2013', 'Operating leverage as subscriber growth outpaced content spend'],
    valuation: 'Value per subscriber × a credible subscriber path; at the lows the market cap implied little more than the existing base.',
    risks: ['Content cost inflation', 'Studios pulling licenses to launch their own services', 'Negative free cash flow from content spending'],
    whatHappened: 'Subscriber growth resumed, originals landed, and the stock became one of the best performers of the decade — though free cash flow stayed negative for years, making it a controversial holding.',
    lessons: ['Distinguish reversible management mistakes from structural damage.', 'Subscriber economics (lifetime value vs acquisition cost) drive the valuation.'],
    concepts: [
      { label: 'Monte Carlo on a volatile stock', lesson: 'monte-carlo' },
      { label: 'Drawdowns', lesson: 'risk-return' },
    ],
  },
  {
    id: 'lehman-2008',
    title: 'Shorting Lehman Brothers',
    company: 'Lehman Brothers',
    symbol: null,
    investor: 'David Einhorn (Greenlight Capital)',
    period: '2007–2008',
    direction: 'short',
    outcome: 'worked',
    tagline: 'Read the balance sheet the market wasn’t reading.',
    setup:
      'Lehman ran roughly 30× gross leverage with large holdings of commercial real estate and illiquid mortgage assets. In spring 2008 speeches Einhorn questioned how those assets were marked and how the firm explained its results.',
    consensus: 'Lehman had survived crises before; after Bear Stearns was rescued in March 2008, the Fed would backstop big investment banks.',
    variant:
      'Marks on illiquid assets looked too generous, so book value — the thing leverage was measured against — was overstated. With ~30× leverage, a few percent of write-downs would wipe out a large share of equity, and the firm depended on short-term funding.',
    evidence: ['Leverage around 30× assets to equity', 'Large, hard-to-value real estate and mortgage positions', 'Disclosures that shifted between quarters'],
    catalysts: ['Quarterly results with write-downs', 'Capital raises at falling prices', 'Funding stress and counterparty pullback'],
    valuation: 'Price to tangible book, with book adjusted for realistic marks: adjusted book was far below reported book.',
    risks: ['Government rescue or a buyer at a premium', 'Short squeeze in a heavily shorted financial', 'Regulatory short-sale restrictions'],
    whatHappened: 'Lehman raised capital, reported losses and failed to find a buyer; it filed for bankruptcy on 15 September 2008.',
    lessons: ['Leverage turns small asset errors into large equity losses.', 'For financials, value the balance sheet (tangible book, marks), not EV/EBITDA.', 'Hard catalysts (results, capital raises) force the market to confront the numbers.'],
    concepts: [
      { label: 'Why banks aren’t valued on EV', lesson: 'enterprise-value' },
      { label: 'Tail risk', lesson: 'value-at-risk' },
    ],
  },
  {
    id: 'subprime-2005',
    title: 'The Big Short: credit default swaps on subprime bonds',
    company: 'Subprime mortgage-backed securities',
    symbol: null,
    investor: 'Michael Burry (Scion Capital) and others',
    period: '2005–2007',
    direction: 'short',
    outcome: 'worked',
    tagline: 'Asymmetric payoff — and the pain of being early.',
    setup:
      'Burry read the loan-level details of subprime mortgage bonds — adjustable rates, teaser periods, little documentation — and concluded defaults would spike once teaser rates reset. He bought credit default swaps: insurance on bonds he didn’t own.',
    consensus: 'National house prices had never fallen together; the bonds were rated AAA or close to it.',
    variant: 'Resets in 2007 would push payments beyond borrowers’ means, defaults would correlate nationally, and the lower tranches would be wiped out.',
    evidence: ['Loan terms with payment shock on reset', 'Rising early delinquencies in recent vintages', 'Ratings that assumed low correlation across regions'],
    catalysts: ['Teaser-rate resets in 2007', 'Monthly remittance reports showing delinquencies'],
    valuation: 'The payoff was asymmetric: the swaps cost a small annual premium, and paid close to the full notional if the tranche defaulted.',
    risks: ['Paying premiums for years while housing kept rising (negative carry)', 'Investors redeeming before the thesis played out', 'Counterparties marking the swaps unfairly'],
    whatHappened:
      'Housing turned in 2006–07, defaults surged, and the swaps paid off enormously — after a stretch in which Scion’s investors, frustrated by the premiums, tried to pull their money.',
    lessons: ['Structure matters: options-like payoffs let you be early without being ruined.', 'Carry cost and investor patience are real risks — being early can look like being wrong.', 'Read the underlying documents yourself.'],
    concepts: [
      { label: 'Probability-weighted payoffs', lesson: 'stock-pitch' },
      { label: 'Fat tails and correlation', lesson: 'value-at-risk' },
    ],
  },
  {
    id: 'hlf-2012',
    title: 'Herbalife: a famous short that failed',
    company: 'Herbalife',
    symbol: 'HLF',
    investor: 'Bill Ackman (Pershing Square)',
    period: '2012–2018',
    direction: 'short',
    outcome: 'failed',
    tagline: 'Being convinced isn’t the same as getting paid.',
    setup:
      'In December 2012 Ackman presented a long public case that Herbalife was a pyramid scheme, with a short position of about $1 billion and a price target of zero.',
    consensus: 'A profitable nutrition company with a large distributor network and strong cash flow.',
    variant: 'Most distributors lost money and the model relied on recruitment rather than retail sales; regulators would force changes that destroyed the economics.',
    evidence: ['Distributor income data', 'Share of sales to distributors versus end customers', 'Regulatory history of multi-level marketers'],
    catalysts: ['An FTC investigation and ruling', 'Distributor attrition', 'Public pressure campaigns'],
    valuation: 'Target of zero — the thesis was binary on the regulator.',
    risks: ['Regulator finds no pyramid scheme', 'Short squeeze (Carl Icahn built a large long stake in 2013)', 'Company buys back stock, shrinking the float'],
    whatHappened:
      'In 2016 Herbalife settled with the FTC: a fine and required business changes, but no pyramid-scheme finding. The stock rose, and Ackman closed the short in early 2018 at a large loss.',
    lessons: [
      'A short with a binary regulatory catalyst has no control over timing or outcome.',
      'Shorts have unlimited downside and can be squeezed by a well-funded opponent.',
      'A price target of zero rarely gets paid — size shorts for the chance you’re wrong.',
    ],
    concepts: [
      { label: 'Hard vs soft catalysts', lesson: 'stock-pitch' },
      { label: 'Kill criteria', lesson: 'investment-thesis' },
    ],
  },
  {
    id: 'valeant-2015',
    title: 'Valeant: a roll-up that unravelled',
    company: 'Valeant Pharmaceuticals (now Bausch Health)',
    symbol: 'BHC',
    investor: 'Several prominent long funds, including Pershing Square',
    period: '2015–2017',
    direction: 'long',
    outcome: 'failed',
    tagline: 'Debt-funded acquisitions plus price hikes is not organic growth.',
    setup:
      'Valeant grew by buying drug companies with debt, cutting R&D and raising prices on acquired drugs. Its stock had risen many times over and it traded on "cash EPS" that excluded many costs.',
    consensus: 'A capital-allocation machine run by a disciplined dealmaker; cheap on adjusted earnings.',
    variant:
      'Bulls believed the acquisition machine would keep compounding. Skeptics argued organic growth came largely from price increases, adjusted earnings hid real costs, and a specialty pharmacy (Philidor) was propping up sales.',
    evidence: ['Growth mostly acquired, with high leverage', 'Large price increases on older drugs', 'Heavy use of non-GAAP adjustments'],
    catalysts: ['Congressional scrutiny of drug pricing (2015)', 'Short-seller reports on Philidor', 'Debt covenants tested by falling earnings'],
    valuation: 'On adjusted EPS the stock looked cheap; on free cash flow after acquisitions, and with ~$30B of debt, it didn’t.',
    risks: ['Pricing backlash', 'Accounting and disclosure questions', 'Leverage leaving no room for error'],
    whatHappened: 'Pricing scrutiny and the Philidor revelations hit sales, guidance was cut repeatedly, and the stock fell about 90% from its 2015 peak.',
    lessons: [
      'Ask where growth comes from: volume, price, or acquisitions.',
      'Be skeptical of "adjusted" earnings that exclude recurring costs.',
      'Leverage plus a fragile business model amplifies bad news.',
    ],
    concepts: [
      { label: 'Why EBITDA isn’t cash', lesson: 'three-statements' },
      { label: 'Accretion ≠ value creation', lesson: 'm-and-a' },
    ],
  },
];

export const CASE_BY_ID = new Map(CASES.map((item) => [item.id, item]));

/**
 * A complete model pitch on a fictional company, used as the example in Pitch studio and
 * annotated in the stock-pitch lesson. Fictional so the numbers can be internally consistent.
 */
export const MODEL_PITCH: PitchDraft & { company: string } = {
  symbol: 'NWLX',
  company: 'Northwind Logistics (fictional)',
  direction: 'long',
  price: 42,
  target: 58,
  bull: 72,
  bear: 35,
  horizonMonths: 12,
  summary:
    'Long Northwind at $42 with a $58 target (+38%) over 12 months. The market treats it as a cyclical trucker, but 45% of profit now comes from contracted warehouse software that is growing 20% a year.',
  variant:
    'At 7.5× EV/EBITDA the market prices Northwind like its trucking peers (6–8×) and implies ~3% growth. But the software segment is 45% of EBITDA, 90% recurring and growing 20%; software peers trade at 15×+. Consensus models the company as one segment and misses the mix shift.',
  thesis:
    '1. Software is 45% of EBITDA (up from 20% in FY22) and grows 20% a year on multi-year contracts with 95% retention.\n2. Trucking margins have troughed at 4% versus a 7% ten-year average; each point of recovery adds ~$0.30 of EPS.\n3. $400M of free cash flow over two years covers a buyback of ~10% of shares at today’s price, with the rest paying down debt.',
  catalysts:
    '- Q3 earnings (late October): first quarter reporting software as a separate segment.\n- Investor day in March 2027: management has promised software targets.\n- Freight volumes bottoming in H1 2027 per carrier guidance.',
  valuation:
    'Sum-of-the-parts: software $180M EBITDA × 14× = $2.5B; trucking $220M × 6× = $1.3B; less $0.9B net debt = $2.9B equity / 50M shares = $58. Cross-check: DCF at 9% WACC and 2.5% terminal growth gives $55–62. Bull ($72): software re-rates to 18×. Bear ($35): trucking EBITDA falls 25% and software is valued at only 9×.',
  risks:
    '- Freight recession deepens and software de-rates: value falls to ~$35 (bear). Mitigant: software EBITDA alone covers interest 3×.\n- Software growth slows below 12%: re-rating fails. Watch net retention each quarter.\n- Management uses cash for a trucking acquisition instead of buybacks: limit position to 4% until the investor day.',
  disconfirming:
    '- Software growth below 12% for two consecutive quarters.\n- Software net revenue retention falls below 100%.\n- Net debt / EBITDA rises above 3× (acquisition risk realized).',
};

/** Weak vs strong phrasing of the same idea, for the thesis lesson. */
export const THESIS_PAIRS = [
  {
    part: 'Thesis',
    weak: 'Northwind is a great company with strong management and a good market position.',
    strong: 'The market values Northwind as a trucker (7.5× EBITDA), but 45% of EBITDA is recurring software growing 20% — worth 14×+ on its own.',
    why: 'The strong version is specific, contrasts with consensus, and has a number that can be checked.',
  },
  {
    part: 'Catalyst',
    weak: 'The market will eventually recognize the value.',
    strong: 'Q3 earnings in late October are the first to report software as its own segment, making the mix visible.',
    why: 'A dated event with a mechanism, not a hope.',
  },
  {
    part: 'Risk',
    weak: 'The economy could get worse.',
    strong: 'A deeper freight recession plus a software de-rating would cut fair value to ~$35; software EBITDA alone still covers interest 3×.',
    why: 'Company-specific, quantified, and paired with a mitigant.',
  },
  {
    part: 'Kill criterion',
    weak: 'I’ll sell if the story changes.',
    strong: 'Sell if software growth is below 12% for two consecutive quarters.',
    why: 'Measurable and decided in advance, so you can’t rationalize it later.',
  },
];
