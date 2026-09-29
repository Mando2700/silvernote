'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Composer, contextLabel, MessageList, quickActions, useChat, useChatMode, type ChatContext, type Draft } from '@/components/assistant/chat';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { formatCost, formatTokens, type ChatMode } from '@/lib/ai/pricing';
import { api } from '@/lib/client';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/components/shell/keep-alive';

type Thread = { id: string; title: string; context: ChatContext; updated_at: string };

export function AssistantPage({ configured, models }: { configured: boolean; models: Record<ChatMode, string> }) {
  const [mode, setMode] = useChatMode();
  const model = models[mode];
  const router = useRouter();
  const params = useSearchParams();
  const threadParam = params.get('thread');
  const { data: threads, mutate } = useSWR<Thread[]>('/api/ai/threads');
  const { data: lifetime, mutate: refreshLifetime } = useSWR<{ input: number; output: number; cost: number }>('/api/ai/usage');
  const chat = useChat();
  const [draft, setDraft] = useState<Draft | null>(null);
  // An explicit choice applies to the thread it was made in; otherwise use the thread's saved context.
  const [choice, setChoice] = useState<{ thread: string | null; context: ChatContext } | null>(null);
  const { load } = chat;

  useEffect(() => {
    void load(threadParam);
  }, [threadParam, load]);

  const savedContext = threads?.find((item) => item.id === threadParam)?.context;
  const context: ChatContext = (choice && choice.thread === threadParam ? choice.context : savedContext) ?? { type: 'general' };
  const setContext = (next: ChatContext) => setChoice({ thread: threadParam, context: next });

  useEffect(() => {
    if (chat.threadId && chat.threadId !== threadParam) router.replace(`/assistant?thread=${chat.threadId}`, { scroll: false });
  }, [chat.threadId, threadParam, router]);

  // Refresh the all-time total once each answer finishes streaming.
  const { streaming } = chat;
  useEffect(() => {
    if (!streaming) void refreshLifetime();
  }, [streaming, refreshLifetime]);

  const label = contextLabel(context);
  const totals = chat.messages.reduce(
    (sum, message) => (message.usage ? { tokens: sum.tokens + message.usage.input + message.usage.output, cost: sum.cost + (message.usage.cost ?? 0) } : sum),
    { tokens: 0, cost: 0 },
  );

  return (
    <Page
      kicker={`xAI · ${model}`}
      title="Grok"
      description={
        <span className="num flex h-4 items-center gap-2 font-mono text-[11px] tracking-[0.04em] text-faint" title={lifetime ? `${lifetime.input.toLocaleString()} input · ${lifetime.output.toLocaleString()} output tokens` : undefined}>
          {lifetime ? (
            <>
              <span>{formatTokens(lifetime.input + lifetime.output)} tokens</span>
              <span className="text-line-strong">·</span>
              <span className="text-ink-2">{formatCost(lifetime.cost)}</span>
              <span className="text-faint">all time</span>
            </>
          ) : null}
        </span>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="flex h-[calc(100dvh-170px)] min-h-[480px] flex-col">
          <Button
            className="w-full justify-start"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setContext({ type: 'general' });
              router.replace('/assistant');
              chat.reset();
            }}
          >
            New conversation
          </Button>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {threads?.map((thread) => (
              <div key={thread.id} className={cn('group flex items-center rounded-sm', thread.id === chat.threadId ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]')}>
                <button onClick={() => router.replace(`/assistant?thread=${thread.id}`)} className={cn('min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-[12.5px]', thread.id === chat.threadId ? 'text-ink' : 'text-muted hover:text-ink-2')} title={relativeTime(thread.updated_at)}>
                  {thread.title}
                </button>
                <button
                  onClick={async () => {
                    await api(`/api/ai/threads/${thread.id}`, { method: 'DELETE' });
                    if (thread.id === chat.threadId) {
                      router.replace('/assistant');
                      chat.reset();
                    }
                    void mutate();
                  }}
                  className="mr-1 rounded-xs p-1 text-faint opacity-0 group-hover:opacity-100 hover:text-ink"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>
        {/* On desktop the chat column rises beside the page header (-96px) and runs to the viewport's bottom edge. */}
        <section className="relative h-[calc(100dvh-170px)] min-h-[480px] lg:-mt-[96px] lg:-mb-5 lg:h-[calc(100dvh-72px)]">
          {context.type !== 'general' || !configured ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2">
              {context.type !== 'general' ? (
                <Badge tone="outline" className="pointer-events-auto gap-1.5 bg-surface-1/90 backdrop-blur">
                  {label.icon}
                  {label.text}
                </Badge>
              ) : null}
              {!configured ? <Badge tone="warning">XAI_API_KEY not set</Badge> : null}
            </div>
          ) : null}
          {/* Messages fill the column; the composer floats over the bottom so text scrolls beneath it. */}
          <div className="absolute inset-0 scroll-pb-36 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_28px,black_calc(100%-16px),transparent)]">
            {chat.messages.length ? (
              <>
                <MessageList messages={chat.messages} className="mx-auto max-w-5xl pt-6" />
                <div className="h-36" aria-hidden />
              </>
            ) : (
              <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-5 pb-28">
                <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">What are we researching?</h2>
                <div className="flex flex-wrap justify-center gap-2">
                  {quickActions(context).map((action) => (
                    <button
                      key={action.label}
                      onClick={() => setDraft({ id: Date.now(), text: action.prompt })}
                      className="rounded-full border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pb-3">
            <div className="pointer-events-auto mx-auto w-full max-w-5xl">
            <Composer
              onSend={(text) => void chat.send(text, context, { mode })}
              onStop={chat.stop}
              streaming={chat.streaming}
              autoFocus
              draft={draft}
              mode={mode}
              onModeChange={setMode}
            />
            {totals.tokens ? (
              <div className="num mt-1.5 ml-auto flex h-5 w-fit items-center gap-2 rounded-sm bg-bg/80 px-2 font-mono text-[10px] tracking-[0.06em] text-faint backdrop-blur">
                <>
                  <span>Conversation · {formatTokens(totals.tokens)} tokens</span>
                  <span className="text-line-strong">·</span>
                  <span className="text-muted">{formatCost(totals.cost)}</span>
                </>
              </div>
            ) : null}
            </div>
          </div>
        </section>
      </div>
    </Page>
  );
}
