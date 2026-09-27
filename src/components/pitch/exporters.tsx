'use client';

import { marked, type Token, type Tokens } from 'marked';

export type ExportPitch = {
  title: string;
  recommendation: string;
  target_price: number | null;
  symbol: string;
  sections: Array<{ kind: string; title: string; content: string; included: boolean }>;
  facts: null | {
    name: string;
    sector: string | null;
    industry: string | null;
    price: number | null;
    marketCap: number | null;
    currency: string;
    score: { overall: number; label: string; confidence: string; components: Array<{ name: string; score: number }> } | null;
    annual: Array<{ label: string; revenue: number | null; netIncome: number | null; freeCashFlow: number | null; operatingMargin: number | null }>;
  };
};

type Block =
  | { type: 'heading'; text: string; level: number }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; items: Run[][]; ordered: boolean }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'quote'; runs: Run[] };

type Run = { text: string; bold?: boolean; italic?: boolean };

function inlineRuns(tokens: Token[] | undefined, fallback: string): Run[] {
  if (!tokens?.length) return [{ text: fallback }];
  const runs: Run[] = [];
  const walk = (items: Token[], style: Omit<Run, 'text'>) => {
    for (const token of items) {
      if (token.type === 'strong') walk((token as Tokens.Strong).tokens, { ...style, bold: true });
      else if (token.type === 'em') walk((token as Tokens.Em).tokens, { ...style, italic: true });
      else if (token.type === 'link') walk((token as Tokens.Link).tokens, style);
      else if (token.type === 'codespan') runs.push({ text: (token as Tokens.Codespan).text, ...style });
      else if (token.type === 'br') runs.push({ text: '\n', ...style });
      else if ('tokens' in token && Array.isArray(token.tokens)) walk(token.tokens, style);
      else runs.push({ text: 'text' in token ? String(token.text) : token.raw, ...style });
    }
  };
  walk(tokens, {});
  return runs.map((run) => ({ ...run, text: run.text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") }));
}

/** Markdown → a small block model both exporters can render. */
export function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const token of marked.lexer(markdown ?? '')) {
    if (token.type === 'heading') blocks.push({ type: 'heading', text: (token as Tokens.Heading).text, level: (token as Tokens.Heading).depth });
    else if (token.type === 'paragraph') blocks.push({ type: 'paragraph', runs: inlineRuns((token as Tokens.Paragraph).tokens, (token as Tokens.Paragraph).text) });
    else if (token.type === 'list') {
      const list = token as Tokens.List;
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map((item) => inlineRuns(item.tokens.flatMap((child) => ('tokens' in child && Array.isArray(child.tokens) ? child.tokens : [child])), item.text)) });
    } else if (token.type === 'table') {
      const table = token as Tokens.Table;
      blocks.push({ type: 'table', header: table.header.map((cell) => cell.text), rows: table.rows.map((row) => row.map((cell) => cell.text)) });
    } else if (token.type === 'blockquote') {
      blocks.push({ type: 'quote', runs: [{ text: (token as Tokens.Blockquote).text }] });
    } else if (token.type === 'code') {
      blocks.push({ type: 'paragraph', runs: [{ text: (token as Tokens.Code).text }] });
    }
  }
  return blocks;
}

const plain = (runs: Run[]) => runs.map((run) => run.text).join('').replace(/[_*]/g, '');

function compact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${abs.toFixed(0)}`;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileBase(pitch: ExportPitch) {
  return `${pitch.symbol}-pitch-${new Date().toISOString().slice(0, 10)}`;
}

/** The company logo as a PNG/JPEG data URL, or null when there is none. */
async function logoDataUrl(symbol: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/logo/${encodeURIComponent(symbol)}?v=4`);
    if (!response.ok || !/image\/(png|jpe?g)/.test(response.headers.get('content-type') ?? '')) return null;
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

/** Direction colors: long reads as upside, short/avoid as downside, hold stays neutral. */
function recommendationColor(recommendation: string, palette: { up: string; down: string; neutral: string }) {
  if (recommendation === 'long') return palette.up;
  if (recommendation === 'short' || recommendation === 'avoid') return palette.down;
  return palette.neutral;
}

// ─── PDF ────────────────────────────────────────────────────────────────────

