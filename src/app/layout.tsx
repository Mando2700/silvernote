import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import { Providers } from '@/components/shell/providers';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SilverNote', template: '%s · SilverNote' },
  description: 'Personal investment research workstation.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#060708',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} data-market="red-green" suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
