'use client';

import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { LineChart, SERIES_COLORS, StackedColumns } from '@/components/charts/svg';
import { Delta } from '@/components/motion/delta';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Select, Skeleton } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/stat-tile';
import { localToday } from '@/lib/dates';
import { api } from '@/lib/client';
import { fixed, money, pct, price, shortDate } from '@/lib/format';

type Kind = 'treasury' | 'agency' | 'corporate' | 'municipal' | 'cd' | 'other';
type Bond = {
  id: string;
  name: string;
  cusip: string | null;
  kind: Kind;
  rating: string | null;
  note: string | null;
  face: number;
  coupon: number;
  frequency: number;
  maturity: string;
  purchaseDate: string;
  purchasePrice: number;
  marketPriceOverride: number | null;
  spreadOverride: number | null;
  dayCount: '30/360' | 'act/act';
  matured: boolean;
  yearsToMaturity: number;
  cleanPrice: number;
  accrued: number;
  priceSource: 'quote' | 'curve' | 'purchase-yield';
  ytm: number | null;
  purchaseYield: number | null;
  treasuryYield: number | null;
  spreadBps: number | null;
  currentYield: number | null;
  marketValue: number;
  costBasis: number;
  unrealized: number;
  annualIncome: number;
  taxTreatment: 'taxable' | 'federal-exempt' | 'state-exempt';
  nextPayment: { date: string; amount: number } | null;
  modifiedDuration: number;
  convexity: number;
  dv01: number;
  shocks: Array<{ bps: number; change: number }>;
};
type BondBook = {
  bonds: Bond[];
  curve: { date: string | null; points: Array<{ years: number; rate: number }> } | null;
  summary: {
    marketValue: number;
    face: number;
    costBasis: number;
    unrealized: number;
    accrued: number;
    annualIncome: number;
    taxExemptIncome: number;
    ytm: number | null;
    modifiedDuration: number | null;
    convexity: number | null;
    yearsToMaturity: number | null;
    dv01: number;
    shocks: Array<{ bps: number; change: number }>;
    matured: number;
  };
  cashFlows: Array<{ year: number; coupon: number; principal: number }>;
  ladder: Array<{ label: string; value: number; weight: number }>;
};

const KIND_LABEL: Record<Kind, string> = { treasury: 'Treasury', agency: 'Agency', corporate: 'Corporate', municipal: 'Municipal', cd: 'CD', other: 'Other' };
const TAX_LABEL: Record<Bond['taxTreatment'], string> = { taxable: 'Taxable', 'federal-exempt': 'Federal tax-exempt', 'state-exempt': 'State tax-exempt' };
const SOURCE_LABEL: Record<Bond['priceSource'], string> = {
  quote: 'Your quoted price',
  curve: 'Treasury curve + spread at purchase',
  'purchase-yield': 'Held at the purchase yield (curve unavailable)',
};

function tenorLabel(years: number) {
  return years < 1 ? `${Math.round(years * 12)}M` : `${years}Y`;
}

type FormState = {
  name: string;
  cusip: string;
  kind: Kind;
  face: string;
  coupon: string;
  frequency: string;
  maturity: string;
  purchase_date: string;
  purchase_price: string;
  market_price: string;
  spread_bps: string;
  rating: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  cusip: '',
  kind: 'treasury',
  face: '10000',
  coupon: '',
  frequency: '2',
  maturity: '',
  purchase_date: localToday(),
  purchase_price: '100',
  market_price: '',
  spread_bps: '',
  rating: '',
};

function toForm(bond: Bond): FormState {
  return {
    name: bond.name,
    cusip: bond.cusip ?? '',
    kind: bond.kind,
    face: String(bond.face),
    coupon: String(bond.coupon),
    frequency: String(bond.frequency),
    maturity: bond.maturity,
    purchase_date: bond.purchaseDate,
    purchase_price: String(bond.purchasePrice),
    market_price: bond.marketPriceOverride !== null ? String(bond.marketPriceOverride) : '',
    spread_bps: bond.spreadOverride !== null ? String(bond.spreadOverride) : '',
    rating: bond.rating ?? '',
  };
}

