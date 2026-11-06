/**
 * Behind the consent page /oauth/authorize.
 * GET: check the request and say who's asking (app name, where it sends you back).
 * POST: the signed-in user allows it → a one-time code, and the URL to send the browser back to.
 */
import { cloudConfigured } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { authed, json, originOf } from '@/lib/server/http';
import { checkAuthRequest, issueCode, OAuthError, type AuthRequest } from '@/lib/server/oauth';
import { touchUser } from '@/lib/server/store';

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];
const paramsOf = (src: URLSearchParams | Record<string, unknown>) =>
  Object.fromEntries(PARAMS.map((k) => [k, src instanceof URLSearchParams ? src.get(k) : typeof src[k] === 'string' ? (src[k] as string) : null]));

/** Where to send the browser for an OAuth error that the client should hear about. */
function errorRedirect(redirectUri: string, state: string | null | undefined, error: string, description: string) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

async function check(req: Request, q: Record<string, string | null>): Promise<{ ok: AuthRequest } | { res: Response }> {
  try {
    return { ok: await checkAuthRequest(await getDb(), q, `${originOf(req)}/api/mcp`) };
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    const back = (e as OAuthError & { redirectUri?: string; state?: string | null }).redirectUri;
    if (back) return { res: json({ redirect: errorRedirect(back, (e as { state?: string | null }).state, e.error, e.description) }) };
    return { res: json({ error: e.error, error_description: e.description }, 400) };
  }
}

export async function GET(req: Request) {
  if (!cloudConfigured()) return json({ error: 'unavailable', error_description: 'Accounts aren’t set up on this server.' }, 503);
  const c = await check(req, paramsOf(new URL(req.url).searchParams));
  if ('res' in c) return c.res;
  const r = c.ok;
  return json({
    clientName: r.clientName,
    redirectHost: new URL(r.redirectUri).host,
    deny: errorRedirect(r.redirectUri, r.state, 'access_denied', 'The user didn’t allow access.'),
  });
}

export const POST = authed(async ({ req, caller, db }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const c = await check(req, paramsOf(body));
  if ('res' in c) return c.res;
  await touchUser(db, caller);
  return json({ redirect: await issueCode(db, c.ok, caller.uid) });
});
