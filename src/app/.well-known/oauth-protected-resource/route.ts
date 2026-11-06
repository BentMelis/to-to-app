import { connection } from 'next/server';
import { corsJson, originOf, preflight } from '@/lib/server/http';

/** RFC 9728: which authorization server protects the MCP endpoint. */
export async function GET(req: Request) {
  await connection();
  const origin = originOf(req);
  return corsJson({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['trees'],
    bearer_methods_supported: ['header'],
    resource_name: 'TwigList',
    resource_documentation: `${origin}/`,
  });
}
export const OPTIONS = preflight;
