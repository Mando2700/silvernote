import 'server-only';

import { NextResponse } from 'next/server';
import { z, type ZodType } from 'zod';

import { HttpError, requireUser, type SessionUser } from '@/lib/auth';
import { ProviderError } from '@/lib/data/http';
import { startScheduler } from '@/lib/jobs';

type Context<P> = { params: Promise<P> };

/**
 * Route handler wrapper: requires the signed-in owner, converts thrown errors into JSON responses,
 * and makes sure the background data scheduler is running.
 */
export function route<P = Record<string, string>>(
  fn: (input: { request: Request; user: SessionUser; params: P }) => Promise<unknown>,
) {
  return async (request: Request, context: Context<P>) => {
    try {
      startScheduler();
      const user = await requireUser();
      const params = (await context.params) ?? ({} as P);
      const result = await fn({ request, user, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400 });
  }
  if (error instanceof ProviderError) {
    return NextResponse.json({ error: `Data source unavailable (${error.provider}). ${error.message}` }, { status: 502 });
  }
  console.error('[silvernote] request failed:', error);
  return NextResponse.json({ error: (error as Error)?.message ?? 'Something went wrong.' }, { status: 500 });
}

export async function body<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body.');
  }
  return schema.parse(json);
}

export function searchParam(request: Request, key: string) {
  return new URL(request.url).searchParams.get(key);
}

export function notFound(message = 'Not found.'): never {
  throw new HttpError(404, message);
}

export const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z0-9.\-]+$/.test(value), 'Invalid ticker');
