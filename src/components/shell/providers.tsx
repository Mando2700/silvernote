'use client';

import { MotionConfig } from 'motion/react';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import useSWR, { SWRConfig } from 'swr';

import { api, ApiError, fetcher } from '@/lib/client';
import { MARKET_PALETTES } from '@/lib/theme';

export type Preferences = {
  marketColors: 'red-green' | 'blue-orange';
  motion: 'system' | 'full' | 'reduced';
  benchmark: string;
  riskFreeRate: number | null;
  aiModel: string | null;
  /** Compact tightens spacing app-wide for more information per screen. */
  density: 'comfortable' | 'compact';
  /** Currency portfolio totals are also shown in (holdings stay in their trading currency). */
  baseCurrency: string;
  /** Which tax rules the Tax tab applies. */
  taxJurisdiction: 'US' | 'PL';
};

const DEFAULT_PREFS: Preferences = {
  marketColors: 'red-green',
  motion: 'system',
  benchmark: 'SPY',
  riskFreeRate: null,
  aiModel: null,
  density: 'comfortable',
  baseCurrency: 'USD',
  taxJurisdiction: 'US',
};

type AssistantContextValue =
  | { type: 'company'; symbol: string; name?: string }
  | { type: 'portfolio'; id: string; name?: string }
  | { type: 'general' };

type ShellState = {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** The navigation drawer on narrow screens. */
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  assistantContext: AssistantContextValue;
  setAssistantContext: (context: AssistantContextValue) => void;
  /** Open the assistant with a prompt prepared in the composer (the user sends it). */
  askAssistant: (prompt: string, context?: AssistantContextValue) => void;
  /** The latest prepared prompt; `id` changes with each request. */
  pendingPrompt: { id: number; text: string } | null;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => Promise<void>;
};

const ShellContext = createContext<ShellState | null>(null);

export function useShell() {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside <Providers>');
  return value;
}

/** Gain/loss colors for canvas and d3 code; CSS reads the same pair from --color-gain/--color-loss. */
export function useMarketColors() {
  const { prefs } = useShell();
  return MARKET_PALETTES[prefs.marketColors] ?? MARKET_PALETTES['red-green'];
}

function ShellProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantContext, setAssistantContext] = useState<AssistantContextValue>({ type: 'general' });
  const [pendingPrompt, setPendingPrompt] = useState<{ id: number; text: string } | null>(null);
  // The sign-in page and shared portfolio links are visited without a session, so there is nothing to load there.
  const pathname = usePathname();
  const { data, mutate } = useSWR<Preferences>(pathname?.startsWith('/login') || pathname?.startsWith('/s/') ? null : '/api/settings');
  const prefs = useMemo(() => ({ ...DEFAULT_PREFS, ...(data ?? {}) }), [data]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.market = prefs.marketColors;
    root.dataset.motion = prefs.motion;
    root.dataset.density = prefs.density;
  }, [prefs.marketColors, prefs.motion, prefs.density]);

  // Close the drawer whenever the route changes. Adjusting state during render keeps it in step with the URL.
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    if (navOpen) setNavOpen(false);
  }

  // Many buttons fire `void save()`-style handlers; when one of their API calls fails and nothing
  // catches it, show the server's message instead of failing silently.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof ApiError)) return;
      event.preventDefault();
      if (event.reason.status !== 401) toast.error(event.reason.message || 'Request failed.');
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  const updatePrefs = useCallback(
    async (patch: Partial<Preferences>) => {
      await mutate(async (current) => ({ ...DEFAULT_PREFS, ...current, ...(await api<Preferences>('/api/settings', { method: 'PUT', body: patch })) }), {
        optimisticData: (current) => ({ ...DEFAULT_PREFS, ...current, ...patch }),
        revalidate: false,
      });
    },
    [mutate],
  );

  const askAssistant = useCallback((prompt: string, context?: AssistantContextValue) => {
    if (context) setAssistantContext(context);
    setPendingPrompt({ id: Date.now(), text: prompt });
    setAssistantOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      navOpen,
      setNavOpen,
      assistantOpen,
      setAssistantOpen,
      assistantContext,
      setAssistantContext,
      askAssistant,
      pendingPrompt,
      prefs,
      updatePrefs,
    }),
    [paletteOpen, navOpen, assistantOpen, assistantContext, askAssistant, pendingPrompt, prefs, updatePrefs],
  );

  const reducedMotion = prefs.motion === 'reduced' ? 'always' : prefs.motion === 'full' ? 'never' : 'user';

  return (
    <ShellContext.Provider value={value}>
      <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
    </ShellContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, dedupingInterval: 4000, errorRetryCount: 2, keepPreviousData: true }}>
      <ShellProvider>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent), rgba(21,24,29,0.88)',
              backdropFilter: 'blur(14px) saturate(1.4)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 50px -18px rgba(0,0,0,0.9), 0 0 24px -12px rgba(159,216,255,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
              color: '#eceef1',
              fontSize: '13px',
            },
          }}
        />
      </ShellProvider>
    </SWRConfig>
  );
}
