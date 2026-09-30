'use client';

import { toast } from 'sonner';

export type ExportSheet = {
  name: string;
  title?: string;
  columns: Array<{ header: string; key: string; format?: 'text' | 'number' | 'integer' | 'currency' | 'currencyMillions' | 'percent' | 'multiple' | 'date'; width?: number }>;
  rows: Array<Record<string, string | number | null>>;
  notes?: string[];
};

async function save(response: Response, fallback: string) {
  if (!response.ok) {
    const message = await response.json().then((body: { error?: string }) => body.error).catch(() => null);
    throw new Error(message ?? `Export failed (${response.status})`);
  }
  const blob = await response.blob();
  const name = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download any on-screen table as a formatted Excel workbook (with a Sources sheet). */
export async function exportXlsx(filename: string, sheets: ExportSheet[], sources: string[] = []) {
  try {
    await save(await fetch('/api/export/xlsx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename, sheets, sources }) }), `${filename}.xlsx`);
  } catch (error) {
    toast.error((error as Error).message);
  }
}

/** Download a server-built file (statements workbook, tax CSV). */
export async function downloadFrom(url: string, fallback: string) {
  try {
    await save(await fetch(url), fallback);
  } catch (error) {
    toast.error((error as Error).message);
  }
}
