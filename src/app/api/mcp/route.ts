/**
 * The TwigList MCP endpoint: https://<site>/api/mcp, Streamable HTTP, stateless (one server per request,
 * which suits serverless hosting). Needs an OAuth access token issued by TwigList itself (see /oauth/authorize);
 * without one, the 401 tells the client where to start (RFC 9728).
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { cloudConfigured } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { CORS, corsJson, limited, originOf, preflight } from '@/lib/server/http';
import { checkAccessToken } from '@/lib/server/oauth';
import { createMcpServer } from '@/lib/mcp/server';

async function handle(req: Request) {
  if (!cloudConfigured()) return corsJson({ error: 'cloud_not_configured' }, 503);
  const origin = originOf(req);
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  const db = await getDb();
  const who = m ? await checkAccessToken(db, m[1]) : null;
  if (!who) {
    const meta = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
    return corsJson({ error: 'unauthorized', error_description: 'Sign in to TwigList to use this server.' }, 401, {
      'www-authenticate': `Bearer resource_metadata="${meta}"${m ? ', error="invalid_token"' : ''}, scope="trees"`,
    });
  }
  if (limited(`mcp:${who.uid}`)) return corsJson({ error: 'too_many_requests' }, 429);

  const server = createMcpServer(db, who.uid);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req, { authInfo: { token: m![1], clientId: who.clientId, scopes: [who.scope], expiresAt: who.expiresAt } });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    // Never log tool arguments or results: they contain the user's titles and notes.
    console.error('[mcp] unexpected error', (e as Error)?.name, (e as Error)?.message?.slice(0, 200));
    return corsJson({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, 500);
  } finally {
    void server.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
