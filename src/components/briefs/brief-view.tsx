'use client';

import { Modal } from '@/components/ui/overlay';
import { dateTime } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';

export type Brief = { id: string; kind: 'morning' | 'redteam' | 'earnings_preview'; symbol: string | null; title: string; content: string; created_at: string };

export function BriefBody({ brief }: { brief: Brief }) {
  return <div className="prose-rn text-[13px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(brief.content) }} />;
}

/** A stored Grok brief (morning brief, red team, earnings preview) in a dialog. */
export function BriefModal({ brief, onClose }: { brief: Brief | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(brief)} onClose={onClose} title={brief?.title} description={brief ? `Grok · ${dateTime(brief.created_at)}` : undefined} className="max-w-2xl">
      {brief ? <BriefBody brief={brief} /> : null}
    </Modal>
  );
}
