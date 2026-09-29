'use client';

import Link from 'next/link';

import { Callout, Formula, Prose, Section } from '@/components/learn/blocks';
import { AccretionLab, BondLab, LboLab } from '@/components/learn/widgets/deals';

export function MergersAndAcquisitions() {
  return (
    <>
      <Section id="why" index={1} title="Why companies buy companies">
        <Prose>
          <p>
            Acquisitions are the core of investment banking’s advisory business. Buyers want growth they can’t build fast enough, a product or technology, customers, market share, or <strong>synergies</strong> — cost savings from combining overlapping operations, or revenue gains from cross-selling. Sometimes the motive is less noble: empire building, or using an expensive stock as currency.
          </p>
          <p>
            Public acquirers are judged on earnings per share, so the first question on every deal is whether it’s <strong>accretive</strong> (raises the buyer’s EPS) or <strong>dilutive</strong>. Goldman Sachs famously ends its analyst training with an M&amp;A case presented to a senior banker — the merger model is that central.
          </p>
        </Prose>
      </Section>

      <Section id="model" index={2} title="The merger model in five steps">
        <Prose>
          <ol>
            <li><strong>Purchase price</strong>: target share price × (1 + premium) × diluted shares. Premiums of 20–40% are typical.</li>
            <li><strong>Financing mix</strong>: cash on hand, new debt, new acquirer shares.</li>
            <li><strong>Cost of each source</strong> (after tax): interest forgone on cash, interest on new debt, and new shares issued (which dilute).</li>
            <li><strong>Combined net income</strong>: acquirer + target − after-tax financing costs + after-tax synergies − new amortization from asset write-ups.</li>
            <li><strong>Pro forma EPS</strong> = combined net income / (acquirer shares + new shares) → compare with standalone EPS.</li>
          </ol>
        </Prose>
        <Formula>Accretion / dilution = Pro forma EPS / Standalone EPS − 1</Formula>
      </Section>

      <Section id="lab" index={3} title="Merge two real companies">
        <Prose>
          <p>Pick any acquirer and target from the universe. Start all-stock and slide the stock share down: when the acquirer’s P/E is below the target’s purchase P/E, stock is expensive currency and debt usually wins. Then find the synergies that break even — that’s the number management has to defend to its board.</p>
        </Prose>
        <AccretionLab />
      </Section>

      <Section id="rules" index={4} title="Rules of thumb and traps">
        <Callout tone="interview" title="Quick accretion test">
          <p>
            Compare the target’s <strong>earnings yield at the purchase price</strong> (1 / purchase P/E) with the <strong>weighted after-tax cost of funds</strong>: cost of stock = acquirer’s earnings yield (1 / its P/E); cost of cash = forgone interest × (1 − t); cost of debt = interest × (1 − t). If the target yields more, the deal is accretive before synergies. For all-stock deals this is the famous rule: <em>buying a lower-P/E company is accretive</em>.
          </p>
        </Callout>
        <Callout tone="pitfall" title="Accretion is not value creation">
          <p>
            A deal can raise EPS and still destroy value — if the price exceeds the target’s standalone value plus the synergies you can actually capture, or if it loads the combined company with risk. Cheap debt makes almost any deal look accretive. The right question is Damodaran’s: is the price paid below value + synergies?
          </p>
        </Callout>
        <Prose>
          <p>
            In real models you’d also add: purchase accounting (writing up assets, new intangibles and their amortization, goodwill), transaction fees, refinancing the target’s debt, phase-in of synergies over two to three years, and credit metrics like debt / EBITDA for the rating agencies.
          </p>
        </Prose>
      </Section>
    </>
  );
}

