'use client';

import { Maximize2, Plus, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Composer, contextLabel, MessageList, quickActions, useChat, useChatMode, type Draft } from '@/components/assistant/chat';
import { useShell } from '@/components/shell/providers';

/** Slide-over Grok chat that follows whatever company or portfolio is on screen. */
export function AssistantPanel() {
  const { assistantOpen, setAssistantOpen, assistantContext, pendingPrompt } = useShell();
  // The full Grok page is already on screen there; a second chat on top would only compete with it.
  const onGrokPage = usePathname()?.startsWith('/assistant') ?? false;
  useEffect(() => {
    if (onGrokPage && assistantOpen) setAssistantOpen(false);
  }, [onGrokPage, assistantOpen, setAssistantOpen]);
  const chat = useChat();
  const [mode, setMode] = useChatMode();
  const [quickDraft, setQuickDraft] = useState<Draft | null>(null);
  // Whichever was prepared last: an "Ask Grok" action elsewhere in the app, or a quick action here.
  const draft = pendingPrompt && (!quickDraft || pendingPrompt.id > quickDraft.id) ? pendingPrompt : quickDraft;
  const lastContextKey = useRef<string>('');
  const contextKey = assistantContext.type === 'company' ? `c:${assistantContext.symbol}` : assistantContext.type === 'portfolio' ? `p:${assistantContext.id}` : 'g';

  // A new subject starts a fresh conversation.
  useEffect(() => {
    if (lastContextKey.current && lastContextKey.current !== contextKey && !chat.streaming) chat.reset();
    lastContextKey.current = contextKey;
  }, [contextKey, chat]);

  // "Ask Grok" actions start a new conversation; the prepared prompt waits in the composer for the user to send.
  const pendingId = pendingPrompt?.id ?? null;
  const handledPending = useRef<number | null>(null);
  useEffect(() => {
    if (pendingId === null || handledPending.current === pendingId) return;
    handledPending.current = pendingId;
    if (!chat.streaming) chat.reset();
  }, [pendingId, chat]);

  useEffect(() => {
    if (!assistantOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAssistantOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [assistantOpen, setAssistantOpen]);

  const label = contextLabel(assistantContext);

  return (
    <AnimatePresence>
      {assistantOpen && !onGrokPage ? (
        <motion.aside
          initial={{ x: '100%', opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0.6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          className="fixed top-0 right-0 z-[75] flex h-dvh w-[min(460px,100vw)] flex-col border-l border-line-strong bg-surface-2/97 shadow-[-40px_0_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,rgba(205,212,222,0.08),transparent_70%)]" />
          <header className="relative flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="grid size-6 place-items-center rounded-[5px] bg-silver shadow-[0_0_14px_rgba(205,212,222,0.35)]">
              <Sparkles className="size-3.5 text-[#0b0c0f]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink">Grok</div>
              <div className="flex items-center gap-1 truncate text-[11px] text-muted">
                {label.icon}
                <span className="truncate">{label.text}</span>
              </div>
            </div>
            <button onClick={() => chat.reset()} className="rounded-sm p-1.5 text-muted hover:bg-white/5 hover:text-ink" title="New conversation">
              <Plus className="size-4" />
            </button>
            <Link href={chat.threadId ? `/assistant?thread=${chat.threadId}` : '/assistant'} onClick={() => setAssistantOpen(false)} className="rounded-sm p-1.5 text-muted hover:bg-white/5 hover:text-ink" title="Open full page">
              <Maximize2 className="size-4" />
            </Link>
            <button onClick={() => setAssistantOpen(false)} className="rounded-sm p-1.5 text-muted hover:bg-white/5 hover:text-ink" aria-label="Close Grok">
              <X className="size-4" />
            </button>
          </header>
          <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {chat.messages.length ? (
              <MessageList messages={chat.messages} />
            ) : (
              <div className="flex h-full flex-col justify-end gap-2">
                <p className="mb-2 text-[12.5px] leading-relaxed text-muted">
                  Grok sees what you’re looking at: filings-based statements, the SilverNote Score, your thesis, headlines and holdings. Ask, or start with:
                </p>
                {quickActions(assistantContext).map((action) => (
                  <button
                    key={action.label}
                    onClick={() => setQuickDraft({ id: Date.now(), text: action.prompt })}
                    className="rounded-sm border border-line bg-surface-1 px-3 py-2 text-left text-[12.5px] text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative border-t border-line p-3">
            <Composer
              onSend={(text) => void chat.send(text, assistantContext, { mode })}
              onStop={chat.stop}
              streaming={chat.streaming}
              autoFocus
              draft={draft}
              mode={mode}
              onModeChange={setMode}
              compactModes
            />
            <div className="mt-1.5 text-center text-[10.5px] text-faint">Enter to send · Shift+Enter for a new line · Esc to close</div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
