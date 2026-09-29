'use client';

import { Callout, Formula, Prose, Section } from '@/components/learn/blocks';
import { BetaScatter, CorrelationPlayground, MonteCarloLab, RiskReturnLab, SharpeLab, VarLab } from '@/components/learn/widgets/risk';

export function RiskReturn() {
  return (
    <>
      <Section id="return" index={1} title="Return: arithmetic vs compound">
        <Prose>
          <p>
            There are two “average returns”, and confusing them costs real money. The <strong>arithmetic mean</strong> averages yearly returns; the <strong>geometric mean</strong> (CAGR) is what your account actually compounded at. +50% then −50% averages 0% but leaves you down 25%. The gap between them — <em>volatility drag</em> — grows with volatility.
          </p>
        </Prose>
        <Formula where={[['μ', 'arithmetic mean return'], ['σ', 'volatility']]}>Geometric return ≈ μ − σ² / 2</Formula>
      </Section>

      <Section id="vol" index={2} title="Volatility">
        <Prose>
          <p>
            Volatility is the standard deviation of returns — how widely they swing around their average. Computed on daily returns, it is <strong>annualized by √252</strong> (trading days), because variance, not standard deviation, grows linearly with time. The S&amp;P 500 has historically run at roughly 15–20% a year; single stocks are usually 25–60%.
          </p>
          <p>Volatility is a convenient measure of risk, not the definition of it. It treats upside and downside alike and says nothing about permanent loss — which is why drawdowns matter.</p>
        </Prose>
      </Section>

      <Section id="lab" index={3} title="A real stock against the market">
        <RiskReturnLab />
      </Section>

      <Section id="drawdown" index={4} title="Drawdowns">
        <Prose>
          <p>
            A <strong>drawdown</strong> is the fall from a previous peak; the <strong>maximum drawdown</strong> is the worst one. It’s the number that makes investors sell at the bottom. Losses and recoveries are asymmetric: −20% needs +25% to recover, −50% needs +100%, −80% needs +400%.
          </p>
        </Prose>
        <Callout tone="key">
          <p>Two assets with the same CAGR can feel completely different to own. Before buying a volatile stock, look at its underwater chart and ask honestly whether you would have held through the worst stretch.</p>
        </Callout>
      </Section>
    </>
  );
}

export function SharpeRatio() {
  return (
    <>
      <Section id="definition" index={1} title="Sharpe’s definition">
        <Prose>
          <p>
            William Sharpe introduced the ratio in 1966 as “reward-to-variability”: the <strong>excess return</strong> over a benchmark (usually the risk-free rate) divided by the volatility of that excess return. It answers: how much extra return did I get per unit of risk taken?
          </p>
        </Prose>
        <Formula where={[['Rp', 'portfolio return'], ['Rf', 'risk-free rate'], ['σp', 'volatility of (Rp − Rf)']]}>Sharpe = (Rp − Rf) / σp</Formula>
        <Prose>
          <p>
            Rules of thumb for long-run, annualized figures: the stock market has managed roughly 0.3–0.5; above 1 sustained for years is excellent; above 2 is rare and deserves suspicion. Sharpe recommends measuring on short periods (monthly) and annualizing — multiply the mean by 12 and the standard deviation by √12.
          </p>
        </Prose>
        <Callout tone="key">
          <p>Sharpe doesn’t change with leverage (ignoring borrowing costs): borrowing to double a position doubles both excess return and volatility. So you can pick the highest-Sharpe portfolio and then lever or de-lever it to the risk you want.</p>
        </Callout>
      </Section>

      <Section id="family" index={2} title="The family of ratios">
        <Prose>
          <ul>
            <li><strong>Sortino</strong> = (R − target) / downside deviation — only bad volatility counts.</li>
            <li><strong>Treynor</strong> = (R − Rf) / β — return per unit of market risk; for a component of a diversified portfolio.</li>
            <li><strong>Information ratio</strong> = (R − benchmark) / tracking error — how consistently a manager beats their benchmark.</li>
            <li><strong>Calmar</strong> = annual return / maximum drawdown — return per unit of the worst pain.</li>
            <li><strong>Alpha (Jensen’s)</strong> = R − [Rf + β(Rm − Rf)] — return above what CAPM predicts for that beta.</li>
          </ul>
        </Prose>
      </Section>

      <Section id="lab" index={3} title="Compare real stocks">
        <Prose>
          <p>Add names you own or follow. If you have holdings in SilverNote, your portfolio appears on the chart too — computed from your actual positions.</p>
        </Prose>
        <SharpeLab />
      </Section>

      <Section id="limits" index={4} title="What Sharpe doesn’t see">
        <Callout tone="pitfall" title="Limitations — some from Sharpe himself">
          <ul>
            <li><strong>Correlation blindness</strong>: it says nothing about how an asset fits with the rest of your portfolio. A low-Sharpe asset can improve a portfolio’s Sharpe if it’s uncorrelated.</li>
            <li><strong>Fat tails and skew</strong>: strategies that sell insurance (short volatility) show high Sharpe ratios until a crash.</li>
            <li><strong>Smoothed returns</strong>: illiquid assets marked infrequently (private equity, some hedge funds) look less volatile than they are.</li>
            <li><strong>History ≠ future</strong>: a backward-looking Sharpe is a noisy estimate; three years of data can easily show 1.0 for a strategy whose true value is 0.3.</li>
          </ul>
        </Callout>
      </Section>
    </>
  );
}

