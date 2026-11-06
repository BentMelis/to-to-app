/**
 * OAuth 2.1 for the MCP server, so Claude (claude.ai, Cowork, Claude Code) and other MCP clients can
 * act for a signed-in TwigList user without ever seeing a password.
 *
 * TwigList is its own small authorization server:
 * - clients register themselves (dynamic client registration, RFC 7591);
 * - the user approves on /oauth/authorize, signed in with Firebase as in the app;
 * - authorization code + PKCE (S256 only) → access token (1 hour) + refresh token (30 days, rotated on use).
 *
 * Tokens are random strings; only their SHA-256 hashes are stored. Collections: `oauth_clients`, `oauth_codes`,
 * `oauth_tokens`. A "grant" is one client's access for one user: disconnecting deletes all its tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from 'mongodb';

export const SCOPE = 'trees';
const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 86_400_000;

export class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
    public status = 400,
  ) {
    super(error);
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

interface ClientRow {
  _id: string;
  name: string;
  redirectUris: string[];
  /** Confidential clients only (client_secret_post / _basic). */
  secretHash?: string;
  authMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  createdAt: Date;
}
interface CodeRow {
  _id: string; // hash of the code
  clientId: string;
  uid: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  resource: string | null;
  expiresAt: Date;
}
interface TokenRow {
  _id: string; // hash of the token
  kind: 'access' | 'refresh';
  uid: string;
  clientId: string;
  scope: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date;
}

const clients = (db: Db) => db.collection<ClientRow>('oauth_clients');
const codes = (db: Db) => db.collection<CodeRow>('oauth_codes');
const tokens = (db: Db) => db.collection<TokenRow>('oauth_tokens');

export async function ensureOAuthIndexes(db: Db) {
  await tokens(db).createIndexes([{ key: { uid: 1, clientId: 1 }, name: 'uid_client' }]);
}

/* ---------- Client registration (RFC 7591) ---------- */

/** https, or http on this computer (Claude Code and other local clients). */
export function validRedirectUri(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 500) return false;
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(db: Db, body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri))
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1–10 https URLs (or http on localhost).');
  const requested = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
  const authMethod = (['none', 'client_secret_post', 'client_secret_basic'] as const).find((m) => m === requested) ?? 'none';
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code'];
  if (!grants.every((g) => g === 'authorization_code' || g === 'refresh_token'))
    throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token are supported.');
  const name = (typeof body.client_name === 'string' ? body.client_name : 'An app').replace(/\s+/g, ' ').trim().slice(0, 80) || 'An app';
  const id = token('tlc');
  const secret = authMethod === 'none' ? undefined : token('tls');
  await clients(db).insertOne({ _id: id, name, redirectUris: uris as string[], authMethod, createdAt: new Date(), ...(secret ? { secretHash: sha(secret) } : {}) });
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: SCOPE,
  };
}

export async function getClient(db: Db, clientId: unknown) {
  if (typeof clientId !== 'string' || clientId.length > 100) return null;
  return clients(db).findOne({ _id: clientId });
}

/* ---------- Authorization request ---------- */

export interface AuthRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  challenge: string;
  scope: string;
  resource: string | null;
}

/**
 * Check an authorization request. Problems with the client or redirect URI can't be sent back to the client
 * (we don't know where safely), so they're `fatal`; the rest go back to the redirect URI as an OAuth error.
 */
export async function checkAuthRequest(db: Db, q: Record<string, string | null>, mcpResource: string): Promise<AuthRequest> {
  const client = await getClient(db, q.client_id);
  if (!client) throw new OAuthError('invalid_client', 'This app isn’t registered with TwigList (unknown client_id).', 400);
  const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) throw new OAuthError('invalid_request', 'The redirect_uri doesn’t match the one this app registered.', 400);
  const fail = (error: string, description: string) => Object.assign(new OAuthError(error, description), { redirectUri, state: q.state });
  if (q.response_type !== 'code') throw fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (!q.code_challenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(q.code_challenge)) throw fail('invalid_request', 'PKCE is required: send code_challenge.');
  if ((q.code_challenge_method ?? 'plain') !== 'S256') throw fail('invalid_request', 'code_challenge_method must be S256.');
  const scopes = (q.scope ?? SCOPE).split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== SCOPE)) throw fail('invalid_scope', `The only scope is “${SCOPE}”.`);
  if (q.resource && !sameResource(q.resource, mcpResource)) throw fail('invalid_target', 'This server only issues tokens for its own MCP endpoint.');
  return { clientId: client._id, clientName: client.name, redirectUri, state: q.state ?? null, challenge: q.code_challenge, scope: SCOPE, resource: q.resource ?? null };
}

/**
 * The MCP endpoint (or the site itself), with or without a trailing slash, and with or without "www." (people
 * may type twiglist.app while the site runs on www.twiglist.app).
 */