export function Lbo() {
  return (
    <>
      <Section id="idea" index={1} title="Buying a house with a mortgage">
        <Prose>
          <p>
            In a <strong>leveraged buyout</strong>, a private equity sponsor buys a company using mostly borrowed money — often 50–70% of the price — secured on the company itself. The company’s cash flows then pay the interest and repay the debt. Years later the sponsor sells; whatever the business is worth above the remaining debt belongs to the equity.
          </p>
          <p>
            Like a mortgage, leverage magnifies the result: if the house rises 20% and you put 20% down, your equity doubles. If it falls 20%, your equity is gone.
          </p>
        </Prose>
        <Formula where={[['MOIC', 'multiple of invested capital'], ['n', 'years held']]}>
          MOIC = Exit equity / Equity invested        IRR = MOIC^(1/n) − 1   (no interim distributions)
        </Formula>
      </Section>

      <Section id="lab" index={2} title="LBO lab">
        <Prose>
          <p>
            The lab lays out <strong>sources &amp; uses</strong> (debt and sponsor equity fund the price plus fees), runs a <strong>debt schedule</strong> in which free cash flow repays debt each year, and exits at a multiple of final EBITDA. Seed it from a real company to see what a take-private at a 25% premium would need to work.
          </p>
        </Prose>
        <LboLab />
      </Section>

      <Section id="drivers" index={3} title="Where returns come from">
        <Prose>
          <p>Exit equity = exit multiple × exit EBITDA − remaining debt. So equity value can only grow three ways:</p>
          <ol>
            <li><strong>EBITDA growth</strong> — revenue growth and margin improvement (the “operational value creation” sponsors advertise).</li>
            <li><strong>Multiple expansion</strong> — selling at a higher multiple than you paid. Unreliable; many models assume none.</li>
            <li><strong>Debt paydown</strong> (deleveraging) — each dollar of debt repaid is a dollar more for equity.</li>
          </ol>
          <p>Good candidates have stable cash flows, low capex, a defensible market position and room for operational improvement; a credible exit route matters as much as the entry.</p>
        </Prose>
        <Callout tone="street">
          <p>Higher interest rates since 2022 made debt more expensive and paydown slower, pushing sponsors toward lower leverage, longer holds and more reliance on EBITDA growth.</p>
        </Callout>
      </Section>

      <Section id="paper" index={4} title="The paper LBO">
        <Prose>
          <p>
            PE interviews often include a <strong>paper LBO</strong>: a simple case solved with pen and paper in 10–15 minutes. The structure: purchase price and sources &amp; uses → project EBITDA and cash flow → sum debt paydown → exit equity → MOIC → approximate IRR.
          </p>
        </Prose>
        <Callout tone="interview" title="IRR shortcuts to memorize (5-year hold)">
          <p>1.5× ≈ 8% · 2.0× ≈ 15% · 2.5× ≈ 20% · 3.0× ≈ 25% · 4.0× ≈ 32%. Over 3 years, 2× ≈ 26%. Doubling in n years ≈ 72 / n %.</p>
        </Callout>
        <Callout tone="key">
          <p>Practice randomized paper LBOs in the <Link href="/learn/practice">Practice lab</Link> — each comes with the step-by-step solution.</p>
        </Callout>
      </Section>
    </>
  );
}

export function Bonds() {
  return (
    <>
      <Section id="pricing" index={1} title="A bond is a bundle of cash flows">
        <Prose>
          <p>
            A plain bond pays a fixed coupon every period and its face value at maturity. Its price is simply the present value of those payments, discounted at the market’s required yield. Because the cash flows are fixed, <strong>price and yield move in opposite directions</strong>: when new bonds offer more, old ones must get cheaper.
          </p>
        </Prose>
        <Formula where={[['C', 'coupon per period'], ['F', 'face value'], ['y', 'yield to maturity per period'], ['n', 'periods']]}>Price = Σ C / (1 + y)ᵗ + F / (1 + y)ⁿ</Formula>
        <Prose>
          <p>When the coupon equals the yield, the bond trades at par (100). Coupon above yield → premium; below → discount.</p>
        </Prose>
      </Section>

      <Section id="lab" index={2} title="Price–yield lab">
        <BondLab />
      </Section>

      <Section id="duration" index={3} title="Duration and convexity">
        <Prose>
          <p>
            <strong>Macaulay duration</strong> is the weighted-average time to receive the bond’s cash flows. <strong>Modified duration</strong> converts it into price sensitivity: the percentage price change for a 1-point change in yield. <strong>DV01</strong> is the dollar change for one basis point — how rates desks size their risk.
          </p>
        </Prose>
        <Formula where={[['D_mod', 'modified duration = Macaulay / (1 + y)'], ['C', 'convexity']]}>ΔP / P ≈ −D_mod × Δy + ½ × C × (Δy)²</Formula>
        <Prose>
          <p>
            Longer maturity and lower coupons mean higher duration; a zero-coupon bond’s Macaulay duration equals its maturity. <strong>Convexity</strong> is the curvature: for plain bonds it’s positive, so prices rise more when yields fall than they drop when yields rise.
          </p>
        </Prose>
        <Callout tone="street">
          <p>Duration is also how equity investors think about growth stocks: most of their value is in distant cash flows, so they behave like long-duration bonds when rates move — as 2022 showed.</p>
        </Callout>
      </Section>
    </>
  );
}
