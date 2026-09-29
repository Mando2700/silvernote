'use client';

import { Callout, Formula, Prose, Section } from '@/components/learn/blocks';
import { CompsLab, DcfLab, ReverseDcfSolver, WaccBuilder } from '@/components/learn/widgets/valuation';

export function Dcf() {
  return (
    <>
      <Section id="logic" index={1} title="The logic in one line">
        <Prose>
          <p>
            A business is worth the cash it will produce over its life, discounted for time and risk. A <strong>discounted cash flow</strong> model makes that literal: forecast free cash flow for a few years, estimate a value for everything after (the terminal value), and discount both at the return investors require.
          </p>
          <p>Every DCF is five steps — the same five you’ll be asked to “walk me through” in an interview:</p>
          <ol>
            <li>Project <strong>unlevered free cash flow</strong> for 5–10 years.</li>
            <li>Estimate the <strong>discount rate</strong> (WACC).</li>
            <li>Estimate the <strong>terminal value</strong>.</li>
            <li><strong>Discount</strong> everything to today and add it up → enterprise value.</li>
            <li><strong>Bridge</strong> to equity value (subtract net debt and other claims) and divide by diluted shares.</li>
          </ol>
        </Prose>
      </Section>

      <Section id="fcf" index={2} title="Unlevered free cash flow">
        <Formula where={[['EBIT', 'operating income'], ['t', 'tax rate'], ['D&A', 'depreciation & amortization (non-cash)'], ['ΔNWC', 'increase in net working capital']]}>
          UFCF = EBIT × (1 − t) + D&A − Capex − ΔNWC
        </Formula>
        <Prose>
          <p>
            “Unlevered” means before interest: it’s the cash available to <em>all</em> investors, so it’s discounted at WACC and gives enterprise value. The revenue forecast drives everything — growth, then margins, then reinvestment (capex and working capital) as a percentage of revenue. Damodaran’s test: growth must be paid for with reinvestment, so high growth with no capex is a red flag.
          </p>
          <p>
            Stock-based compensation is the modern trap. EBIT already expenses it; if you add it back as a non-cash item, you must also model the dilution. SilverNote’s DCF deducts it by default.
          </p>
        </Prose>
      </Section>

      <Section id="terminal" index={3} title="Terminal value">
        <Prose>
          <p>You can’t forecast forever, so after the explicit period you assume a steady state. Two ways:</p>
        </Prose>
        <Formula where={[['g', 'perpetual growth — at or below long-run nominal GDP, typically 2–3%'], ['n', 'final forecast year']]}>
          Gordon growth:  TV = FCFₙ × (1 + g) / (WACC − g)        Exit multiple:  TV = EBITDAₙ × EV/EBITDA
        </Formula>
        <Prose>
          <p>
            Bankers often lead with an exit multiple because it ties to today’s market; valuation purists prefer perpetuity growth because it doesn’t import today’s possibly inflated multiples. Best practice: compute one and sanity-check the other — the lab below shows the exit multiple implied by your growth assumption.
          </p>
        </Prose>
        <Callout tone="key">
          <p>Terminal value is usually 60–80% of the total. That’s normal — but it means the discount rate and long-run growth matter more than next year’s revenue.</p>
        </Callout>
      </Section>

      <Section id="lab" index={4} title="DCF lab on a real company">
        <Prose>
          <p>
            The lab below builds a five-year DCF from the company’s SEC filings (tax rate, D&amp;A, capex, working capital, stock comp, cash, debt, leases, shares), today’s 10-year Treasury and the stock’s own beta. You control four levers. Try this: set the value equal to today’s price by moving only the margin, then only WACC. Which one did the market more likely change its mind about?
          </p>
        </Prose>
        <DcfLab />
      </Section>

      <Section id="pitfalls" index={5} title="How DCFs go wrong">
        <Callout tone="pitfall" title="Seven classic mistakes">
          <ul>
            <li><strong>Terminal growth above GDP</strong> — nothing grows faster than the economy forever.</li>
            <li><strong>Growth without reinvestment</strong> — revenue compounding at 15% with capex below depreciation.</li>
            <li><strong>Margins that expand forever</strong> — competition caps returns; fade them.</li>
            <li><strong>Mismatched cash flow and rate</strong> — discounting levered FCF at WACC, or nominal cash flows at a real rate.</li>
            <li><strong>Ignoring stock comp and dilution.</strong></li>
            <li><strong>Forgetting leases, minority interest or pensions</strong> in the equity bridge.</li>
            <li><strong>False precision</strong> — a $187.43 target from inputs you can’t know to ±20%. Show a range.</li>
          </ul>
        </Callout>
        <Callout tone="street">
          <p>Sell-side research sets 12-month price targets with a DCF cross-checked against multiples; buy-side analysts use the DCF mainly to understand what drives value and what’s priced in — which is the next lesson.</p>
        </Callout>
      </Section>
    </>
  );
}

