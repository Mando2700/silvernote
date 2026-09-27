'use client';

import { mutate } from 'swr';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parse(response: Response) {
  if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    // A full navigation (not router.push) so the auth proxy handles the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, data?.error ?? response.statusText);
  return data;
}

export async function fetcher<T = unknown>(url: string): Promise<T> {
  return parse(await fetch(url, { headers: { Accept: 'application/json' } }));
}

export async function api<T = unknown>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return parse(response);
}

/** Revalidate every SWR key that starts with one of the prefixes. */
export function revalidate(...prefixes: string[]) {
  return mutate((key) => typeof key === 'string' && prefixes.some((prefix) => key.startsWith(prefix)));
}
