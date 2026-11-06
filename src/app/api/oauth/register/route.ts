import { cloudConfigured } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { corsJson, limited, preflight } from '@/lib/server/http';
import { OAuthError, registerClient } from '@/lib/server/oauth';

/** RFC 7591 dynamic client registration: MCP clients (e.g. Claude) register themselves. */
export async function POST(req: Request) {
  if (!cloudConfigured()) return corsJson({ error: 'temporarily_unavailable' }, 503);
  if (limited(`register:${req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`)) return corsJson({ error: 'too_many_requests' }, 429);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 10_000) throw new Error('too large');
    body = JSON.parse(text);
  } catch {
    return corsJson({ error: 'invalid_client_metadata', error_description: 'Send the client metadata as JSON.' }, 400);
  }
  try {
    return corsJson(await registerClient(await getDb(), body), 201);
  } catch (e) {
    if (e instanceof OAuthError) return corsJson({ error: e.error, error_description: e.description }, e.status);
    throw e;
  }
}
export const OPTIONS = preflight;
