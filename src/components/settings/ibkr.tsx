'use client';

import { ArrowUpRight, Link2, RefreshCw, Unlink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Badge, Field, Input, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { relativeTime } from '@/lib/format';

type Status =
  | { connected: false }
  | {
      connected: true;
      status: 'pending' | 'ok' | 'error';
      error: string | null;
      message: string | null;
      queryId: string;
      tokenHint: string;
      lastSyncedAt: string | null;
      lastAttemptAt: string | null;
      syncing: boolean;
      accounts: Array<{ accountId: string; portfolioId: string; portfolioName: string }>;
    };

const STEPS = [
  <>
    Log in to IBKR and open <b className="font-medium text-ink">Performance &amp; Reports → Flex Queries</b>.
  </>,
  <>
    Under <b className="font-medium text-ink">Activity Flex Query</b>, press <b className="font-medium text-ink">+</b>. Tick <b className="font-medium text-ink">Trades</b>, <b className="font-medium text-ink">Open Positions</b> and <b className="font-medium text-ink">Cash Report</b> (Select All in each), keep Format <b className="font-medium text-ink">XML</b>, set Period to <b className="font-medium text-ink">Last 365 Calendar Days</b> and save. Copy its <b className="font-medium text-ink">Query ID</b>.
  </>,
  <>
    Open <b className="font-medium text-ink">Flex Web Service Configuration</b> (gear icon on the same page), turn it on and generate a token with the longest expiry. Copy it.
  </>,
];

export function IbkrPanel() {
  const { data, mutate } = useSWR<Status>('/api/brokers/ibkr', { refreshInterval: (latest) => (latest?.connected && latest.syncing ? 2000 : 60_000) });
  const [token, setToken] = useState('');
  const [queryId, setQueryId] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [editing, setEditing] = useState(false);

  const connected = data?.connected ? data : null;
  const showForm = data && (!connected || editing);

  const connect = async () => {
    setBusy('connect');
    try {
      const response = await api<{ status: Status }>('/api/brokers/ibkr', { body: { token, queryId: queryId || (connected?.queryId ?? '') } });
      await mutate(response.status, { revalidate: false });
      setToken('');
      setEditing(false);
      toast.success('Interactive Brokers connected');
      void revalidate('/api/portfolios', '/api/dashboard');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const response = await api<{ status: Status }>('/api/brokers/ibkr/sync', { body: {} });
      await mutate(response.status, { revalidate: false });
      toast.success('Synced with Interactive Brokers');
      void revalidate('/api/portfolios', '/api/dashboard');
    } catch (error) {
      toast.error((error as Error).message);
      void mutate();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Interactive Brokers? Synced portfolios and trades stay; automatic syncing stops.')) return;
    setBusy('disconnect');
    try {
      await api('/api/brokers/ibkr', { method: 'DELETE' });
      await mutate({ connected: false }, { revalidate: false });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <PanelHeader
        kicker="Brokerage"
        title="Interactive Brokers"
        actions={
          connected ? (
            connected.syncing || busy === 'sync' ? (
              <Badge tone="brand">Syncing</Badge>
            ) : connected.status === 'error' ? (
              <Badge tone="loss">Needs attention</Badge>
            ) : (
              <Badge tone="gain">Connected</Badge>
            )
          ) : data ? (
            <Badge tone="outline">Not connected</Badge>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-5">
        {!data ? <Skeleton className="h-28" /> : null}

        {connected ? (
          <div className="flex flex-col gap-3">
            {connected.accounts.length ? (
              <div className="flex flex-col gap-1">
                {connected.accounts.map((account) => (
                  <Link key={account.accountId} href={`/portfolio?id=${account.portfolioId}`} className="group flex items-center justify-between rounded-sm border border-line px-3 py-2 text-[12.5px] hover:border-line-strong">
                    <span className="text-ink">
                      {account.portfolioName} <span className="font-mono text-[11.5px] text-faint">{account.accountId}</span>
                    </span>
                    <ArrowUpRight className="size-3.5 text-faint group-hover:text-ink" />
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="text-[11.5px] text-muted">
              {connected.lastSyncedAt ? `Last synced ${relativeTime(connected.lastSyncedAt)}` : 'Not synced yet'}
              {connected.message ? ` · ${connected.message}` : ''}
              <div className="mt-0.5 text-faint">
                Syncs automatically every 4 hours · query {connected.queryId} · token {connected.tokenHint}
              </div>
            </div>
            {connected.error ? <div className={connected.status === 'error' ? 'text-[11.5px] text-loss' : 'text-[11.5px] text-warning'}>{connected.error}</div> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} loading={busy === 'sync'} disabled={Boolean(busy) || connected.syncing} onClick={() => void sync()}>
                Sync now
              </Button>
              {!editing ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  {connected.status === 'error' ? 'Update token' : 'Change token'}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" icon={<Unlink className="size-3.5" />} loading={busy === 'disconnect'} disabled={Boolean(busy)} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : null}

        {showForm ? (
          <div className="flex flex-col gap-4">
            {!connected ? (
              <p className="text-[12px] leading-relaxed text-ink-2">
                One-time setup, about two minutes. SilverNote uses IBKR’s read-only reporting token: it can’t trade or move money, you never enter your IBKR password here, and it keeps syncing without daily logins.
              </p>
            ) : null}
            <ol className="flex flex-col gap-2 text-[12px] leading-relaxed text-ink-2">
              {STEPS.map((step, index) => (
                <li key={index} className="flex gap-2.5">
                  <span className="num mt-px flex size-4.5 shrink-0 items-center justify-center rounded-full bg-surface-4 text-[10.5px] text-ink">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <a href="https://www.interactivebrokers.com/portal" target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-[12px] text-brand hover:underline">
              Open IBKR Client Portal <ArrowUpRight className="size-3" />
            </a>
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <Field label="Flex token">
                <Input value={token} onChange={(event) => setToken(event.target.value.replace(/\s/g, ''))} placeholder="Paste token" autoComplete="off" spellCheck={false} className="font-mono" />
              </Field>
              <Field label="Query ID">
                <Input value={queryId || (editing && connected ? connected.queryId : '')} onChange={(event) => setQueryId(event.target.value.replace(/\s/g, ''))} placeholder="e.g. 123456" inputMode="numeric" autoComplete="off" className="font-mono" />
              </Field>
              <Button type="submit" variant="primary" size="md" icon={<Link2 className="size-3.5" />} loading={busy === 'connect'} disabled={!token || !(queryId || connected?.queryId) || Boolean(busy)}>
                {busy === 'connect' ? 'Fetching…' : connected ? 'Save' : 'Connect'}
              </Button>
            </form>
            {busy === 'connect' ? <div className="text-[11.5px] text-muted">IBKR is generating your statement — this usually takes 5–30 seconds.</div> : null}
            {editing ? (
              <Button size="xs" variant="ghost" className="w-fit" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
