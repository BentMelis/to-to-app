import { cloudConfigured } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { corsJson, preflight } from '@/lib/server/http';
import { revokeToken } from '@/lib/server/oauth';

/** RFC 7009: a client gives up a token (always 200, as the RFC asks). */
export async function POST(req: Request) {
  if (!cloudConfigured()) return corsJson({ error: 'temporarily_unavailable' }, 503);
  const form = new URLSearchParams((await req.text()).slice(0, 10_000));
  const t = form.get('token');
  if (t) await revokeToken(await getDb(), t);
  return corsJson({});
}
export const OPTIONS = preflight;
