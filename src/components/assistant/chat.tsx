'use client';

import { ArrowUp, Brain, Briefcase, Building2, ChevronsUpDown, Copy, Globe, Sparkles, Square, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { mutate as globalMutate } from 'swr';

import { ActionCard, type ActionView } from '@/components/assistant/action-card';
import { ThinkingOrb } from '@/components/assistant/thinking-orb';
import { formatCost, formatTokens, USAGE_SEPARATOR, type ChatMode } from '@/lib/ai/pricing';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export type ChatContext = { type: 'company'; symbol: string; name?: string } | { type: 'portfolio'; id: string; name?: string } | { type: 'general' };
export type MessageUsage = { input: number; output: number; cost: number | null };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; pending?: boolean; usage?: MessageUsage; actions?: ActionView[] };

/** The trailer after the answer: token usage (when metered) and any changes Grok proposed. */
function parseTrailer(raw: string): { usage?: MessageUsage; actions?: ActionView[] } {
  try {
    const { actions, ...usage } = JSON.parse(raw) as Partial<MessageUsage> & { actions?: ActionView[] };
    return { usage: typeof usage.input === 'number' ? (usage as MessageUsage) : undefined, actions: actions?.length ? actions : undefined };
  } catch {
    return {};
  }
}

const FILING_DIRECTIVE = /\n?\[filing:[^\]]+\]/g;

const MODE_KEY = 'silvernote.grokMode';
const modeListeners = new Set<() => void>();
let modeFallback: ChatMode = 'standard'; // used when localStorage is unavailable

function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    modeListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readMode(): ChatMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'fast' || value === 'thinking' || value === 'standard' ? value : 'standard';
  } catch {
    return modeFallback;
  }
}

/** The chat mode, shared by the Grok page and the side panel and remembered across visits. */
export function useChatMode() {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'standard' as ChatMode);
  const setMode = useCallback((next: ChatMode) => {
    modeFallback = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // storage unavailable: the in-memory fallback carries the value
    }
    for (const listener of modeListeners) listener();
  }, []);
  return [mode, setMode] as const;
}

const MODES: Array<{ value: ChatMode; label: string; icon: typeof Zap; hint: string }> = [
  { value: 'fast', label: 'Fast', icon: Zap, hint: 'Fast: grok-4-fast with trimmed context. Cheapest.' },
  { value: 'standard', label: 'Standard', icon: Sparkles, hint: 'Standard: grok-4-fast with full context.' },
  { value: 'thinking', label: 'Thinking', icon: Brain, hint: 'Thinking: grok-4 with full context. Deepest, ~15× the cost.' },
];

const SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 } as const;