function BondForm({ form, setForm }: { form: FormState; setForm: (form: FormState) => void }) {
  const set = (key: keyof FormState) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Field label="Name">
          <Input autoFocus value={form.name} onChange={set('name')} placeholder="e.g. US Treasury 4.25% 2034, Apple 3.35% 2032" />
        </Field>
        <Field label="Type">
          <Select value={form.kind} onChange={set('kind')}>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Face value">
          <Input inputMode="decimal" value={form.face} onChange={set('face')} />
        </Field>
        <Field label="Coupon (% a year)" hint="0 for bills and zero-coupon">
          <Input inputMode="decimal" value={form.coupon} onChange={set('coupon')} placeholder="4.25" />
        </Field>
        <Field label="Payments">
          <Select value={form.frequency} onChange={set('frequency')}>
            <option value="2">Semiannual</option>
            <option value="1">Annual</option>
            <option value="4">Quarterly</option>
            <option value="12">Monthly</option>
            <option value="0">Zero-coupon</option>
          </Select>
        </Field>
        <Field label="Maturity">
          <Input type="date" value={form.maturity} onChange={set('maturity')} />
        </Field>
        <Field label="Bought on">
          <Input type="date" value={form.purchase_date} max={localToday()} onChange={set('purchase_date')} />
        </Field>
        <Field label="Price paid" hint="Clean, per 100 of face">
          <Input inputMode="decimal" value={form.purchase_price} onChange={set('purchase_price')} />
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="CUSIP">
          <Input value={form.cusip} onChange={set('cusip')} placeholder="Optional" maxLength={9} />
        </Field>
        <Field label="Rating">
          <Input value={form.rating} onChange={set('rating')} placeholder="AA+" maxLength={10} />
        </Field>
        <Field label="Current price" hint="Overrides the model">
          <Input inputMode="decimal" value={form.market_price} onChange={set('market_price')} placeholder="Model" />
        </Field>
        <Field label="Spread (bp)" hint="Over Treasuries">
          <Input inputMode="decimal" value={form.spread_bps} onChange={set('spread_bps')} placeholder="Implied" />
        </Field>
      </div>
      <p className="text-[11.5px] text-muted">
        Without a current price, SilverNote values the bond on today’s Treasury curve (FRED) plus the spread it had when you bought it, so it moves with rates.
      </p>
    </div>
  );
}

function parseForm(form: FormState) {
  const number = (value: string) => (value.trim() === '' ? null : Number(value));
  return {
    name: form.name.trim(),
    cusip: form.cusip.trim() || null,
    kind: form.kind,
    face: Number(form.face),
    coupon: Number(form.coupon || 0),
    frequency: Number(form.coupon && Number(form.coupon) > 0 ? form.frequency : 0),
    maturity: form.maturity,
    purchase_date: form.purchase_date,
    purchase_price: Number(form.purchase_price),
    market_price: number(form.market_price),
    spread_bps: number(form.spread_bps),
    rating: form.rating.trim() || null,
  };
}

