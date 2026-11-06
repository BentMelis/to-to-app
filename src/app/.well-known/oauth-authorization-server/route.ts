import { connection } from 'next/server';
import { corsJson, originOf, preflight } from '@/lib/server/http';

/** RFC 8414: TwigList's own small OAuth server, used by MCP clients to connect. */
export async function GET(req: Request) {
  await connection();
  const o = originOf(req);
  return corsJson({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    registration_endpoint: `${o}/api/oauth/register`,
    revocation_endpoint: `${o}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['trees'],
    service_documentation: `${o}/`,
  });
}
export const OPTIONS = preflight;
