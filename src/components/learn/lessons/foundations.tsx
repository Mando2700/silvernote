'use client';

import { Callout, Formula, Prose, Section } from '@/components/learn/blocks';
import { CagrWidget, CompoundingWidget, EvBridgeWidget, NpvIrrWidget, RevenueToFcfWidget, StatementSimulator } from '@/components/learn/widgets/foundations';

export function TimeValueOfMoney() {
  return (
    <>
      <Section id="why" index={1} title="Why money has a time value">
        <Prose>
          <p>
            A dollar today is worth more than a dollar next year for three reasons: you could <strong>invest it</strong> and earn a return in the meantime, <strong>inflation</strong> erodes what a future dollar buys, and a promised future dollar carries <strong>risk</strong> — it might not arrive. The rate that captures all three is the <em>discount rate</em>, and it is the single most important number in finance: every valuation, bond price and project decision is a present-value calculation underneath.
          </p>
          <p>Two operations cover almost everything: <strong>compounding</strong> moves money forward in time, <strong>discounting</strong> moves it back.</p>
        </Prose>
        <Formula where={[['FV', 'future value'], ['PV', 'present value (today)'], ['r', 'rate per period'], ['t', 'number of periods']]}>FV = PV × (1 + r)ᵗ    ⇔    PV = FV / (1 + r)ᵗ</Formula>
      </Section>

      <Section id="compounding" index={2} title="Compounding and discounting">
        <Prose>
          <p>
            Compounding means earning returns on past returns. Over short horizons it looks like simple interest; over decades it dominates. Drag the years to 40 and watch the compound line pull away. Then switch to <em>Discount</em>: the same math, run backwards, shows how little a far-off dollar is worth today — which is why long-dated cash flows (growth stocks, 30-year bonds) are so sensitive to rates.
          </p>
        </Prose>
        <CompoundingWidget />
        <Callout tone="interview" title="Mental math: the Rule of 72">
          <p>Years to double ≈ 72 ÷ rate in %. At 8% money doubles in ~9 years, at 12% in ~6. Private equity people use the inverse: doubling in 5 years ≈ 14–15% a year.</p>
        </Callout>
      </Section>

      <Section id="npv" index={3} title="NPV and IRR">
        <Prose>
          <p>
            <strong>Net present value</strong> is the sum of every cash flow discounted to today, including the upfront cost. A positive NPV means the project earns more than your required return — it creates value. The <strong>internal rate of return</strong> is the discount rate at which NPV is exactly zero: the project’s own yield. Accept when IRR &gt; your hurdle rate (for normal projects this agrees with NPV &gt; 0).
          </p>
        </Prose>
        <Formula where={[['CFₜ', 'cash flow in year t (CF₀ is the negative investment)'], ['IRR', 'the r that sets NPV = 0']]}>NPV = Σ CFₜ / (1 + r)ᵗ        0 = Σ CFₜ / (1 + IRR)ᵗ</Formula>
        <NpvIrrWidget />
        <Callout tone="pitfall">
          <p>
            IRR can mislead: it assumes interim cash is reinvested at the IRR itself, it ignores scale (a 50% IRR on $10 is worth less than 20% on $1M), and projects whose cash flows change sign more than once can have several IRRs. When they disagree, trust NPV.
          </p>
        </Callout>
      </Section>

      <Section id="cagr" index={4} title="CAGR on a real stock">
        <Prose>
          <p>
            The <strong>compound annual growth rate</strong> is the constant yearly rate that turns the starting value into the ending value — the geometric average. It is how analysts quote revenue growth over several years and how funds quote returns. Dividing the total gain by the number of years overstates it, because it ignores compounding.
          </p>
        </Prose>
        <Formula>CAGR = (End / Start)^(1 / years) − 1</Formula>
        <CagrWidget />
      </Section>
    </>
  );
}

