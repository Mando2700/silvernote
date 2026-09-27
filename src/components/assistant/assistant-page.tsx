'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Composer, contextLabel, MessageList, quickActions, useChat, type ChatContext, type Draft } from '@/components/assistant/chat';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { api } from '@/lib/client';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Thread = { id: string; title: string; context: ChatContext; updated_at: string };

export function AssistantPage({ configured, model }: { configured: boolean; model: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const threadParam = params.get('thread');
  const { data: threads, mutate } = useSWR<Thread[]>('/api/ai/threads');
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

  const label = contextLabel(context);

  return (
    <Page kicker={`xAI · ${model}`} title="Grok">
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
        <section className="flex h-[calc(100dvh-170px)] min-h-[480px] flex-col">
          {context.type !== 'general' || !configured ? (
            <div className="flex items-center justify-center gap-2 pb-2">
              {context.type !== 'general' ? (
                <Badge tone="outline" className="gap-1.5">
                  {label.icon}
                  {label.text}
                </Badge>
              ) : null}
              {!configured ? <Badge tone="warning">XAI_API_KEY not set</Badge> : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chat.messages.length ? (
              <MessageList messages={chat.messages} className="mx-auto max-w-3xl py-4" />
            ) : (
              <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-5">
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
          <div className="mx-auto w-full max-w-3xl pt-2">
            <Composer onSend={(text) => void chat.send(text, context)} onStop={chat.stop} streaming={chat.streaming} autoFocus draft={draft} />
          </div>
        </section>
      </div>
    </Page>
  );
}
