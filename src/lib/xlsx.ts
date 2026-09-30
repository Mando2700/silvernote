import 'server-only';

import ExcelJS from 'exceljs';

export type XlsxFormat = 'text' | 'number' | 'integer' | 'currency' | 'currencyMillions' | 'percent' | 'multiple' | 'date';
export type XlsxSheet = {
  name: string;
  /** Title row above the table (company, report, units). */
  title?: string;
  columns: Array<{ header: string; key: string; format?: XlsxFormat; width?: number }>;
  rows: Array<Record<string, string | number | null | undefined>>;
  /** Lines written under the table: source, as-of date, method notes. */
  notes?: string[];
};

const NUMBER_FORMATS: Record<XlsxFormat, string | undefined> = {
  text: undefined,
  number: '#,##0.00',
  integer: '#,##0',
  currency: '$#,##0.00',
  currencyMillions: '$#,##0.0,,"M"',
  percent: '0.0%',
  multiple: '0.0"x"',
  date: 'yyyy-mm-dd',
};

/**
 * A workbook with one formatted table per sheet plus a Sources sheet, so numbers pasted into
 * coursework or a model keep their provenance.
 */
export async function buildWorkbook(sheets: XlsxSheet[], sources: string[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SilverNote';
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
    let rowIndex = 1;
    if (sheet.title) {
      ws.getCell(rowIndex, 1).value = sheet.title;
      ws.getCell(rowIndex, 1).font = { bold: true, size: 13 };
      rowIndex += 2;
    }
    const header = ws.getRow(rowIndex);
    sheet.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2530' } };
      cell.alignment = { horizontal: index === 0 ? 'left' : 'right' };
      ws.getColumn(index + 1).width = column.width ?? (index === 0 ? 30 : 16);
    });
    ws.views = [{ state: 'frozen', ySplit: rowIndex, xSplit: 1 }];
    for (const record of sheet.rows) {
      rowIndex += 1;
      const row = ws.getRow(rowIndex);
      sheet.columns.forEach((column, index) => {
        const raw = record[column.key];
        const cell = row.getCell(index + 1);
        if (raw === null || raw === undefined || raw === '') return;
        if (column.format === 'date' && typeof raw === 'string') cell.value = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
        else cell.value = raw;
        const format = column.format ? NUMBER_FORMATS[column.format] : undefined;
        if (format && typeof cell.value !== 'string') cell.numFmt = format;
      });
    }
    if (sheet.notes?.length) {
      rowIndex += 2;
      for (const note of sheet.notes) {
        ws.getCell(rowIndex, 1).value = note;
        ws.getCell(rowIndex, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
        rowIndex += 1;
      }
    }
  }
  const info = workbook.addWorksheet('Sources');
  info.getColumn(1).width = 140;
  info.getCell(1, 1).value = 'Sources and citations';
  info.getCell(1, 1).font = { bold: true, size: 13 };
  sources.forEach((line, index) => {
    info.getCell(index + 3, 1).value = line.replace(/\*/g, '');
    info.getCell(index + 3, 1).alignment = { wrapText: true };
  });
  info.getCell(sources.length + 4, 1).value = `Exported from SilverNote on ${new Date().toISOString().slice(0, 10)}. Free data sources can be delayed or incomplete; verify figures against the filings before relying on them.`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function xlsxResponse(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`,
    },
  });
}