/** Shows only the current mode; click to expand the others, pick one and it folds back. */
function ModeSwitch({ mode, onChange, compact }: { mode: ChatMode; onChange: (mode: ChatMode) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pillId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shown = open ? MODES : MODES.filter((item) => item.value === mode);

  return (
    <motion.div
      ref={ref}
      layout
      transition={SPRING}
      className={cn('flex shrink-0 items-center gap-0.5 overflow-hidden rounded-sm border p-0.5', open ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2/60')}
      style={{ borderRadius: 5 }}
      role="radiogroup"
      aria-label="Grok mode"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map(({ value, label, icon: Icon, hint }) => {
          const active = value === mode;
          return (
            <motion.button
              key={value}
              layout
              type="button"
              role="radio"
              aria-checked={active}
              title={open ? hint : `${hint} Click to change.`}
              initial={{ opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
              transition={SPRING}
              onClick={() => {
                if (!open) return setOpen(true);
                onChange(value);
                setOpen(false);
              }}
              className={cn(
                'relative flex h-6 items-center gap-1 rounded-xs px-1.5 font-mono text-[10px] tracking-[0.06em] transition-colors',
                active ? 'text-ink' : 'text-faint hover:text-ink-2',
              )}
            >
              {active ? (
                <motion.span
                  layoutId={pillId}
                  transition={SPRING}
                  className="absolute inset-0 rounded-xs bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
                />
              ) : null}
              <Icon className={cn('relative size-3', active && value === 'thinking' && 'text-ion drop-shadow-[0_0_4px_rgba(159,216,255,0.7)]')} />
              <span className={cn('relative', compact && !open ? 'sr-only' : compact ? '' : 'hidden sm:inline')}>{label}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>
      {!open ? (
        <motion.span layout="position" className="relative -ml-0.5 pr-1 text-faint" aria-hidden>
          <ChevronsUpDown className="size-2.5" />
        </motion.span>
      ) : null}
    </motion.div>
  );
}

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
    async (text: string, context: ChatContext, options: { fresh?: boolean; mode?: ChatMode } = {}) => {
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
          body: JSON.stringify({ threadId: targetThread, message: text, context: payloadContext, mode: options.mode ?? 'standard' }),
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
        let raw = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          const cut = raw.indexOf(USAGE_SEPARATOR);
          const content = cut === -1 ? raw : raw.slice(0, cut);
          setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, content } : message)));
        }
        const cut = raw.indexOf(USAGE_SEPARATOR);
        if (cut !== -1) {
          const { usage, actions } = parseTrailer(raw.slice(cut + 1));
          setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, usage, actions } : message)));
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

const THINKING_STEPS = ['Gathering context', 'Reading the numbers', 'Reasoning', 'Drafting an answer'];

/** Shown while Grok works before its first words arrive: orbiting arc, shimmering status, elapsed time. */
function Thinking() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);
  const step = THINKING_STEPS[Math.min(THINKING_STEPS.length - 1, Math.floor(elapsed / 3))];
  return (
    <div className="flex items-center gap-3 py-1.5" role="status" aria-live="polite">
      <ThinkingOrb size={36} />
      <AnimatePresence mode="wait">
        <motion.span
          key={step}
          className="thinking-shimmer text-[12.5px] font-medium"
          initial={{ opacity: 0, y: 4, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }}
          transition={{ duration: 0.25 }}
        >
          {step}…
        </motion.span>
      </AnimatePresence>
      <span className="num font-mono text-[10.5px] text-faint">{elapsed}s</span>
    </div>
  );
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
        <span className={cn('size-1.5 rounded-full', message.pending ? 'animate-pulse-dot bg-ion shadow-[0_0_8px_var(--color-ion)]' : 'bg-brand')} />
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted">GROK</span>
        {message.pending && message.content ? <span className="thinking-shimmer font-mono text-[9.5px] tracking-[0.14em] uppercase">· writing</span> : null}
      </div>
      {message.content ? (
        <div className={cn('prose-rn', message.pending && 'streaming-caret')} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      ) : message.pending ? (
        <Thinking />
      ) : null}
      {message.actions?.map((action) => <ActionCard key={action.id} action={action} />)}
      <AnimatePresence>
        {message.usage && !message.pending ? (
          <motion.div
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="num mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.06em] text-faint"
            title={`${message.usage.input.toLocaleString()} input · ${message.usage.output.toLocaleString()} output tokens`}
          >
            <span>{formatTokens(message.usage.input)} in</span>
            <span className="text-line-strong">·</span>
            <span>{formatTokens(message.usage.output)} out</span>
            {message.usage.cost !== null ? (
              <>
                <span className="text-line-strong">·</span>
                <span className="text-muted">{formatCost(message.usage.cost)}</span>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
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

export function Composer({
  onSend,
  onStop,
  streaming,
  placeholder,
  autoFocus,
  draft,
  mode,
  onModeChange,
  compactModes,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  draft?: Draft | null;
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  compactModes?: boolean;
}) {
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
        {mode && onModeChange ? <ModeSwitch mode={mode} onChange={onModeChange} compact={compactModes} /> : null}
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
