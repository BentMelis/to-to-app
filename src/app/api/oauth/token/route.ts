import { cloudConfigured } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { corsJson, preflight } from '@/lib/server/http';
import { OAuthError, sweepExpired, tokenRequest } from '@/lib/server/oauth';

/** Client credentials from an "Authorization: Basic …" header, if any. */
function basicAuth(req: Request) {
  const m = /^Basic\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const [id, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  return { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(':')) };
}

/** OAuth token endpoint: authorization code (+ PKCE) or refresh token → tokens. */
export async function POST(req: Request) {
  if (!cloudConfigured()) return corsJson({ error: 'temporarily_unavailable' }, 503);
  const text = await req.text();
  if (text.length > 10_000) return corsJson({ error: 'invalid_request' }, 400);
  const form = new URLSearchParams(text);
  const db = await getDb();
  try {
    const r = await tokenRequest(db, form, basicAuth(req));
    if (Math.random() < 0.05) void sweepExpired(db).catch(() => {});
    return corsJson(r, 200, { pragma: 'no-cache' });
  } catch (e) {
    if (e instanceof OAuthError) return corsJson({ error: e.error, error_description: e.description }, e.status);
    throw e;
  }
}
export const OPTIONS = preflight;
