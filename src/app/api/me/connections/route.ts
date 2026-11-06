import { authed, json } from '@/lib/server/http';
import { disconnect, listConnections } from '@/lib/server/oauth';

/** Apps connected to this account through MCP, e.g. Claude. */
export const GET = authed(async ({ caller, db }) => json({ connections: await listConnections(db, caller.uid) }));

/** Disconnect one: `?client=<client id>`. Its tokens stop working immediately. */
export const DELETE = authed(async ({ req, caller, db }) => {
  const client = new URL(req.url).searchParams.get('client');
  if (!client) return json({ error: 'missing_client' }, 400);
  return json({ ok: true, revoked: await disconnect(db, caller.uid, client) });
});
