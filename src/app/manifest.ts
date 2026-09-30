import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SilverNote',
    short_name: 'SilverNote',
    description: 'Personal investment research workstation.',
    start_url: '/',
    display: 'standalone',
    background_color: '#060708',
    theme_color: '#060708',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Portfolio', url: '/portfolio' },
      { name: 'Calendar', url: '/calendar' },
      { name: 'Terminal', url: '/terminal' },
    ],
  };
}
