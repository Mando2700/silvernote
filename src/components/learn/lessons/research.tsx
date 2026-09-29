'use client';

import Link from 'next/link';

import { Callout, Formula, Prose, Section } from '@/components/learn/blocks';
import { AnnotatedPitch, CatalystSorter, RiskRewardLab, ThesisCompare } from '@/components/learn/widgets/research';

export function InvestmentThesis() {
  return (
    <>
      <Section id="what" index={1} title="What a thesis is (and isn’t)">
        <Prose>
          <p>
            An investment thesis is a <strong>falsifiable claim about value that the market is mispricing</strong>, with the evidence for it and the conditions under which you’d be wrong. It is not a company description, not a list of things you like about the business, and not a price chart.
          </p>
          <p>
            The heart of it is the <strong>variant perception</strong> — Michael Steinhardt’s term for a well-founded view that differs from the market’s. If your view matches consensus, it’s already in the price and there’s nothing to be paid for. If it differs but you can’t say <em>why</em> the market is wrong, you don’t have an edge — you have a guess.
          </p>
        </Prose>
        <Formula>Thesis = Variant view + Evidence + Catalyst + Valuation + Kill criteria</Formula>
      </Section>

      <Section id="anatomy" index={2} title="Anatomy of a strong thesis">
        <Prose>
          <ul>
            <li><strong>The mispricing in one sentence</strong>: “The market prices X; we believe Y.” Use a reverse DCF to quantify what the market believes.</li>
            <li><strong>Two to four pillars</strong>, each a specific claim with data — revenue mix, unit economics, a margin inflection, a capital-allocation change.</li>
            <li><strong>Value drivers</strong>: the three to five variables that move value most, each measurable every quarter (e.g. net retention, gross margin, same-store sales).</li>
            <li><strong>Catalysts</strong>: why the gap closes, and roughly when.</li>
            <li><strong>Risks and kill criteria</strong>: what would prove you wrong, as thresholds, written <em>before</em> you own it.</li>
          </ul>
        </Prose>
        <Callout tone="street">
          <p>Buy-side analysts keep a one-page thesis per position and update the drivers every quarter. When the facts change, they change the position — or at least know that they are choosing not to.</p>
        </Callout>
      </Section>

      <Section id="compare" index={3} title="Weak vs strong">
        <ThesisCompare />
      </Section>

      <Section id="discipline" index={4} title="Keep it honest">
        <Prose>
          <p>The biggest enemies of a good thesis are psychological:</p>
          <ul>
            <li><strong>Confirmation bias</strong> — reading only what agrees with you. Write the bear case yourself, or ask Grok to argue it.</li>
            <li><strong>Anchoring</strong> — to your purchase price or an old target.</li>
            <li><strong>Thesis creep</strong> — the reasons you own it quietly change to fit the price action. Versioned theses (SilverNote keeps every revision) make that visible.</li>
            <li><strong>Sunk cost</strong> — holding because you’ve done so much work.</li>
          </ul>
        </Prose>
        <Callout tone="key">
          <p>
            Put it into practice: open a company you follow, go to its <Link href="/notes">Workspace</Link>, and fill in thesis, drivers, catalysts, risks and “what would prove me wrong”. Then ask Grok to challenge it — the assistant is built to argue the strongest opposing case and name the signals that would break your view.
          </p>
        </Callout>
      </Section>
    </>
  );
}

export function StockPitch() {
  return (
    <>
      <Section id="structure" index={1} title="The 90-second structure">
        <Prose>
          <p>Hedge-fund interviewers, pitch competitions and PMs all expect the same order. Lead with the answer; a PM decides in the first 30 seconds whether to keep listening.</p>
          <ol>
            <li><strong>Recommendation</strong> — long or short, current price, target, upside and time frame.</li>
            <li><strong>Thesis</strong> — two or three reasons, each with a number.</li>
            <li><strong>Variant view</strong> — what the market believes and why it’s wrong.</li>
            <li><strong>Catalysts</strong> — what closes the gap in the next 6–12 months.</li>
            <li><strong>Valuation</strong> — the method, the math, and bull / base / bear values.</li>
            <li><strong>Risks</strong> — the two or three things that would prove you wrong, and how you’d know.</li>
          </ol>
          <p>Pick pitchable companies: relatively pure-play, with three or four drivers you can model, not sprawling conglomerates with messy segment reporting.</p>
        </Prose>
        <AnnotatedPitch />
      </Section>

      <Section id="catalysts" index={2} title="Hard vs soft catalysts">
        <Prose>
          <p>
            A <strong>hard catalyst</strong> is a dated event with a knowable outcome: earnings, an FDA decision, a shareholder vote, a deal closing, a spin-off, an investor day with promised targets. A <strong>soft catalyst</strong> is a possibility without a date: expansion plans, a sentiment shift, “the market will realize”. Hard catalysts make a thesis testable; for shorts they’re essential, because overvalued stocks can stay overvalued for years.
          </p>
        </Prose>
        <CatalystSorter />
      </Section>

      <Section id="asymmetry" index={3} title="Risk/reward on a real stock">
        <Prose>
          <p>
            A pitch isn’t a single target — it’s a distribution. Give bull, base and bear values with rough probabilities, then show the payoff is <strong>asymmetric</strong>: the upside if right is much bigger than the loss if wrong.
          </p>
        </Prose>
        <Formula>Expected value = p_bull × V_bull + p_base × V_base + p_bear × V_bear        Skew = (V_bull − P) / (P − V_bear)</Formula>
        <RiskRewardLab />
      </Section>

      <Section id="judged" index={4} title="How pitches are judged">
        <Prose>
          <p>University competitions and interviewers score roughly the same things:</p>
          <ul>
            <li><strong>Quality of the idea</strong> (about half): sound logic, a view that differs from consensus, company and industry insight, financial analysis.</li>
            <li><strong>Presentation</strong>: clear structure, concise, backed by exhibits.</li>
            <li><strong>Q&amp;A</strong>: answers that reinforce the thesis, acknowledge risks fairly, and honestly say “I don’t know, here’s how I’d find out”.</li>
          </ul>
        </Prose>
        <Callout tone="pitfall" title="Why pitches get rejected">
          <ul>
            <li>A consensus long — “Apple is a great company” isn’t a pitch.</li>
            <li>No catalyst, or only soft ones.</li>
            <li>A single-point target with no downside case.</li>
            <li>Generic, macro risks instead of company-specific ones.</li>
            <li>An overbuilt model that hides the three assumptions that matter.</li>
          </ul>
        </Callout>
        <Callout tone="key">
          <p>
            Now write one. <Link href="/learn/pitch">Pitch studio</Link> gives you live data on any company, scores your structure as you type, and has Grok grade it like a PM — with the three questions it would ask you.
          </p>
        </Callout>
      </Section>
    </>
  );
}
