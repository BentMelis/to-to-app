/**
 * Shared plumbing for the API route handlers: sign-in check, rate limit, JSON bodies and errors.
 * Errors never echo tree content.
 */
import type { Db } from 'mongodb';
import { cloudConfigured } from './config';
import { callerFrom, type Caller } from './auth';
import { getDb } from './db';
import { StoreError } from './store';
import { MAX_DOC_BYTES } from '@/lib/cloud/types';

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const fail = (status: number, error: string, extra?: object) => json({ error, ...extra }, status);

/* Per-user rate limit (per server instance). Autosave is debounced; this only stops loops. */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 240;
const hits = new Map<string, { start: number; n: number }>();
function limited(uid: string) {
  const now = Date.now();
  const h = hits.get(uid);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(uid, { start: now, n: 1 });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
    return false;
  }
  return ++h.n > MAX_REQUESTS;
}

/** Read a JSON body of at most MAX_DOC_BYTES (+ a little for the envelope). */
export async function body<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > MAX_DOC_BYTES + 10_000) throw new StoreError(400, 'too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new StoreError(400, 'invalid_json');
  }
}

type Handler = (ctx: { req: Request; caller: Caller; db: Db }) => Promise<Response>;

/** Wraps a route handler: 503 when cloud isn't configured, 401 without a valid sign-in, 429 when flooding. */
export function authed(fn: Handler) {
  return async (req: Request) => {
    if (!cloudConfigured()) return fail(503, 'cloud_not_configured');
    const caller = await callerFrom(req);
    if (!caller) return fail(401, 'unauthorized');
    if (limited(caller.uid)) return fail(429, 'too_many_requests');
    try {
      return await fn({ req, caller, db: await getDb() });
    } catch (e) {
      if (e instanceof StoreError) return fail(e.status, e.code, e.current ? { current: e.current } : undefined);
      // Only the error type: never the request body or tree content.
      console.error('[api] unexpected error', (e as Error)?.name, (e as Error)?.message?.slice(0, 200));
      return fail(500, 'server_error');
    }
  };
}
