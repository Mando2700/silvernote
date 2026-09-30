'use client';

import { Fragment, type ReactNode } from 'react';

import { download, logoDataUrl, toBlocks, type Block, type Run } from '@/components/pitch/exporters';
import { compactNumber, multiple, pct } from '@/lib/format';
import { THESIS_SECTION_META, type ThesisSection } from '@/lib/schemas';

/**
 * The thesis as a client-ready research note: a photo cover, a key-data table, the thesis sections,
 * filed financials and captioned figures. No app branding anywhere, including the file metadata.
 */

export type ThesisImage = { id: string; caption: string; credit: string | null; license: string | null; sourceUrl: string; width: number; height: number };

export type ThesisExportInput = {
  symbol: string;
  name: string;
  preparedBy: string;
  stance: string;
  conviction: number | null;
  targetPrice: number | null;
  horizon: string | null;
  sections: Array<{ section: ThesisSection; content: string }>;
  profile: {
    description: string | null;
    exchange: string | null;
    country: string | null;
    website: string | null;
    ceo: string | null;
    employees: number | null;
    high52: number | null;
    low52: number | null;
    forwardPE: number | null;
    dividendYield: number | null;
  } | null;
  facts: {
    sector: string | null;
    industry: string | null;
    price: number | null;
    marketCap: number | null;
    currency: string;
    annual: Array<{ label: string; revenue: number | null; netIncome: number | null; freeCashFlow: number | null; operatingMargin: number | null }>;
    multiples: { pe: number | null; ps: number | null; evEbitda: number | null; fcfYield: number | null } | null;
  } | null;
  headquarters: { address: string | null; city: string | null } | null;
  /** In order: the first is the cover, the rest become numbered figures. */
  images: ThesisImage[];
  includeOverview: boolean;
  includeFinancials: boolean;
};

/** Section order and titles in the house style of a sell-side note. */
const SECTION_ORDER: Array<{ section: ThesisSection; title: string }> = [
  { section: 'thesis', title: 'Investment Thesis' },
  { section: 'drivers', title: 'Key Drivers' },
  { section: 'catalysts', title: 'Catalysts' },
  { section: 'valuation', title: 'Valuation' },
  { section: 'risks', title: 'Key Risks' },
  { section: 'disconfirming', title: 'What Would Change Our View' },
];

const STANCE_LABEL: Record<string, string> = { long: 'Long', short: 'Short', watch: 'Watch', avoid: 'Avoid' };