export function ThreeStatements() {
  return (
    <>
      <Section id="statements" index={1} title="Three views of one business">
        <Prose>
          <p>Every public company reports three statements. Each answers a different question:</p>
          <ul>
            <li><strong>Income statement</strong> — <em>was it profitable over the period?</em> Revenue minus expenses, down to net income. Built on accrual accounting: revenue when earned, costs when incurred, not when cash moves.</li>
            <li><strong>Balance sheet</strong> — <em>what does it own and owe at a point in time?</em> Assets = liabilities + shareholders’ equity, always.</li>
            <li><strong>Cash flow statement</strong> — <em>where did the cash actually go?</em> Starts from net income, reverses the non-cash items and working-capital timing, then adds investing and financing flows.</li>
          </ul>
          <p>Analysts trust the cash flow statement most because accruals involve judgment (when to recognize revenue, how fast to depreciate) while cash is cash.</p>
        </Prose>
      </Section>

      <Section id="links" index={2} title="Where they connect">
        <Prose>
          <ol>
            <li><strong>Net income</strong> is the first line of the cash flow statement and flows into <strong>retained earnings</strong> on the balance sheet (less dividends).</li>
            <li><strong>Non-cash expenses</strong> (depreciation, amortization, stock comp, impairments) are added back in cash from operations; they reduce the related asset (PP&amp;E, goodwill) or increase equity (stock comp).</li>
            <li><strong>Working capital</strong>: an increase in receivables or inventory uses cash; an increase in payables or deferred revenue provides it.</li>
            <li><strong>Capex</strong> is an investing outflow that increases PP&amp;E; <strong>debt and equity</strong> raised or repaid are financing flows that change those balances.</li>
            <li>The <strong>net change in cash</strong> updates cash on the balance sheet — and the balance sheet balances.</li>
          </ol>
        </Prose>
        <Callout tone="key">
          <p>Profit is an opinion, cash is a fact. Growing companies often report profits while burning cash (receivables and inventory grow first); subscription companies often do the reverse (customers prepay).</p>
        </Callout>
      </Section>

      <Section id="simulator" index={3} title="Transaction simulator">
        <Prose>
          <p>
            This is how interviewers test whether you really understand accounting: “walk me through what happens when…”. Pick an event and read it in order — income statement, then cash flow, then balance sheet — and check that it balances. Say it out loud the same way.
          </p>
        </Prose>
        <StatementSimulator />
        <Callout tone="interview" title="How to answer out loud">
          <p>
            “Operating income falls by $10; at a 25% tax rate net income falls by $7.50. On the cash flow statement net income is down $7.50 but I add back the $10 of non-cash depreciation, so cash is up $2.50. On the balance sheet cash is up $2.50 and PP&amp;E is down $10, so assets fall $7.50; retained earnings fall $7.50, so both sides balance.”
          </p>
        </Callout>
      </Section>

      <Section id="real" index={4} title="Revenue to free cash flow, live">
        <Prose>
          <p>
            The link that matters most for valuation runs from revenue to <strong>unlevered free cash flow</strong> — the cash the operations produce for all investors before any financing. This is the number a DCF discounts. Try a retailer (low margin, low capex), a chipmaker (high margin, heavy capex) and a beverage company (steady, capital-light) and compare how much of each revenue dollar survives.
          </p>
        </Prose>
        <RevenueToFcfWidget />
      </Section>
    </>
  );
}

export function EnterpriseValue() {
  return (
    <>
      <Section id="idea" index={1} title="Buying the house, not just the equity">
        <Prose>
          <p>
            Think of buying a house worth $500k with a $400k mortgage. The owner’s <em>equity</em> is $100k, but to own the house outright you pay $100k to the owner <em>and</em> take on or repay the $400k mortgage. The house is worth $500k regardless of how it’s financed.
          </p>
          <p>
            Companies work the same way. <strong>Equity value</strong> (market capitalization, on diluted shares) is what the shareholders own. <strong>Enterprise value</strong> is the value of the operating business to <em>all</em> capital providers — what an acquirer would effectively pay for the operations, net of the cash it gets.
          </p>
        </Prose>
        <Formula where={[['Debt', 'including leases in most modern analyses'], ['Minority interest', 'the part of consolidated subsidiaries owned by others'], ['Cash', 'plus other non-operating assets such as investments']]}>
          EV = Equity value + Debt + Preferred + Minority interest − Cash
        </Formula>
      </Section>

      <Section id="bridge" index={2} title="The bridge, on a real company">
        <Prose>
          <p>
            Cash-rich companies (big tech) have EVs below their market cap; heavily indebted ones (telecoms, airlines, automakers with finance arms) have EVs far above it. That difference changes how cheap a stock looks: two companies can have the same P/E and very different EV/EBITDA.
          </p>
        </Prose>
        <EvBridgeWidget />
      </Section>

      <Section id="multiples" index={3} title="Which multiple goes with which">
        <Prose>
          <p>Match the numerator to whoever has a claim on the denominator:</p>
          <ul>
            <li><strong>EV multiples</strong> use metrics before interest, which belong to debt and equity holders: EV/Revenue, EV/EBITDA, EV/EBIT, EV/unlevered FCF.</li>
            <li><strong>Equity multiples</strong> use metrics after interest, which belong to shareholders only: P/E (price / EPS), P/B, P/levered FCF, dividend yield.</li>
          </ul>
          <p>EV multiples are capital-structure neutral, so they are the default for comparing companies with different leverage. P/E is still the market’s lingua franca — and the right tool for banks, where debt is operational.</p>
        </Prose>
      </Section>

      <Section id="traps" index={4} title="Interview traps">
        <Callout tone="interview" title="Classic questions">
          <ul>
            <li><strong>A company raises debt and holds the cash</strong> — EV unchanged (debt +, cash +), equity value unchanged.</li>
            <li><strong>It uses cash to buy back stock</strong> — equity value falls, cash falls, EV unchanged.</li>
            <li><strong>It issues new shares for cash</strong> — equity value rises, cash rises, EV unchanged.</li>
            <li><strong>Can EV be negative?</strong> Yes — when cash exceeds market cap plus debt, usually a distressed or cash-burning company.</li>
            <li><strong>Why subtract cash?</strong> It’s non-operating and already in the equity value; a buyer effectively gets it back.</li>
          </ul>
        </Callout>
        <Callout tone="pitfall">
          <p>Using basic instead of diluted shares, forgetting leases or minority interest, or pairing EV with net income. Each one quietly distorts a comps table.</p>
        </Callout>
      </Section>
    </>
  );
}