export function Wacc() {
  return (
    <>
      <Section id="idea" index={1} title="The opportunity cost of capital">
        <Prose>
          <p>
            The discount rate is not a fudge factor: it’s the return investors could earn elsewhere on investments of similar risk. A company is funded by lenders and shareholders, each demanding a return; the <strong>weighted average cost of capital</strong> blends them at their market-value weights.
          </p>
        </Prose>
        <Formula where={[['E, D', 'market value of equity and debt'], ['Re', 'cost of equity'], ['Rd', 'pre-tax cost of debt'], ['t', 'marginal tax rate']]}>
          WACC = E/(D+E) × Re + D/(D+E) × Rd × (1 − t)
        </Formula>
      </Section>

      <Section id="capm" index={2} title="Cost of equity with CAPM">
        <Formula where={[['Rf', 'risk-free rate — the 10-year Treasury for a US DCF'], ['β', 'sensitivity to the market (next lessons)'], ['ERP', 'equity risk premium: extra return for owning stocks, ~4–6%']]}>
          Re = Rf + β × ERP
        </Formula>
        <Prose>
          <p>
            CAPM says investors are only paid for risk they can’t diversify away — market risk, measured by beta. It’s imperfect (beta is noisy, the ERP is an estimate), but it is the standard. Practitioners smooth beta (e.g. the “Blume adjustment” pulls it toward 1), use industry betas relevered to the company’s capital structure, and sometimes add size or country premiums.
          </p>
        </Prose>
        <Callout tone="interview" title="Private company beta">
          <p>Take comparable public companies’ betas, unlever each: βu = βL / (1 + (1 − t) × D/E); take the median; relever at the target’s D/E. This separates business risk from financial risk.</p>
        </Callout>
      </Section>

      <Section id="debt" index={3} title="Cost of debt and the tax shield">
        <Prose>
          <p>
            The cost of debt is the yield on the company’s bonds (or what similar credits pay). Because interest is tax-deductible, the effective cost is Rd × (1 − t). That tax shield is why modest leverage lowers WACC — until the risk of distress pushes up both the cost of debt and beta, making WACC U-shaped in leverage.
          </p>
        </Prose>
      </Section>

      <Section id="builder" index={4} title="WACC builder with live inputs">
        <Prose>
          <p>Compare a defensive consumer staple (low beta), a chipmaker (high beta) and a heavily indebted telecom. Notice how much equity dominates the blend for most large companies — which is why beta and the ERP matter more than the debt terms.</p>
        </Prose>
        <WaccBuilder />
        <Callout tone="pitfall">
          <p>Using book-value weights, the coupon on old debt instead of today’s yield, or a short-term T-bill as the risk-free rate for long-lived cash flows.</p>
        </Callout>
      </Section>
    </>
  );
}

