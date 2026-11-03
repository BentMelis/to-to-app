/** Calls to the Trees API with the user's Firebase ID token. */
import { idToken } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
/** The request didn't reach the server (offline, DNS, timeout). */
export class OfflineError extends Error {}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const token = await idToken();
  if (!token) throw new ApiError(401, 'signed_out');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
    });
  } catch {
    throw new OfflineError('offline');
  } finally {
    clearTimeout(t);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? res.status), data);
  return data as T;
}