export function Diversification() {
  return (
    <>
      <Section id="math" index={1} title="The one formula that matters">
        <Prose>
          <p>
            Harry Markowitz’s insight (1952): a portfolio’s risk depends not just on each asset’s volatility but on how they move <em>together</em>. With two assets:
          </p>
        </Prose>
        <Formula where={[['w', 'weights'], ['σ', 'volatilities'], ['ρ', 'correlation, from −1 to +1']]}>σp² = w₁²σ₁² + w₂²σ₂² + 2·w₁·w₂·ρ·σ₁·σ₂</Formula>
        <Prose>
          <p>
            Unless the correlation is exactly +1, the portfolio is less volatile than the weighted average of its parts — the only “free lunch” in finance. The set of best risk/return mixes is the <strong>efficient frontier</strong>.
          </p>
        </Prose>
      </Section>

      <Section id="frontier" index={2} title="Correlation playground">
        <CorrelationPlayground />
        <Callout tone="street">
          <p>Correlations aren’t stable: in crises they jump toward 1 as everyone sells at once, just when you need diversification most. Stress tests exist for that reason.</p>
        </Callout>
      </Section>

      <Section id="beta" index={3} title="Beta on a real stock">
        <Prose>
          <p>
            <strong>Beta</strong> measures how much a stock moves with the market: the slope of its returns regressed on the market’s. It is correlation × (stock volatility / market volatility). Beta 1.5 means the stock has tended to move 1.5% for each 1% market move. It’s the risk CAPM prices in the cost of equity.
          </p>
        </Prose>
        <BetaScatter />
      </Section>

      <Section id="systematic" index={4} title="Systematic vs idiosyncratic risk">
        <Prose>
          <p>
            Total risk splits into <strong>systematic</strong> (market-wide — recessions, rates) and <strong>idiosyncratic</strong> (company-specific — a failed product, a fraud). R² from the regression is the systematic share. Holding 20–30 stocks across industries removes most idiosyncratic risk; nothing removes market risk except holding less of the market.
          </p>
        </Prose>
        <Callout tone="key">
          <p>That’s why theory says you’re only <em>paid</em> for beta: idiosyncratic risk can be diversified away for free, so the market doesn’t reward bearing it. Stock pickers bear it deliberately — and need a real edge to justify it.</p>
        </Callout>
        <Callout tone="interview">
          <p>“Can beta be negative?” Yes — gold miners or long-volatility strategies sometimes rise when the market falls — but it’s rare for a stock, and low beta doesn’t mean low volatility.</p>
        </Callout>
      </Section>
    </>
  );
}