export function BondsPanel({ portfolioId, onChanged }: { portfolioId: string; onChanged: () => void }) {
  const { data, isLoading, mutate } = useSWR<BondBook>(`/api/portfolios/${portfolioId}/bonds`);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = parseForm(editing.form);
      if (editing.id) await api(`/api/portfolios/${portfolioId}/bonds?bond=${editing.id}`, { method: 'PATCH', body: payload });
      else await api(`/api/portfolios/${portfolioId}/bonds`, { body: payload });
      toast.success(editing.id ? 'Bond updated' : `Added ${payload.name}`);
      setEditing(null);
      await mutate();
      onChanged();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (bond: Bond) => {
    if (!window.confirm(`Remove ${bond.name}?`)) return;
    try {
      await api(`/api/portfolios/${portfolioId}/bonds?bond=${bond.id}`, { method: 'DELETE' });
      await mutate();
      onChanged();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const modal = (
    <Modal
      open={Boolean(editing)}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Edit bond' : 'Add a bond'}
      description="Individual Treasuries, agencies, corporates, municipals and CDs. Bond funds and ETFs (AGG, TLT, BND) go in as regular trades."
      footer={
        <Button variant="primary" loading={saving} onClick={() => void save()}>
          {editing?.id ? 'Save' : 'Add bond'}
        </Button>
      }
    >
      {editing ? <BondForm form={editing.form} setForm={(form) => setEditing({ ...editing, form })} /> : null}
    </Modal>
  );

  if (isLoading && !data) return <Skeleton className="h-72" />;
  if (!data?.bonds.length) {
    return (
      <Panel>
        <EmptyState
          icon={<Landmark className="size-4" />}
          title="No bonds yet"
          body="Add individual bonds to see yield to maturity, duration, rate sensitivity, your income calendar and a maturity ladder. They count toward the portfolio total."
          action={
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ id: null, form: EMPTY_FORM })}>
              Add a bond
            </Button>
          }
        />
        {modal}
      </Panel>
    );
  }

  const { summary } = data;
  const curvePoints = data.curve?.points ?? [];
  const flows = data.cashFlows.slice(0, 15);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <StatTile label="Market value" value={money(summary.marketValue, { digits: 0 })} sub={<span className="text-muted">Face {money(summary.face, { digits: 0 })} · accrued {money(summary.accrued, { digits: 0 })}</span>} />
        <StatTile label="Unrealized" value={<Delta value={summary.unrealized} kind="money" digits={0} className="text-[17px]" />} sub={<span className="text-muted">Clean price vs. price paid</span>} />
        <StatTile label="Yield to maturity" value={pct(summary.ytm, 2)} sub={<span className="text-muted">Value-weighted</span>} hint="Return if held to maturity with coupons reinvested at the same yield" />
        <StatTile label="Modified duration" value={fixed(summary.modifiedDuration, 2)} sub={<span className="text-muted">Avg maturity {fixed(summary.yearsToMaturity, 1)}y</span>} hint="% price change for a 1-point change in yields" />
        <StatTile label="DV01" value={money(summary.dv01, { digits: 0 })} sub={<span className="text-muted">per 1 bp move</span>} hint="Dollar change in value when yields move one basis point" />
        <StatTile
          label="Annual income"
          value={money(summary.annualIncome, { digits: 0 })}
          sub={<span className="text-muted">{summary.taxExemptIncome ? `${money(summary.taxExemptIncome, { digits: 0 })} federal tax-free` : `${pct(summary.marketValue ? summary.annualIncome / summary.marketValue : null, 2)} current yield`}</span>}
        />
      </div>

      <Panel>
        <PanelHeader
          kicker={`${data.bonds.length} bond${data.bonds.length === 1 ? '' : 's'}${summary.matured ? ` · ${summary.matured} matured` : ''}`}
          title="Bond holdings"
          actions={
            <Button variant="outline" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ id: null, form: EMPTY_FORM })}>
              Add bond
            </Button>
          }
        />
        {summary.matured ? (
          <div className="mx-4 mb-3 rounded-sm border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-ink-2">
            {summary.matured === 1 ? 'One bond has' : `${summary.matured} bonds have`} matured. Their face value still counts toward the portfolio total as repaid principal: add it to cash and remove the bond so it isn’t counted twice.
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[12.5px]">
            <thead>
              <tr className="border-y border-line bg-surface-1 text-right text-[11px] text-muted">
                <th className="px-4 py-2 text-left font-medium">Bond</th>
                <th className="px-3 py-2 font-medium">Face</th>
                <th className="px-3 py-2 font-medium">Coupon</th>
                <th className="px-3 py-2 font-medium">Maturity</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">YTM</th>
                <th className="px-3 py-2 font-medium">Spread</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Unrealized</th>
                <th className="px-3 py-2 font-medium">Next payment</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.bonds.map((bond) => (
                <tr key={bond.id} className="group border-b border-line text-right">
                  <td className="px-4 py-2 text-left">
                    <div className="font-medium text-ink">{bond.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <Badge tone="outline">{KIND_LABEL[bond.kind]}</Badge>
                      {bond.rating ? <span>{bond.rating}</span> : null}
                      {bond.cusip ? <span className="font-mono">{bond.cusip}</span> : null}
                      <span>{TAX_LABEL[bond.taxTreatment]}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-2 text-ink-2">{money(bond.face, { digits: 0 })}</td>
                  <td className="num px-3 py-2 text-ink-2">{bond.coupon ? `${fixed(bond.coupon, 3).replace(/0+$/, '').replace(/\.$/, '')}%` : 'Zero'}</td>
                  <td className="num px-3 py-2 text-ink-2">
                    {shortDate(bond.maturity)}
                    <div className="text-[10.5px] text-faint">{bond.matured ? 'Matured' : `${fixed(bond.yearsToMaturity, 1)}y`}</div>
                  </td>
                  <td className="num px-3 py-2 text-ink" title={SOURCE_LABEL[bond.priceSource]}>
                    {price(bond.cleanPrice)}
                    <div className="text-[10.5px] text-faint">{bond.priceSource === 'quote' ? 'quoted' : bond.priceSource === 'curve' ? 'model' : 'at cost yield'}</div>
                  </td>
                  <td className="num px-3 py-2 text-ink">{pct(bond.ytm, 2)}</td>
                  <td className="num px-3 py-2 text-ink-2">{bond.spreadBps !== null ? `${Math.round(bond.spreadBps)} bp` : '—'}</td>
                  <td className="num px-3 py-2 text-ink-2">{fixed(bond.modifiedDuration, 2)}</td>
                  <td className="num px-3 py-2 text-ink">{money(bond.marketValue, { digits: 0 })}</td>
                  <td className="px-3 py-2">
                    <Delta value={bond.unrealized} kind="money" digits={0} className="justify-end text-[12px]" />
                  </td>
                  <td className="num px-3 py-2 text-ink-2">
                    {bond.nextPayment ? (
                      <>
                        {money(bond.nextPayment.amount, { digits: 0 })}
                        <div className="text-[10.5px] text-faint">{shortDate(bond.nextPayment.date)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                      <button onClick={() => setEditing({ id: bond.id, form: toForm(bond) })} className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink" aria-label={`Edit ${bond.name}`}>
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => void remove(bond)} className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink" aria-label={`Remove ${bond.name}`}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader kicker="Coupons and principal you will receive" title="Income calendar" />
          <div className="px-4 pb-4">
            <StackedColumns
              categories={flows.map((flow) => String(flow.year))}
              segments={[
                { label: 'Coupons', values: flows.map((flow) => flow.coupon), color: SERIES_COLORS[0] },
                { label: 'Principal', values: flows.map((flow) => flow.principal), color: SERIES_COLORS[1] },
              ]}
              format={(value) => money(value, { compact: true })}
              height={220}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHeader kicker="Share of bond value by years to maturity" title="Maturity ladder" />
          <div className="flex flex-col gap-2 px-4 pb-4">
            {data.ladder.map((bucket, index) => (
              <div key={bucket.label} className="grid grid-cols-[60px_1fr_90px] items-center gap-3">
                <span className="text-[12px] text-ink-2">{bucket.label}</span>
                <div className="h-2.5 rounded-r-[4px] bg-white/[0.04]">
                  <motion.div
                    className="h-full rounded-r-[4px] bg-brand"
                    style={{ opacity: 0.45 + bucket.weight * 0.55 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${bucket.weight * 100}%` }}
                    transition={{ duration: 0.8, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <span className="num text-right text-[11.5px] text-ink">
                  {pct(bucket.weight, 0)} <span className="text-muted">{money(bucket.value, { compact: true })}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader kicker="Instant parallel move in yields · full repricing" title="Rate shocks" />
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-y border-line bg-surface-1 text-right text-[11px] text-muted">
                  <th className="px-4 py-2 text-left font-medium">Bond</th>
                  {summary.shocks.map((shock) => (
                    <th key={shock.bps} className="px-3 py-2 font-medium">
                      {shock.bps > 0 ? '+' : '−'}
                      {Math.abs(shock.bps)} bp
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.bonds
                  .filter((bond) => !bond.matured)
                  .map((bond) => (
                    <tr key={bond.id} className="border-b border-line text-right">
                      <td className="max-w-48 truncate px-4 py-2 text-left text-ink-2">{bond.name}</td>
                      {bond.shocks.map((shock) => (
                        <td key={shock.bps} className="px-3 py-2">
                          <Delta value={shock.change} kind="money" digits={0} className="justify-end text-[12px]" />
                        </td>
                      ))}
                    </tr>
                  ))}
                <tr className="text-right font-medium">
                  <td className="px-4 py-2 text-left text-ink">All bonds</td>
                  {summary.shocks.map((shock) => (
                    <td key={shock.bps} className="px-3 py-2">
                      <Delta value={shock.change} kind="money" digits={0} className="justify-end text-[12.5px]" />
                      <div className="num text-[10.5px] text-muted">{pct(summary.marketValue ? shock.change / summary.marketValue : null, 1)}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <PanelHeader kicker={data.curve?.date ? `FRED constant-maturity yields · ${shortDate(data.curve.date)}` : 'FRED constant-maturity yields'} title="Treasury curve" />
          <div className="px-4 pb-4">
            {curvePoints.length ? (
              <LineChart
                categories={curvePoints.map((point) => tenorLabel(point.years))}
                series={[{ label: 'Yield', values: curvePoints.map((point) => point.rate * 100), color: '#cdd4de', emphasis: true }]}
                format={(value) => `${value.toFixed(2)}%`}
                height={200}
                endLabels={false}
              />
            ) : (
              <p className="text-[12.5px] text-muted">The Treasury curve could not be loaded, so bonds are held at the yield you bought them at.</p>
            )}
          </div>
        </Panel>
      </div>
      {modal}
    </div>
  );
}
