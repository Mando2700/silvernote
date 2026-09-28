'use client';

import { ArrowUp, Briefcase, Building2, Copy, Globe, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { mutate as globalMutate } from 'swr';

import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export type ChatContext = { type: 'company'; symbol: string; name?: string } | { type: 'portfolio'; id: string; name?: string } | { type: 'general' };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; pending?: boolean };

const FILING_DIRECTIVE = /\n?\[filing:[^\]]+\]/g;

export function useChat(initialThreadId: string | null = null) {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // The thread on screen. A new conversation gets its id mid-stream and the page then asks to load it;
  // reloading from the server there would replace the answer still streaming in.
  const shownRef = useRef<string | null>(initialThreadId);

  const load = useCallback(async (id: string | null) => {
    if (id && id === shownRef.current) return;
    shownRef.current = id;
    setThreadId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    const response = await fetch(`/api/ai/threads/${id}`);
    if (!response.ok) return;
    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);
  }, []);

  const send = useCallback(
    async (text: string, context: ChatContext, options: { fresh?: boolean } = {}) => {
      if (!text.trim() || streaming) return;
      const targetThread = options.fresh ? null : threadId;
      const controller = new AbortController();
      abortRef.current = controller;
      const userMessage: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
      const assistantId = `a-${Date.now()}`;
      setMessages((current) => [...(options.fresh ? [] : current), userMessage, { id: assistantId, role: 'assistant', content: '', pending: true }]);
      setStreaming(true);
      try {
        const payloadContext = context.type === 'company' ? { type: 'company', symbol: context.symbol } : context.type === 'portfolio' ? { type: 'portfolio', id: context.id } : { type: 'general' };
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: targetThread, message: text, context: payloadContext }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(error.error ?? 'Request failed');
        }
        const newThread = response.headers.get('X-Thread-Id');
        if (newThread) {
          shownRef.current = newThread;
          setThreadId(newThread);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, content: message.content + chunk } : message)));
        }
        void globalMutate('/api/ai/threads');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          toast.error((error as Error).message);
          setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, content: message.content || `> ${(error as Error).message}` } : message)));
        }
      } finally {
        setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, pending: false } : message)));
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, threadId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { threadId, messages, streaming, send, stop, load, reset: () => void load(null) };
}

export function contextLabel(context: ChatContext) {
  if (context.type === 'company') return { icon: <Building2 className="size-3.5" />, text: context.name ? `${context.symbol} · ${context.name}` : context.symbol };
  if (context.type === 'portfolio') return { icon: <Briefcase className="size-3.5" />, text: `Portfolio · ${context.name ?? ''}` };
  return { icon: <Globe className="size-3.5" />, text: 'Markets & your lists' };
}

export function quickActions(context: ChatContext): Array<{ label: string; prompt: string }> {
  if (context.type === 'company') {
    const name = context.name ?? context.symbol;
    return [
      { label: 'Summarize the latest 10-K/10-Q', prompt: `Summarize ${name}'s most recent 10-K or 10-Q results from the statements and filings data: what changed, what surprised, and what to watch.` },
      { label: 'Challenge my thesis', prompt: `Challenge my thesis on ${name}. Argue the strongest bear case and list the specific signals that would prove me wrong.` },
      { label: 'Valuation vs peers', prompt: `Is ${name} cheap or expensive versus its sector medians and its own growth and margins? Show the key multiples side by side.` },
      { label: 'Draft a pitch summary', prompt: `Draft a one-paragraph investment pitch summary for ${name}, then three bullet catalysts and three key risks.` },
    ];
  }
  if (context.type === 'portfolio') {
    return [
      { label: 'Risk review', prompt: 'Review the portfolio’s risk: concentration, sector and factor tilts, what drives volatility, and the biggest single points of failure.' },
      { label: 'Rebalancing ideas', prompt: 'Suggest three concrete ways to improve risk-adjusted returns with minimal turnover, with the trade-offs of each.' },
      { label: 'Weakest positions', prompt: 'Which holdings look weakest on SilverNote Score, valuation and momentum, and what would you need to believe to keep them?' },
    ];
  }
  return [
    { label: 'What moved today?', prompt: 'Summarize today’s market: breadth, the strongest and weakest areas, and anything unusual.' },
    { label: 'Ideas from my watchlists', prompt: 'Across my watchlists, which names look most interesting right now on SilverNote Score and valuation, and why?' },
    { label: 'Explain the SilverNote Score', prompt: 'Explain how the SilverNote Score works and how I should use it (and not use it) in my research.' },
  ];
}

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-md rounded-br-xs border border-brand/25 bg-brand-wash px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
          {message.content.replace(FILING_DIRECTIVE, '')}
        </div>
      </div>
    );
  }
  return (
    <div className="group relative">
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full bg-brand', message.pending && 'animate-pulse-dot')} />
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted">GROK</span>
      </div>
      {message.content ? (
        <div className="prose-rn" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      ) : (
        <div className="flex gap-1 py-2">
          {[0, 1, 2].map((dot) => (
            <motion.span key={dot} className="size-1.5 rounded-full bg-brand/70" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: dot * 0.15 }} />
          ))}
        </div>
      )}
      {!message.pending && message.content ? (
        <button
          onClick={() => {
            void navigator.clipboard.writeText(message.content);
            toast.success('Copied');
          }}
          className="absolute top-0 right-0 rounded-xs p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
          aria-label="Copy answer"
        >
          <Copy className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** A prompt to place in the composer for the user to edit and send; `id` changes for each new draft. */
export type Draft = { id: number; text: string };

export function Composer({ onSend, onStop, streaming, placeholder, autoFocus, draft }: { onSend: (text: string) => void; onStop: () => void; streaming: boolean; placeholder?: string; autoFocus?: boolean; draft?: Draft | null }) {
  const [text, setText] = useState(draft?.text ?? '');
  const [draftId, setDraftId] = useState(draft?.id ?? null);
  const ref = useRef<HTMLTextAreaElement>(null);
  if (draft && draft.id !== draftId) {
    setDraftId(draft.id);
    setText(draft.text);
  }
  // Put the cursor at the end of a freshly prepared prompt so it can be edited or sent with Enter.
  useEffect(() => {
    const element = ref.current;
    if (!element || draftId === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [draftId]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(180, element.scrollHeight)}px`;
  }, [text]);
  const submit = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <div className="light-trail rounded-md">
      <div className="flex items-end gap-2 rounded-md border border-line-strong bg-surface-1 p-2 focus-within:border-brand/50">
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={placeholder ?? 'Ask anything about this company, your portfolio or the market…'}
          className="max-h-44 min-h-7 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-ink outline-none placeholder:text-faint"
        />
        {streaming ? (
          <button onClick={onStop} className="grid size-7 place-items-center rounded-sm bg-surface-4 text-ink hover:bg-white/10" aria-label="Stop">
            <Square className="size-3" />
          </button>
        ) : (
          <button onClick={submit} disabled={!text.trim()} className="sheen grid size-7 place-items-center rounded-sm bg-silver text-[#0b0c0f] shadow-[0_0_14px_rgba(205,212,222,0.3)] transition-opacity disabled:opacity-40" aria-label="Send">
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages, className }: { messages: Message[]; className?: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <motion.div key={message.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <MessageBubble message={message} />
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}