export function MonteCarlo() {
  return (
    <>
      <Section id="idea" index={1} title="Many futures instead of one">
        <Prose>
          <p>
            A spreadsheet forecast gives one answer (“$10,000 grows to $16,100 at 10% a year”). Reality gives a spread of outcomes. <strong>Monte Carlo simulation</strong> — named after the casino, invented by physicists at Los Alamos — generates thousands of random paths from a model of returns and looks at the distribution: the median outcome, the bad 5%, the probability of losing money or hitting a goal.
          </p>
          <ol>
            <li>Choose a model for one period’s return (resample history, or a lognormal distribution with a mean and volatility).</li>
            <li>Draw a random return for each month; compound; repeat for the horizon → one path.</li>
            <li>Repeat thousands of times.</li>
            <li>Read percentiles and probabilities across paths.</li>
          </ol>
        </Prose>
      </Section>

      <Section id="lab" index={2} title="Simulate a real stock">
        <MonteCarloLab />
        <Callout tone="key">
          <p>Look at the gap between the mean and the median. Compounding creates a long right tail: a few spectacular paths pull the mean up, while the typical investor gets the median. That’s why a single stock can have a high expected return and still leave most holders disappointed.</p>
        </Callout>
      </Section>

      <Section id="methods" index={3} title="Bootstrap vs lognormal">
        <Prose>
          <ul>
            <li><strong>Lognormal / geometric Brownian motion</strong> assumes log returns are normally distributed with constant mean and volatility — clean, and the basis of Black–Scholes, but with thin tails.</li>
            <li><strong>Bootstrap</strong> resamples blocks of actual historical returns, so fat tails, skew and short-term volatility clustering come along. It can only produce outcomes as extreme as the history it samples.</li>
          </ul>
          <p>SilverNote’s portfolio simulator uses 21-day blocks of your portfolio’s own daily returns (bootstrap) or a lognormal model, and can re-center the expected return so that past luck isn’t projected forward.</p>
        </Prose>
      </Section>

      <Section id="limits" index={4} title="Garbage in, garbage out">
        <Callout tone="pitfall">
          <ul>
            <li>The expected return you assume dominates long horizons — a stock’s last ten years are a biased guide to its next ten.</li>
            <li>More simulations reduce sampling noise (error shrinks with 1/√N) but never fix a wrong model.</li>
            <li>Independence between months ignores regimes and crashes that cluster; pair Monte Carlo with historical stress tests.</li>
          </ul>
        </Callout>
        <Callout tone="street">
          <p>Banks use Monte Carlo to price path-dependent derivatives and measure counterparty risk; wealth managers use it for retirement plans (“85% probability your money lasts to age 95”).</p>
        </Callout>
      </Section>
    </>
  );
}

export function ValueAtRisk() {
  return (
    <>
      <Section id="definition" index={1} title="What VaR says">
        <Prose>
          <p>
            <strong>Value at Risk</strong> answers one question: <em>over a given horizon, what loss will be exceeded only X% of the time?</em> A 1-day 95% VaR of $20,000 means that on about one trading day in twenty you should expect to lose at least $20,000. It became the industry standard after J.P. Morgan’s RiskMetrics (1994) and still anchors bank risk reports and trading limits.
          </p>
          <ul>
            <li><strong>Historical VaR</strong>: the 5th percentile of actual past daily returns.</li>
            <li><strong>Parametric VaR</strong>: assume a normal distribution — z × σ × position (z = 1.645 at 95%, 2.326 at 99%).</li>
            <li><strong>Monte Carlo VaR</strong>: the percentile of simulated outcomes.</li>
          </ul>
        </Prose>
        <Formula where={[['z', '1.645 (95%) or 2.326 (99%)'], ['σ', 'daily volatility'], ['h', 'horizon in days — the √h rule assumes independent days']]}>VaR ≈ z × σ × √h × position</Formula>
      </Section>

      <Section id="lab" index={2} title="VaR on a real stock">
        <VarLab />
      </Section>

      <Section id="es" index={3} title="Expected shortfall and fat tails">
        <Prose>
          <p>
            VaR tells you where the tail starts, not how bad it gets. <strong>Expected shortfall</strong> (CVaR) is the average loss beyond VaR — the average of the worst 5% of days. Since the Basel Committee’s market-risk overhaul (FRTB), banks measure trading risk with expected shortfall at 97.5% instead of VaR at 99%.
          </p>
          <p>
            Real returns have <strong>fat tails</strong>: moves beyond three standard deviations happen far more often than a normal distribution predicts (the lab counts them). October 19, 1987 — the S&amp;P fell over 20% in a day — was a 20-plus-sigma event under normal assumptions.
          </p>
        </Prose>
        <Callout tone="pitfall">
          <p>Treating VaR as a maximum loss, estimating it on a calm window, and scaling by √time through a crisis when losses cluster. Pair it with stress tests.</p>
        </Callout>
      </Section>
    </>
  );
}
