'use client';

import { Bold, Code, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Quote } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';

import { cn } from '@/lib/utils';

type Action =
  | { type: 'wrap'; before: string; after?: string; placeholder: string }
  | { type: 'line-prefix'; prefix: string; placeholder: string }
  | { type: 'numbered-list'; placeholder: string };

const TOOLS: Array<{ icon: typeof Bold; label: string; action: Action }> = [
  { icon: Bold, label: 'Bold', action: { type: 'wrap', before: '**', after: '**', placeholder: 'bold text' } },
  { icon: Italic, label: 'Italic', action: { type: 'wrap', before: '_', after: '_', placeholder: 'italic text' } },
  { icon: Heading1, label: 'Heading 1', action: { type: 'line-prefix', prefix: '# ', placeholder: 'Heading' } },
  { icon: Heading2, label: 'Heading 2', action: { type: 'line-prefix', prefix: '## ', placeholder: 'Heading' } },
  { icon: Heading3, label: 'Heading 3', action: { type: 'line-prefix', prefix: '### ', placeholder: 'Heading' } },
  { icon: List, label: 'Bullet list', action: { type: 'line-prefix', prefix: '- ', placeholder: 'List item' } },
  { icon: ListOrdered, label: 'Numbered list', action: { type: 'numbered-list', placeholder: 'List item' } },
  { icon: Quote, label: 'Quote', action: { type: 'line-prefix', prefix: '> ', placeholder: 'Quote' } },
  { icon: Code, label: 'Code', action: { type: 'wrap', before: '`', after: '`', placeholder: 'code' } },
  { icon: Link2, label: 'Link', action: { type: 'wrap', before: '[', after: '](https://)', placeholder: 'link text' } },
];

function applyAction(value: string, start: number, end: number, action: Action): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);

  if (action.type === 'wrap') {
    const text = selected || action.placeholder;
    const before = action.before;
    const after = action.after ?? action.before;
    const next = value.slice(0, start) + before + text + after + value.slice(end);
    const from = start + before.length;
    return { value: next, start: from, end: from + text.length };
  }

  // Line-based actions operate on every line touched by the selection.
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = value.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.length ? block.split('\n') : [''];

  let rendered: string[];
  if (action.type === 'numbered-list') {
    rendered = lines.map((line, index) => `${index + 1}. ${line || (lines.length === 1 ? action.placeholder : '')}`);
  } else {
    rendered = lines.map((line) => `${action.prefix}${line}`);
  }
  if (lines.length === 1 && !lines[0]) {
    rendered = [action.type === 'numbered-list' ? `1. ${action.placeholder}` : `${action.prefix}${action.placeholder}`];
  }

  const nextBlock = rendered.join('\n');
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return { value: next, start: lineStart, end: lineStart + nextBlock.length };
}

/**
 * Shrink an image to at most 1400px wide and encode it as JPEG so it can live inline in a note
 * (a chart screenshot ends up around 60–150 KB).
 */
export async function imageToDataUrl(file: Blob, maxWidth = 1400) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#0b0c0f';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function MarkdownToolbar({
  textareaRef,
  value,
  onChange,
  className,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const insertImage = async (file: Blob, name = 'image') => {
    const el = textareaRef.current;
    const url = await imageToDataUrl(file);
    const { value: current, onChange: change } = latest.current;
    const at = el?.selectionEnd ?? current.length;
    const snippet = `\n![${name}](${url})\n`;
    change(current.slice(0, at) + snippet + current.slice(at));
  };

  // Paste a screenshot straight into the editor.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      void insertImage(file, 'pasted image');
    };
    el.addEventListener('paste', onPaste);
    return () => el.removeEventListener('paste', onPaste);
    // insertImage reads the latest value through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textareaRef]);

  const run = (action: Action) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const result = applyAction(value, start, end, action);
    onChange(result.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.start, result.end);
    });
  };

  return (
    <div className={cn('flex items-center gap-0.5 rounded-sm border border-line-strong bg-surface-1 p-1', className)}>
      {TOOLS.map(({ icon: Icon, label, action }) => (
        <button
          key={label}
          type="button"
          onClick={() => run(action)}
          title={label}
          aria-label={label}
          className="rounded-xs p-1.5 text-muted hover:bg-white/5 hover:text-ink"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
      <button type="button" onClick={() => fileRef.current?.click()} title="Insert image (or paste one)" aria-label="Insert image" className="rounded-xs p-1.5 text-muted hover:bg-white/5 hover:text-ink">
        <ImagePlus className="size-3.5" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void insertImage(file, file.name.replace(/\.[a-z]+$/i, ''));
          event.target.value = '';
        }}
      />
    </div>
  );
}