export function ReverseDcf() {
  return (
    <>
      <Section id="flip" index={1} title="Flip the question">
        <Prose>
          <p>
            A normal DCF asks: <em>given my forecast, what is it worth?</em> The trouble is that your forecast is uncertain and anchored on your hopes. Michael Mauboussin and Alfred Rappaport’s <strong>expectations investing</strong> flips it: start with the one number you know for sure — the price — and solve for the forecast it implies. Then ask whether the company is likely to beat or miss those expectations.
          </p>
          <p>
            This is the most useful habit in stock analysis. It turns vague debates (“it’s expensive”) into specific ones (“the price needs 22% growth for five years; the base rate for a company this size is under 10%”).
          </p>
        </Prose>
        <Callout tone="key">
          <p>Great companies are not automatically great investments. Returns come from <em>revisions to expectations</em>. If the price already assumes greatness, you need something even better to earn more than the cost of capital.</p>
        </Callout>
      </Section>

      <Section id="solver" index={2} title="Solve a real stock">
        <ReverseDcfSolver />
      </Section>

      <Section id="base-rates" index={3} title="Sanity-check with base rates">
        <Prose>
          <p>
            Once you know the implied growth, compare it with <strong>base rates</strong>: how often have companies of this size, in this industry, actually delivered it? Mauboussin’s research shows sustained high growth is rare and fades as companies get bigger — a company with $50B of revenue growing 20% a year for five years is exceptional. Also look at the implied <strong>margin</strong> and the <strong>competitive advantage period</strong> (how long returns stay above the cost of capital).
          </p>
          <p>Then write your variant view in the form: “The market implies X. I believe Y because Z, and I’ll know I’m right when W.”</p>
        </Prose>
        <Callout tone="street">
          <p>Buy-side analysts use reverse DCFs to frame debates with PMs; sell-side analysts use them to explain why a stock “can still work” after a big run.</p>
        </Callout>
      </Section>
    </>
  );
}

export function Comps() {
  return (
    <>
      <Section id="idea" index={1} title="Pricing by analogy">
        <Prose>
          <p>
            Relative valuation prices a company by what the market pays for similar ones — like pricing a house from recent sales on the street. Multiples compress a DCF into one number: a higher EV/EBITDA is the market paying for higher growth, higher returns or lower risk. Bankers spread <strong>trading comps</strong> (public peers) and <strong>precedent transactions</strong> (past acquisitions) for every pitch book.
          </p>
          <ol>
            <li><strong>Pick peers</strong>: same business model, similar growth, margins, size and geography — not just the same sector label.</li>
            <li><strong>Spread the multiples</strong>: EV/Revenue, EV/EBITDA, P/E, P/FCF, on consistent periods (LTM or next fiscal year).</li>
            <li><strong>Take a range</strong> — the 25th to 75th percentile, or a range around the median — rather than a single average that outliers distort.</li>
            <li><strong>Apply</strong> it to your company’s metric and bridge EV to equity value per share.</li>
          </ol>
        </Prose>
        <Formula>Implied price = (peer multiple × your metric − net debt) / diluted shares      (for EV multiples)</Formula>
      </Section>

      <Section id="peers" index={2} title="Live comps table">
        <Prose>
          <p>The table uses SilverNote’s suggested peers and the latest filed financials. Ask of every outlier: is it cheaper because it’s worse (slower, less profitable), or because the market is missing something?</p>
        </Prose>
        <CompsLab />
      </Section>

      <Section id="football" index={3} title="The football field">
        <Prose>
          <p>
            The chart at the bottom of the lab is a <strong>football field</strong> — the page every banker’s valuation section ends with. Each bar is the range of values from one method; the vertical line is the current price (or the offer price in a deal). Where the bars cluster tells you whether the price is supported; where they disagree tells you which assumptions to argue about.
          </p>
        </Prose>
        <Callout tone="interview">
          <p>“Which methodology gives the highest value?” Usually precedent transactions (control premium), then DCF (widest range), then trading comps; an LBO analysis often sets the floor.</p>
        </Callout>
      </Section>

      <Section id="precedents" index={4} title="Precedent transactions">
        <Prose>
          <p>
            Precedents apply the multiples paid in past acquisitions of similar companies. They include a <strong>control premium</strong> (typically 20–40%) and often expected synergies, so they run higher than trading comps. They also age badly: a deal done in a hot 2021 market says little about 2026 financing costs. Use them for M&amp;A fairness opinions and as a ceiling on what a buyer might pay.
          </p>
        </Prose>
        <Callout tone="pitfall">
          <p>Averaging multiples across companies with different growth, mixing LTM and forward periods, ignoring negative-earnings peers (P/E breaks) and forgetting that a “cheap” multiple often reflects a worse business.</p>
        </Callout>
      </Section>
    </>
  );
}