export async function exportPdf(pitch: ExportPitch) {
  const [{ Document, Page, Text, View, Image, StyleSheet, pdf }, logo] = await Promise.all([import('@react-pdf/renderer'), logoDataUrl(pitch.symbol)]);
  const SILVER = '#cdd4de';
  const STEEL = '#7a828e';
  const INK = '#15171b';
  const MUTED = '#6b7079';
  const UP = '#3ddba4';
  const DOWN = '#ff6e66';
  const styles = StyleSheet.create({
    page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52, fontFamily: 'Helvetica', fontSize: 10.5, color: INK, lineHeight: 1.5 },
    cover: { padding: 0, backgroundColor: '#0b0c0f', color: '#eceef1', fontFamily: 'Helvetica' },
    coverInner: { padding: 56, flex: 1, justifyContent: 'space-between' },
    brand: { fontSize: 10, letterSpacing: 3, color: SILVER, fontFamily: 'Helvetica-Bold' },
    brandRow: { flexDirection: 'row', alignItems: 'center' },
    logoTile: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#f3f5f8', padding: 6, marginRight: 14, alignItems: 'center', justifyContent: 'center' },
    coverTitle: { fontSize: 28, fontFamily: 'Helvetica-Bold', marginTop: 18, lineHeight: 1.15 },
    coverSub: { fontSize: 13, color: '#b9bdc6', marginTop: 10 },
    statRow: { flexDirection: 'row', marginTop: 28 },
    stat: { marginRight: 34 },
    statLabel: { fontSize: 8.5, color: '#858a95', letterSpacing: 1.2, textTransform: 'uppercase' },
    statValue: { fontSize: 17, fontFamily: 'Helvetica-Bold', marginTop: 4 },
    sectionTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 8, color: INK },
    sectionRule: { height: 2, width: 36, backgroundColor: STEEL, marginBottom: 12 },
    heading: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
    paragraph: { marginBottom: 6 },
    bulletRow: { flexDirection: 'row', marginBottom: 3 },
    bullet: { width: 12, color: STEEL },
    quote: { borderLeftWidth: 2, borderLeftColor: STEEL, paddingLeft: 8, color: MUTED, marginBottom: 6 },
    table: { marginVertical: 6, borderTopWidth: 1, borderTopColor: '#d9dbe0' },
    tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e6e8ec' },
    th: { flex: 1, padding: 4, fontSize: 8.5, color: MUTED, fontFamily: 'Helvetica-Bold' },
    td: { flex: 1, padding: 4, fontSize: 9 },
    footer: { position: 'absolute', bottom: 26, left: 52, right: 52, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: MUTED },
    section: { marginBottom: 18 },
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
        return (
          <View style={styles.table} wrap={false}>
            <View style={styles.tr}>
              {block.header.map((cell, index) => (
                <Text key={index} style={[styles.th, index > 0 ? { textAlign: 'right' } : {}]}>
                  {cell}
                </Text>
              ))}
            </View>
            {block.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.tr}>
                {row.map((cell, index) => (
                  <Text key={index} style={[styles.td, index > 0 ? { textAlign: 'right' } : {}]}>
                    {cell.replace(/\*\*/g, '')}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      default:
        return null;
    }
  };

  const facts = pitch.facts;
  const upside = pitch.target_price && facts?.price ? pitch.target_price / facts.price - 1 : null;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const included = pitch.sections.filter((section) => section.included);

  const doc = (
    <Document title={pitch.title} author="SilverNote" subject={`${pitch.symbol} investment pitch`}>
      <Page size="A4" style={styles.cover}>
        <View style={styles.coverInner}>
          <View>
            <View style={styles.brandRow}>
              {logo ? (
                <View style={styles.logoTile}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
                  <Image src={logo} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                </View>
              ) : null}
              <Text style={styles.brand}>SILVERNOTE · INVESTMENT PITCH</Text>
            </View>
            <Text style={styles.coverTitle}>{pitch.title}</Text>
            <Text style={styles.coverSub}>
              {facts?.name ?? pitch.symbol} ({pitch.symbol}){facts?.sector ? ` · ${facts.sector}` : ''}
            </Text>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Recommendation</Text>
                <Text style={[styles.statValue, { color: recommendationColor(pitch.recommendation, { up: UP, down: DOWN, neutral: SILVER }) }]}>{pitch.recommendation.toUpperCase()}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Price</Text>
                <Text style={styles.statValue}>{facts?.price ? `$${facts.price.toFixed(2)}` : 'n/a'}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Target</Text>
                <Text style={styles.statValue}>{pitch.target_price ? `$${pitch.target_price.toFixed(2)}` : 'n/a'}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Upside</Text>
                <Text style={[styles.statValue, upside !== null ? { color: upside >= 0 ? UP : DOWN } : {}]}>{upside !== null ? `${upside >= 0 ? '+' : '−'}${Math.abs(upside * 100).toFixed(0)}%` : 'n/a'}</Text>
              </View>
              {facts?.score ? (
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>SilverNote Score</Text>
                  <Text style={styles.statValue}>{facts.score.overall}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <Text style={{ fontSize: 9, color: '#858a95' }}>
            {date} · Market value ${compact(facts?.marketCap)} · Figures from SEC filings and market data; not investment advice.
          </Text>
        </View>
      </Page>
      <Page size="A4" style={styles.page}>
        {included.map((section) => (
          <View key={section.kind} style={styles.section}>
            <View wrap={false}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.sectionRule} />
            </View>
            {toBlocks(section.content).map((block, index) => (
              <BlockView key={index} block={block} />
            ))}
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>
            {pitch.symbol} · {pitch.title}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );

  download(await pdf(doc).toBlob(), `${fileBase(pitch)}.pdf`);
}

// ─── Slides (PPTX) ──────────────────────────────────────────────────────────

export async function exportSlides(pitch: ExportPitch) {
  const [{ default: PptxGenJS }, logo] = await Promise.all([import('pptxgenjs'), logoDataUrl(pitch.symbol)]);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = pitch.title;
  pptx.company = 'SilverNote';
  const BG = '0B0C0F';
  const INK = 'ECEEF1';
  const MUTED = '858A95';
  const SILVER = 'CDD4DE';
  const UP = '3DDBA4';
  const DOWN = 'FF6E66';
  const facts = pitch.facts;
  const upside = pitch.target_price && facts?.price ? pitch.target_price / facts.price - 1 : null;

  pptx.defineSlideMaster({
    title: 'SILVERNOTE',
    background: { color: BG },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: SILVER } } },
      { text: { text: `SILVERNOTE · ${pitch.symbol}`, options: { x: 0.5, y: 7.05, w: 6, h: 0.3, fontSize: 9, color: MUTED, fontFace: 'Arial', charSpacing: 2 } } },
    ],
    slideNumber: { x: 12.4, y: 7.05, fontSize: 9, color: MUTED },
  });

  const cover = pptx.addSlide({ masterName: 'SILVERNOTE' });
  if (logo) {
    cover.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 0.32, w: 0.6, h: 0.6, fill: { color: 'F3F5F8' }, rectRadius: 0.1, line: { color: 'F3F5F8' } });
    cover.addImage({ data: logo.replace(/^data:/, ''), x: 0.77, y: 0.39, w: 0.46, h: 0.46, sizing: { type: 'contain', w: 0.46, h: 0.46 } });
  }
  cover.addText('INVESTMENT PITCH', { x: 0.7, y: 1.0, w: 8, h: 0.4, fontSize: 12, color: SILVER, bold: true, charSpacing: 4, fontFace: 'Arial' });
  cover.addText(pitch.title, { x: 0.7, y: 1.5, w: 11.5, h: 1.6, fontSize: 36, color: INK, bold: true, fontFace: 'Arial', valign: 'top' });
  cover.addText(`${facts?.name ?? pitch.symbol} (${pitch.symbol})${facts?.sector ? ` · ${facts.sector}` : ''}`, { x: 0.7, y: 3.1, w: 11, h: 0.5, fontSize: 16, color: 'B9BDC6', fontFace: 'Arial' });
  const stats: Array<[string, string]> = [
    ['RECOMMENDATION', pitch.recommendation.toUpperCase()],
    ['PRICE', facts?.price ? `$${facts.price.toFixed(2)}` : 'n/a'],
    ['TARGET', pitch.target_price ? `$${pitch.target_price.toFixed(2)}` : 'n/a'],
    ['UPSIDE', upside !== null ? `${upside >= 0 ? '+' : '−'}${Math.abs(upside * 100).toFixed(0)}%` : 'n/a'],
    ['SILVERNOTE SCORE', facts?.score ? `${facts.score.overall}` : 'n/a'],
  ];
  stats.forEach(([label, value], index) => {
    cover.addText(label, { x: 0.7 + index * 2.4, y: 4.3, w: 2.3, h: 0.3, fontSize: 9, color: MUTED, charSpacing: 1.5, fontFace: 'Arial' });
    const color = index === 0 ? recommendationColor(pitch.recommendation, { up: UP, down: DOWN, neutral: SILVER }) : index === 3 && upside !== null ? (upside >= 0 ? UP : DOWN) : INK;
    cover.addText(value, { x: 0.7 + index * 2.4, y: 4.6, w: 2.3, h: 0.6, fontSize: 24, color, bold: true, fontFace: 'Arial' });
  });

  for (const section of pitch.sections.filter((item) => item.included)) {
    const slide = pptx.addSlide({ masterName: 'SILVERNOTE' });
    slide.addText(section.title, { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 26, bold: true, color: INK, fontFace: 'Arial' });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.12, w: 0.6, h: 0.05, fill: { color: SILVER } });
    const blocks = toBlocks(section.content);
    const table = blocks.find((block) => block.type === 'table') as Extract<Block, { type: 'table' }> | undefined;
    const textBlocks = blocks.filter((block) => block.type !== 'table');
    const paragraphs: Array<{ text: string; options: Record<string, unknown> }> = [];
    for (const block of textBlocks) {
      if (block.type === 'list') {
        for (const item of block.items) paragraphs.push({ text: plain(item), options: { bullet: { code: '25A0' }, color: 'D5D8DE', fontSize: 15, paraSpaceAfter: 6, breakLine: true } });
      } else if (block.type === 'heading') {
        paragraphs.push({ text: block.text, options: { bold: true, color: INK, fontSize: 16, paraSpaceBefore: 6, breakLine: true } });
      } else {
        paragraphs.push({ text: plain(block.runs), options: { color: 'D5D8DE', fontSize: 15, paraSpaceAfter: 8, breakLine: true } });
      }
    }
    const hasChart = section.kind === 'financials' && facts?.annual.length;
    const textWidth = table || hasChart ? 5.6 : 12;
    if (paragraphs.length) slide.addText(paragraphs, { x: 0.6, y: 1.4, w: textWidth, h: 5.4, valign: 'top', fontFace: 'Arial', fit: 'shrink' });
    if (hasChart && facts) {
      slide.addChart(
        pptx.ChartType.bar,
        [
          { name: 'Revenue', labels: facts.annual.map((row) => row.label), values: facts.annual.map((row) => (row.revenue ?? 0) / 1e9) },
          { name: 'Free cash flow', labels: facts.annual.map((row) => row.label), values: facts.annual.map((row) => (row.freeCashFlow ?? 0) / 1e9) },
        ],
        {
          x: paragraphs.length ? 6.4 : 0.6,
          y: 1.4,
          w: paragraphs.length ? 6.3 : 12,
          h: 3.3,
          barGrouping: 'clustered',
          chartColors: [SILVER, '3987E5'],
          showLegend: true,
          legendPos: 'b',
          legendColor: 'B9BDC6',
          catAxisLabelColor: 'B9BDC6',
          valAxisLabelColor: 'B9BDC6',
          valAxisTitle: `${facts.currency} billions`,
          valAxisTitleColor: MUTED,
          showValAxisTitle: true,
          valGridLine: { color: '2A2E36', size: 0.5 },
        },
      );
    }
    if (table) {
      const y = hasChart ? 4.85 : 1.4;
      slide.addTable(
        [
          table.header.map((cell) => ({ text: cell, options: { bold: true, color: MUTED, fontSize: 11, fill: { color: '15181D' } } })),
          ...table.rows.map((row) => row.map((cell, index) => ({ text: cell.replace(/\*\*/g, ''), options: { color: index ? INK : 'B9BDC6', fontSize: 11, align: index ? ('right' as const) : ('left' as const) } }))),
        ],
        { x: paragraphs.length || hasChart ? 6.4 : 0.6, y, w: paragraphs.length || hasChart ? 6.3 : 12, fontFace: 'Arial', border: { type: 'solid', color: '2A2E36', pt: 0.5 }, fill: { color: BG } },
      );
    }
  }

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  download(blob, `${fileBase(pitch)}.pptx`);
}
