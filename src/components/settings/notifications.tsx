'use client';

import { BellRing, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Badge, Input, Panel, PanelHeader, Switch } from '@/components/ui/primitives';
import { api } from '@/lib/client';

type Channels = { push: boolean; telegram: boolean; vapidPublicKey: string | null };

function base64ToUint8Array(base64: string) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Push (this browser/phone), Telegram, and which scheduled briefs to send. */
export function NotificationsPanel() {
  const { prefs, updatePrefs } = useShell();
  const { data: channels } = useSWR<Channels>('/api/notifications/test');
  const [busy, setBusy] = useState<string | null>(null);
  const notify = prefs.notify ?? {};
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

  const set = async (patch: NonNullable<typeof prefs.notify>) => {
    await updatePrefs({ notify: { ...notify, ...patch } });
  };

  const enablePush = async () => {
    if (!channels?.vapidPublicKey) return;
    setBusy('push');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications are blocked for this site in the browser settings.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToUint8Array(channels.vapidPublicKey) }));
      await api('/api/notifications/subscribe', { body: subscription.toJSON() });
      await set({ push: true });
      toast.success('Push notifications are on for this device.');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const result = await api<{ push: number; telegram: boolean }>('/api/notifications/test', { body: {} });
      toast.success(`Sent: ${result.push} push device(s)${result.telegram ? ', Telegram' : ''}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <PanelHeader kicker="Alerts & briefs" title="Notifications" actions={<Button size="xs" variant="outline" icon={<Send className="size-3" />} loading={busy === 'test'} onClick={() => void test()}>Send test</Button>} />
      <div className="flex flex-col gap-4 px-4 pb-5 text-[12.5px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-medium text-ink">
              Push to this device {channels?.push ? <Badge tone="gain">Server ready</Badge> : <Badge tone="warning">Needs VAPID keys</Badge>}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
              {channels?.push
                ? 'Alerts, the morning brief and weekly red team arrive as notifications. On iPhone, first add SilverNote to the Home Screen (Share → Add to Home Screen), then enable here from the installed app.'
                : 'Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) on the server.'}
            </p>
          </div>
          <Button size="sm" variant="primary" icon={<BellRing className="size-3.5" />} disabled={!channels?.push || !supported} loading={busy === 'push'} onClick={() => void enablePush()}>
            Enable
          </Button>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-medium text-ink">
              Telegram {channels?.telegram ? <Badge tone="gain">Connected</Badge> : <Badge tone="outline">Not set</Badge>}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server to also get everything in a Telegram chat.</p>
          </div>
          <Switch checked={notify.telegram !== false} onChange={(value) => void set({ telegram: value })} label="Telegram" />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
          <div>
            <div className="font-medium text-ink">Morning brief</div>
            <p className="text-[11.5px] text-muted">Weekdays around 7:30 New York time, before the open.</p>
          </div>
          <Switch checked={notify.morningBrief !== false} onChange={(value) => void set({ morningBrief: value })} label="Morning brief" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium text-ink">Weekly thesis red team</div>
            <p className="text-[11.5px] text-muted">Sundays: Grok attacks your most recently edited theses.</p>
          </div>
          <Switch checked={notify.weeklyRedTeam !== false} onChange={(value) => void set({ weeklyRedTeam: value })} label="Weekly red team" />
        </div>
        <MacroTapeRow />
      </div>
    </Panel>
  );
}

function MacroTapeRow() {
  const { prefs, updatePrefs } = useShell();
  const [value, setValue] = useState((prefs.macroTape ?? []).join(', '));
  const save = async () => {
    const symbols = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 16);
    await updatePrefs({ macroTape: symbols });
    toast.success(symbols.length ? 'Macro tape updated' : 'Macro tape reset to default');
  };
  return (
    <div className="border-t border-line pt-3">
      <div className="font-medium text-ink">Dashboard macro tape</div>
      <p className="mb-2 text-[11.5px] text-muted">Yahoo symbols, e.g. ^VIX, ^TNX, DX-Y.NYB, CL=F, GC=F, BTC-USD, EURUSD=X, USDPLN=X, ^STOXX50E, WIG20.WA. Leave empty for the default.</p>
      <div className="flex gap-2">
        <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="^VIX, ^TNX, DX-Y.NYB, CL=F, GC=F, BTC-USD, EURUSD=X" />
        <Button onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}
