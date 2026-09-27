'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore, type ReactNode } from 'react';

import { CommandPalette } from '@/components/shell/command-palette';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

const AssistantPanel = dynamic(() => import('@/components/assistant/assistant-panel').then((module) => module.AssistantPanel), { ssr: false });

const SIDEBAR_KEY = 'silvernote.sidebar';
const sidebarListeners = new Set<() => void>();
let sidebarFallback = false; // used when localStorage is unavailable

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    sidebarListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readSidebar() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return sidebarFallback;
  }
}

function writeSidebar(collapsed: boolean) {
  sidebarFallback = collapsed;
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // storage unavailable: the in-memory fallback carries the value
  }
  for (const listener of sidebarListeners) listener();
}

export function AppShell({ user, children }: { user: { email: string | null; local: boolean }; children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const toggle = () => writeSidebar(!collapsed);

  return (
    <div className="relative flex min-h-dvh">
      <div className="grid-backdrop pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div
        className="pointer-events-none fixed -top-40 left-1/3 z-0 h-80 w-[640px] rounded-full bg-brand/10 blur-[120px]"
        aria-hidden
      />
      <Sidebar collapsed={collapsed} onToggle={toggle} user={user} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-5 py-5">{children}</main>
      </div>
      <CommandPalette />
      <AssistantPanel />
    </div>
  );
}