async function dataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const usd = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function money(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value < 0 ? '-' : ''}${currency === 'USD' ? '$' : `${currency} `}${compactNumber(Math.abs(value), 1)}`;
}

/** The first few sentences of a long description, cut on a sentence boundary. */
function trimDescription(text: string, max = 1100) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

function credit(image: ThesisImage) {
  return [image.credit, image.license].filter(Boolean).join(' / ') + ', via Wikimedia Commons';
}

export async function exportThesisPdf(input: ThesisExportInput) {
  const [logo, ...images] = await Promise.all([logoDataUrl(input.symbol), ...input.images.map((image) => dataUrl(`/api/company/${encodeURIComponent(input.symbol)}/media/${image.id}`))]);
  const loaded = input.images.flatMap((image, index) => (images[index] ? [{ ...image, src: images[index] }] : []));
  const blob = await buildThesisPdf(input, logo, loaded);
  download(blob, `${input.symbol}-investment-thesis-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function buildThesisPdf(input: ThesisExportInput, logo: string | null, images: Array<ThesisImage & { src: string }>): Promise<Blob> {
  const { Document, Page, Text, View, Image, StyleSheet, Font, pdf } = await import('@react-pdf/renderer');
  // Research notes set ragged-right text without hyphenation.
  Font.registerHyphenationCallback((word) => [word]);

  const NAVY = '#0c2340';
  const ACCENT = '#1f4e8c';
  const INK = '#1b1f24';
  const BODY = '#2e343c';
  const MUTED = '#667085';
  const RULE = '#d7dce3';
  const WASH = '#f3f5f8';
  const UP = '#127a46';
  const DOWN = '#b42318';

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 54;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const styles = StyleSheet.create({
    cover: { fontFamily: 'Helvetica', color: INK, backgroundColor: '#ffffff' },
    heroImage: { width: PAGE_W, height: 420, objectFit: 'cover' },
    heroPlain: { width: PAGE_W, height: 300, backgroundColor: NAVY, paddingHorizontal: MARGIN, paddingBottom: 36, justifyContent: 'flex-end' },
    heroRule: { height: 5, backgroundColor: NAVY },
    heroCredit: { fontSize: 6.5, color: MUTED, textAlign: 'right', paddingHorizontal: MARGIN, marginTop: 5 },
    coverBody: { paddingHorizontal: MARGIN, paddingTop: 26, flexGrow: 1 },
    kickerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kicker: { fontSize: 8.5, letterSpacing: 2.2, color: ACCENT, fontFamily: 'Helvetica-Bold' },
    kickerDate: { fontSize: 8.5, color: MUTED },
    nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
    logo: { width: 44, height: 44, borderRadius: 7, marginRight: 14, borderWidth: 0.75, borderColor: RULE },
    name: { fontSize: 27, fontFamily: 'Helvetica-Bold', color: INK, lineHeight: 1.15 },
    nameOnDark: { fontSize: 30, fontFamily: 'Helvetica-Bold', color: '#ffffff', lineHeight: 1.15 },
    subline: { fontSize: 10, color: MUTED, marginTop: 4 },
    sublineOnDark: { fontSize: 10.5, color: '#b8c4d6', marginTop: 6 },
    ratingStrip: { flexDirection: 'row', marginTop: 24, borderTopWidth: 1.5, borderTopColor: NAVY, borderBottomWidth: 0.75, borderBottomColor: RULE },
    ratingCell: { flex: 1, paddingVertical: 10, paddingRight: 8 },
    ratingLabel: { fontSize: 7, letterSpacing: 1.2, color: MUTED, textTransform: 'uppercase' },
    ratingValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 4 },
    ratingSub: { fontSize: 7.5, color: MUTED, marginTop: 2 },
    summaryTitle: { fontSize: 7.5, letterSpacing: 1.6, color: NAVY, fontFamily: 'Helvetica-Bold', marginTop: 20, marginBottom: 5 },
    summary: { fontSize: 10, color: BODY, lineHeight: 1.6 },
    coverFoot: { position: 'absolute', left: MARGIN, right: MARGIN, bottom: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: MUTED, borderTopWidth: 0.75, borderTopColor: RULE, paddingTop: 8 },

    page: { paddingTop: 70, paddingBottom: 62, paddingHorizontal: MARGIN, fontFamily: 'Helvetica', fontSize: 9.8, color: BODY, lineHeight: 1.55 },
    header: { position: 'absolute', top: 28, left: MARGIN, right: MARGIN, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 7, borderBottomWidth: 0.75, borderBottomColor: RULE },
    headerLeft: { flexDirection: 'row', alignItems: 'center' },
    headerLogo: { width: 14, height: 14, borderRadius: 3, marginRight: 6 },
    headerTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: INK },
    headerRight: { fontSize: 8, color: MUTED },
    // Anchored from the top: react-pdf drops bottom-anchored fixed elements that contain render-prop text.
    footer: { position: 'absolute', top: PAGE_H - 36, left: MARGIN, right: MARGIN, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: MUTED },

    keyBox: { backgroundColor: WASH, borderTopWidth: 1.5, borderTopColor: NAVY, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, marginBottom: 20 },
    keyTitle: { fontSize: 8, letterSpacing: 1.6, color: NAVY, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
    keyColumns: { flexDirection: 'row' },
    keyColumn: { flex: 1 },
    keyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3.2, borderBottomWidth: 0.5, borderBottomColor: RULE },
    keyLabel: { fontSize: 8.3, color: MUTED },
    keyValue: { fontSize: 8.3, color: INK, fontFamily: 'Helvetica-Bold', textAlign: 'right', maxWidth: 150 },
    keyNote: { fontSize: 6.8, color: MUTED, marginTop: 6 },

    sectionGap: { height: 12 },
    sectionBar: { width: 22, height: 2.5, backgroundColor: ACCENT, marginBottom: 6 },
    sectionTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 8 },
    heading: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 6, marginBottom: 3 },
    paragraph: { marginBottom: 7 },
    bulletRow: { flexDirection: 'row', marginBottom: 3.5 },
    bullet: { width: 12, color: ACCENT, fontFamily: 'Helvetica-Bold' },
    quote: { borderLeftWidth: 2, borderLeftColor: ACCENT, paddingLeft: 10, color: MUTED, marginBottom: 7 },
    table: { marginVertical: 6, borderTopWidth: 1, borderTopColor: NAVY, borderBottomWidth: 1, borderBottomColor: NAVY },
    trHead: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: RULE },
    tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e8ebf0' },
    th: { flex: 1, paddingVertical: 4.5, paddingHorizontal: 5, fontSize: 7.8, color: MUTED, fontFamily: 'Helvetica-Bold' },
    td: { flex: 1, paddingVertical: 4.5, paddingHorizontal: 5, fontSize: 8.6, color: INK },

    figure: { marginTop: 4, marginBottom: 18 },
    figureCaption: { fontSize: 8, color: INK, marginTop: 5, lineHeight: 1.4 },
    figureCredit: { fontSize: 6.8, color: MUTED, marginTop: 1.5 },

    chart: { flexDirection: 'row', alignItems: 'flex-end', height: 110, marginTop: 4, marginBottom: 4, borderBottomWidth: 0.75, borderBottomColor: RULE },
    chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 110, paddingHorizontal: 10 },
    chartValue: { fontSize: 7.2, color: INK, marginBottom: 3 },
    chartBar: { width: '100%', backgroundColor: ACCENT },
    chartLabels: { flexDirection: 'row', marginBottom: 10 },
    chartLabel: { flex: 1, textAlign: 'center', fontSize: 7.2, color: MUTED, marginTop: 3 },

    disclosureTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 4, letterSpacing: 1 },
    disclosure: { fontSize: 7, color: MUTED, lineHeight: 1.45, marginBottom: 4 },
  });

  const RunsText = ({ runs }: { runs: Run[] }) => (
    <Text>
      {runs.map((run, index) => (
        <Text key={index} style={{ fontFamily: run.bold ? (run.italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : run.italic ? 'Helvetica-Oblique' : 'Helvetica' }}>
          {run.text}
        </Text>
      ))}
    </Text>
  );

  const BlockView = ({ block }: { block: Block }) => {
    switch (block.type) {
      case 'heading':
        return <Text style={styles.heading}>{block.text}</Text>;
      case 'paragraph':
        return (
          <View style={styles.paragraph}>
            <RunsText runs={block.runs} />
          </View>
        );
      case 'quote':
        return (
          <View style={styles.quote}>
            <RunsText runs={block.runs} />
          </View>
        );
      case 'list':
        return (
          <View style={{ marginBottom: 6 }}>
            {block.items.map((item, index) => (
              <View key={index} style={styles.bulletRow} wrap={false}>
                <Text style={styles.bullet}>{block.ordered ? `${index + 1}.` : '•'}</Text>
                <View style={{ flex: 1 }}>
                  <RunsText runs={item} />
                </View>
              </View>
            ))}
          </View>
        );
      case 'table':
        return <Table header={block.header} rows={block.rows} />;
      default:
        return null;
    }
  };

  const Table = ({ header, rows, firstWidth }: { header: string[]; rows: string[][]; firstWidth?: number }) => (
    <View style={styles.table} wrap={false}>
      <View style={styles.trHead}>
        {header.map((cell, index) => (
          <Text key={index} style={[styles.th, index > 0 ? { textAlign: 'right' } : firstWidth ? { flexGrow: 0, flexShrink: 0, flexBasis: firstWidth } : {}]}>
            {cell}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.tr}>
          {row.map((cell, index) => (
            <Text key={index} style={[styles.td, index > 0 ? { textAlign: 'right' } : firstWidth ? { flexGrow: 0, flexShrink: 0, flexBasis: firstWidth, color: MUTED } : { color: MUTED }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );

  const Figure = ({ image, number }: { image: ThesisImage & { src: string }; number: number }) => {
    const height = Math.min(CONTENT_W * (image.height / Math.max(1, image.width)), 220);
    return (
      <View style={styles.figure} wrap={false}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image src={image.src} style={{ width: CONTENT_W, height, objectFit: 'cover' }} />
        <Text style={styles.figureCaption}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Figure {number}: </Text>
          {image.caption}
        </Text>
        <Text style={styles.figureCredit}>Source: {credit(image)}</Text>
      </View>
    );
  };

  const SectionHead = ({ title }: { title: string }) => (
    <View wrap={false} minPresenceAhead={48}>
      <View style={styles.sectionBar} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );

  const { profile, facts } = input;
  const price = facts?.price ?? null;
  const upside = input.targetPrice && price ? input.targetPrice / price - 1 : null;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const stance = STANCE_LABEL[input.stance] ?? 'Watch';
  const stanceColor = input.stance === 'long' ? UP : input.stance === 'short' || input.stance === 'avoid' ? DOWN : INK;
  const listing = [profile?.exchange ? `${profile.exchange}: ${input.symbol}` : input.symbol, facts?.sector, facts?.industry].filter(Boolean).join('  ·  ');
  const [cover, ...figures] = images;
  const content = new Map(input.sections.map((item) => [item.section, item.content.trim()]));
  const currency = facts?.currency ?? 'USD';
  // The cover carries the opening paragraph of the thesis as its summary, like a note's front-page abstract.
  const opening = toBlocks(content.get('thesis') ?? '').find((block): block is Extract<Block, { type: 'paragraph' }> => block.type === 'paragraph');
  const summary = opening ? trimDescription(opening.runs.map((run) => run.text).join('').replace(/\s+/g, ' ').trim(), 620) : null;

  const hq = [input.headquarters?.address, input.headquarters?.city].filter(Boolean).join(', ') || profile?.country || null;
  const keyData: Array<[string, string | null]> = [
    ['Rating', stance],
    ['Last price', price !== null ? usd(price) : null],
    ['Price target', input.targetPrice ? usd(input.targetPrice) : null],
    ['Implied return', upside !== null ? `${upside >= 0 ? '+' : '-'}${Math.abs(upside * 100).toFixed(1)}%` : null],
    ['Horizon', input.horizon],
    ['Conviction', input.conviction ? `${input.conviction} / 5` : null],
    ['Market cap', facts?.marketCap ? money(facts.marketCap, 'USD') : null],
    ['52-week range', profile?.low52 && profile.high52 ? `${usd(profile.low52)} – ${usd(profile.high52)}` : null],
    ['P/E', facts?.multiples?.pe ? multiple(facts.multiples.pe) : profile?.forwardPE ? `${multiple(profile.forwardPE)} fwd` : null],
    ['EV / EBITDA', facts?.multiples?.evEbitda ? multiple(facts.multiples.evEbitda) : null],
    ['FCF yield', facts?.multiples?.fcfYield !== null && facts?.multiples?.fcfYield !== undefined ? pct(facts.multiples.fcfYield) : null],
    ['Dividend yield', profile?.dividendYield ? pct(profile.dividendYield, 2) : null],
    ['Sector', facts?.sector ?? null],
    ['Industry', facts?.industry ?? null],
    ['Headquarters', hq],
    ['Chief executive', profile?.ceo ?? null],
    ['Employees', profile?.employees ? profile.employees.toLocaleString('en-US') : null],
    ['Website', profile?.website ? profile.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : null],
  ];
  const keyRows = keyData.filter((row): row is [string, string] => Boolean(row[1]));
  const half = Math.ceil(keyRows.length / 2);

  const history = facts?.annual ?? [];
  const annual = history.slice(-5);
  const growth = (row: (typeof history)[number]) => {
    const previous = history[history.indexOf(row) - 1];
    return row.revenue && previous?.revenue ? `${((row.revenue / previous.revenue - 1) * 100).toFixed(1)}%` : '—';
  };
  const hasFinancials = input.includeFinancials && annual.some((row) => row.revenue !== null);
  const maxRevenue = Math.max(...annual.map((row) => row.revenue ?? 0), 1);
  const financialRows = [
    ['Revenue', ...annual.map((row) => money(row.revenue, currency))],
    ['Revenue growth', ...annual.map(growth)],
    ['Operating margin', ...annual.map((row) => pct(row.operatingMargin))],
    ['Net income', ...annual.map((row) => money(row.netIncome, currency))],
    ['Free cash flow', ...annual.map((row) => money(row.freeCashFlow, currency))],
  ];

  type Part = { key: string; title: string; body: ReactNode };
  const parts: Part[] = [];
  if (input.includeOverview && profile?.description) {
    parts.push({
      key: 'overview',
      title: 'Company Overview',
      body: trimDescription(profile.description)
        .split(/\n\s*\n/)
        .map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {paragraph.trim()}
          </Text>
        )),
    });
  }
  for (const { section, title } of SECTION_ORDER) {
    if (section === 'valuation' && hasFinancials) {
      parts.push({
        key: 'financials',
        title: 'Financial Summary',
        body: (
          <View>
            <View wrap={false}>
              <View style={styles.chart}>
                {annual.map((row) => (
                  <View key={row.label} style={styles.chartCol}>
                    <Text style={styles.chartValue}>{money(row.revenue, currency)}</Text>
                    <View style={[styles.chartBar, { height: Math.max(2, ((row.revenue ?? 0) / maxRevenue) * 88) }]} />
                  </View>
                ))}
              </View>
              <View style={styles.chartLabels}>
                {annual.map((row) => (
                  <Text key={row.label} style={styles.chartLabel}>
                    {row.label}
                  </Text>
                ))}
              </View>
              <Text style={[styles.figureCredit, { marginBottom: 8 }]}>Annual revenue ({currency}). Source: company filings.</Text>
            </View>
            <Table header={['Fiscal year', ...annual.map((row) => row.label)]} rows={financialRows} firstWidth={110} />
          </View>
        ),
      });
    }
    const markdown = content.get(section);
    if (!markdown) continue;
    parts.push({
      key: section,
      title: title || THESIS_SECTION_META[section].title,
      body: toBlocks(markdown).map((block, index) => <BlockView key={index} block={block} />),
    });
  }

  // Figures are spread one after each block, in order; any extra ones follow the last block.
  const figuresAfter = parts.map(() => [] as Array<{ image: (typeof figures)[number]; number: number }>);
  const trailingFigures: Array<{ image: (typeof figures)[number]; number: number }> = [];
  figures.forEach((image, index) => (parts.length ? figuresAfter[Math.min(index, parts.length - 1)] : trailingFigures).push({ image, number: index + 1 }));

  const headerTitle = `${input.name} (${input.symbol})`;
  const doc = (
    <Document title={`${headerTitle} — Investment Thesis`} author={input.preparedBy || undefined} creator={input.preparedBy || undefined} subject={`${input.name} investment thesis`} language="en">
      <Page size="A4" style={styles.cover}>
        {cover ? (
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={cover.src} style={styles.heroImage} />
            <View style={styles.heroRule} />
            <Text style={styles.heroCredit}>
              {cover.caption}. Photo: {credit(cover)}
            </Text>
          </View>
        ) : (
          <View style={styles.heroPlain}>
            <Text style={[styles.kicker, { color: '#8fb3e8' }]}>INVESTMENT THESIS</Text>
            <Text style={[styles.nameOnDark, { marginTop: 14 }]}>{input.name}</Text>
            <Text style={styles.sublineOnDark}>{listing}</Text>
          </View>
        )}
        <View style={styles.coverBody}>
          {cover ? (
            <>
              <View style={styles.kickerRow}>
                <Text style={styles.kicker}>INVESTMENT THESIS</Text>
                <Text style={styles.kickerDate}>{date}</Text>
              </View>
              <View style={styles.nameRow}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
                {logo ? <Image src={logo} style={styles.logo} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{input.name}</Text>
                  <Text style={styles.subline}>{listing}</Text>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.kickerRow}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
              {logo ? <Image src={logo} style={styles.logo} /> : <View />}
              <Text style={styles.kickerDate}>{date}</Text>
            </View>
          )}
          <View style={styles.ratingStrip}>
            <View style={styles.ratingCell}>
              <Text style={styles.ratingLabel}>Rating</Text>
              <Text style={[styles.ratingValue, { color: stanceColor }]}>{stance}</Text>
              {input.conviction ? <Text style={styles.ratingSub}>Conviction {input.conviction}/5</Text> : null}
            </View>
            <View style={styles.ratingCell}>
              <Text style={styles.ratingLabel}>Price</Text>
              <Text style={styles.ratingValue}>{usd(price)}</Text>
            </View>
            <View style={styles.ratingCell}>
              <Text style={styles.ratingLabel}>Price target</Text>
              <Text style={styles.ratingValue}>{usd(input.targetPrice)}</Text>
              {input.horizon ? <Text style={styles.ratingSub}>{input.horizon}</Text> : null}
            </View>
            <View style={styles.ratingCell}>
              <Text style={styles.ratingLabel}>Implied return</Text>
              <Text style={[styles.ratingValue, upside !== null ? { color: upside >= 0 ? UP : DOWN } : {}]}>{upside !== null ? `${upside >= 0 ? '+' : '-'}${Math.abs(upside * 100).toFixed(0)}%` : '—'}</Text>
            </View>
            <View style={styles.ratingCell}>
              <Text style={styles.ratingLabel}>Market cap</Text>
              <Text style={styles.ratingValue}>{money(facts?.marketCap, 'USD')}</Text>
            </View>
          </View>
          {summary ? (
            <View>
              <Text style={styles.summaryTitle}>SUMMARY</Text>
              <Text style={styles.summary}>{summary}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.coverFoot}>
          <Text>{input.preparedBy ? `Prepared by ${input.preparedBy}` : `${input.name} (${input.symbol})`}</Text>
          <Text>For informational purposes only. Not investment advice.</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {logo ? <Image src={logo} style={styles.headerLogo} /> : null}
            <Text style={styles.headerTitle}>{headerTitle}</Text>
          </View>
          <Text style={styles.headerRight}>Investment Thesis  |  {date}</Text>
        </View>
        <View style={styles.footer} fixed>
          <Text>{input.preparedBy ? `Prepared by ${input.preparedBy}` : headerTitle}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {keyRows.length ? (
          <View style={styles.keyBox} wrap={false}>
            <Text style={styles.keyTitle}>KEY DATA</Text>
            <View style={styles.keyColumns}>
              {[keyRows.slice(0, half), keyRows.slice(half)].map((column, columnIndex) => (
                <View key={columnIndex} style={[styles.keyColumn, columnIndex === 0 ? { marginRight: 22 } : {}]}>
                  {column.map(([label, value]) => (
                    <View key={label} style={styles.keyRow}>
                      <Text style={styles.keyLabel}>{label}</Text>
                      <Text style={[styles.keyValue, label === 'Rating' ? { color: stanceColor } : {}]}>{value}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
            <Text style={styles.keyNote}>Market data as of {date}. Financial data from company filings.</Text>
          </View>
        ) : null}

        {/* Sections stay direct children of the page: react-pdf overlaps text when a nested View has to break right after an unbreakable heading. */}
        {parts.map((part, index) => (
          <Fragment key={part.key}>
            <SectionHead title={part.title} />
            {part.body}
            <View style={styles.sectionGap} />
            {figuresAfter[index].map(({ image, number }) => (
              <Figure key={image.id} image={image} number={number} />
            ))}
          </Fragment>
        ))}
        {trailingFigures.map(({ image, number }) => (
          <Figure key={image.id} image={image} number={number} />
        ))}

        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.75, borderTopColor: RULE }} wrap={false}>
          <Text style={styles.disclosureTitle}>DISCLOSURES</Text>
          <Text style={styles.disclosure}>
            This document is provided for informational purposes only and does not constitute investment advice, an offer, or a solicitation to buy or sell any security. The views expressed reflect the author’s judgment as of the date above and may change without notice. Market data and financial figures are drawn from public filings and third-party sources believed to be reliable, but their accuracy and completeness are not guaranteed. Investing involves risk, including the possible loss of principal. Past performance is not indicative of future results.
          </Text>
          {images.length ? (
            <>
              <Text style={[styles.disclosureTitle, { marginTop: 6 }]}>IMAGE CREDITS</Text>
              {images.map((image, index) => (
                <View key={image.id} style={{ marginBottom: 3 }}>
                  <Text style={[styles.disclosure, { marginBottom: 0 }]}>
                    {index === 0 ? 'Cover' : `Figure ${index}`}: {image.caption}. {credit(image)}.
                  </Text>
                  <Text style={[styles.disclosure, { marginBottom: 0 }]}>{image.sourceUrl}</Text>
                </View>
              ))}
            </>
          ) : null}
        </View>

      </Page>
    </Document>
  );

  return pdf(doc).toBlob();
}