const sameResource = (r: string, mcp: string) => {
  const norm = (s: string) => {
    try {
      const u = new URL(s);
      return `${u.protocol}//${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      return '';
    }
  };
  const target = norm(r);
  return !!target && (target === norm(mcp) || target === norm(new URL(mcp).origin));
};

/** The user approved: a one-time code, valid for 5 minutes, bound to the client, redirect URI and PKCE challenge. */
export async function issueCode(db: Db, req: AuthRequest, uid: string) {
  const code = token('tlo');
  await codes(db).insertOne({ _id: sha(code), clientId: req.clientId, uid, redirectUri: req.redirectUri, challenge: req.challenge, scope: req.scope, resource: req.resource, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  const url = new URL(req.redirectUri);
  url.searchParams.set('code', code);
  if (req.state !== null) url.searchParams.set('state', req.state);
  return url.toString();
}

/* ---------- Token endpoint ---------- */

async function authenticateClient(db: Db, form: URLSearchParams, basic: { id: string; secret: string } | null) {
  const clientId = basic?.id ?? form.get('client_id');
  const client = await getClient(db, clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client.', 401);
  if (client.authMethod !== 'none') {
    const secret = basic?.secret ?? form.get('client_secret') ?? '';
    const a = Buffer.from(sha(secret));
    const b = Buffer.from(client.secretHash ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
  }
  return client;
}

async function issueTokens(db: Db, uid: string, clientId: string, scope: string) {
  const access = token('tla');
  const refresh = token('tlr');
  const now = new Date();
  await tokens(db).insertMany([
    { _id: sha(access), kind: 'access', uid, clientId, scope, createdAt: now, expiresAt: new Date(now.getTime() + ACCESS_TTL_S * 1000) },
    { _id: sha(refresh), kind: 'refresh', uid, clientId, scope, createdAt: now, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS) },
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

export async function tokenRequest(db: Db, form: URLSearchParams, basic: { id: string; secret: string } | null) {
  const client = await authenticateClient(db, form, basic);
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const code = form.get('code') ?? '';
    // One use only: take it out first, so a second attempt with the same code fails.
    const row = await codes(db).findOneAndDelete({ _id: sha(code) });
    if (!row || row.clientId !== client._id || row.expiresAt < new Date()) throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used.');
    if (form.get('redirect_uri') && form.get('redirect_uri') !== row.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri doesn’t match.');
    const verifier = form.get('code_verifier') ?? '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== row.challenge)
      throw new OAuthError('invalid_grant', 'PKCE verification failed.');
    return issueTokens(db, row.uid, client._id, row.scope);
  }
  if (grant === 'refresh_token') {
    const refresh = form.get('refresh_token') ?? '';
    // Rotation: a refresh token works once; using it again (e.g. stolen and replayed) fails.
    const row = await tokens(db).findOneAndDelete({ _id: sha(refresh), kind: 'refresh' });
    if (!row || row.clientId !== client._id || row.expiresAt < new Date()) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired.');
    return issueTokens(db, row.uid, client._id, row.scope);
  }
  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

/* ---------- Using and revoking tokens ---------- */

/** The user and client behind an access token, or null. */
export async function checkAccessToken(db: Db, accessToken: string) {
  if (!accessToken.startsWith('tla_')) return null;
  const row = await tokens(db).findOne({ _id: sha(accessToken), kind: 'access' });
  if (!row || row.expiresAt < new Date()) return null;
  // Remember when it was last used (shown under "Connected apps"), at most once a minute.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) void tokens(db).updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return { uid: row.uid, clientId: row.clientId, scope: row.scope, expiresAt: Math.floor(row.expiresAt.getTime() / 1000) };
}

/** RFC 7009: revoke one token (and with a refresh token, the whole connection). */
export async function revokeToken(db: Db, t: string) {
  const row = await tokens(db).findOne({ _id: sha(t) });
  if (!row) return;
  if (row.kind === 'refresh') await tokens(db).deleteMany({ uid: row.uid, clientId: row.clientId });
  else await tokens(db).deleteOne({ _id: row._id });
}

/** Apps connected to this account ("Connected apps" in the account menu). */
export async function listConnections(db: Db, uid: string) {
  const rows = await tokens(db).find({ uid, expiresAt: { $gt: new Date() } }).toArray();
  const byClient = new Map<string, { since: Date; lastUsed?: Date }>();
  for (const r of rows) {
    const c = byClient.get(r.clientId) ?? { since: r.createdAt };
    if (r.createdAt < c.since) c.since = r.createdAt;
    if (r.lastUsedAt && (!c.lastUsed || r.lastUsedAt > c.lastUsed)) c.lastUsed = r.lastUsedAt;
    byClient.set(r.clientId, c);
  }
  const names = await clients(db).find({ _id: { $in: [...byClient.keys()] } }).toArray();
  return [...byClient.entries()].map(([id, c]) => ({
    clientId: id,
    name: names.find((n) => n._id === id)?.name ?? 'An app',
    since: c.since.toISOString(),
    lastUsed: c.lastUsed?.toISOString() ?? null,
  }));
}

/** Disconnect an app: all its tokens for this user stop working at once. */
export async function disconnect(db: Db, uid: string, clientId: string) {
  const r = await tokens(db).deleteMany({ uid, clientId });
  await codes(db).deleteMany({ uid, clientId });
  return r.deletedCount;
}

/** Account deleted: every app's access goes too. */
export async function forgetUser(db: Db, uid: string) {
  await tokens(db).deleteMany({ uid });
  await codes(db).deleteMany({ uid });
}

/** Old codes and tokens are useless; clear them out now and then (on token requests). */
export async function sweepExpired(db: Db) {
  const now = new Date();
  await codes(db).deleteMany({ expiresAt: { $lt: now } });
  await tokens(db).deleteMany({ expiresAt: { $lt: now } });
}
