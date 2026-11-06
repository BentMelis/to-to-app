/**
 * TwigList's OAuth server for MCP clients, against a real MongoDB-protocol server.
 * Runs when MONGODB_TEST_URI is set; skipped otherwise.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';
import * as O from '../oauth';

const URI = process.env.MONGODB_TEST_URI;
const MCP = 'https://www.twiglist.app/api/mcp';
const CB = 'https://claude.ai/api/mcp/auth_callback';

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const form = (o: Record<string, string>) => new URLSearchParams(o);

describe.skipIf(!URI)('OAuth for MCP (MongoDB)', () => {
  let client: MongoClient;
  let db: Db;
  beforeAll(async () => {
    client = await new MongoClient(URI!).connect();
    db = client.db(`twiglist_oauth_${process.pid}`);
  });
  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });
  beforeEach(async () => {
    await db.dropDatabase();
  });

  const register = (extra: Record<string, unknown> = {}) => O.registerClient(db, { client_name: 'Claude', redirect_uris: [CB], ...extra });
  const authorize = async (clientId: string, challenge: string, extra: Record<string, string> = {}) => {
    const req = await O.checkAuthRequest(
      db,
      { response_type: 'code', client_id: clientId, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: null, resource: MCP, ...extra },
      MCP,
    );
    const url = new URL(await O.issueCode(db, req, 'user-1'));
    return { code: url.searchParams.get('code')!, state: url.searchParams.get('state'), url };
  };
  const err = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as O.OAuthError & { redirectUri?: string };
    }
    throw new Error('expected an error');
  };

  it('registers clients with safe redirect URIs only', async () => {
    const c = await register();
    expect(c).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'none', redirect_uris: [CB] });
    expect(c.client_id).toMatch(/^tlc_/);
    expect((await register({ redirect_uris: ['http://localhost:33418/callback'] })).client_id).toBeTruthy();
    for (const bad of [[], ['http://evil.example.com/cb'], ['javascript:alert(1)'], ['https://x.example/cb#frag'], 'https://x.example/cb'])
      expect((await err(register({ redirect_uris: bad }))).error).toBe('invalid_redirect_uri');
    expect((await err(register({ grant_types: ['client_credentials'] }))).error).toBe('invalid_client_metadata');
  });

  it('full flow: code with PKCE → tokens → the access token identifies the user', async () => {
    const c = await register();
    const { verifier, challenge } = pkce();
    const { code, state, url } = await authorize(c.client_id, challenge);
    expect(url.origin + url.pathname).toBe(CB);
    expect(state).toBe('xyz');
    const t = await O.tokenRequest(db, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.client_id, redirect_uri: CB }), null);
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'trees' });
    expect(await O.checkAccessToken(db, t.access_token)).toMatchObject({ uid: 'user-1', clientId: c.client_id, scope: 'trees' });
    expect(await O.checkAccessToken(db, t.refresh_token)).toBeNull(); // a refresh token isn't an access token
    expect(await O.checkAccessToken(db, 'tla_nonsense')).toBeNull();
  });

  it('a code works once, only with the right verifier, client and redirect URI', async () => {
    const c = await register();
    const other = await register();
    const { verifier, challenge } = pkce();
    const a = await authorize(c.client_id, challenge);
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code: a.code, code_verifier: pkce().verifier, client_id: c.client_id }), null))).error).toBe('invalid_grant');
    // The failed attempt used the code up.
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code: a.code, code_verifier: verifier, client_id: c.client_id }), null))).error).toBe('invalid_grant');
    const b = await authorize(c.client_id, challenge);
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code: b.code, code_verifier: verifier, client_id: other.client_id }), null))).error).toBe('invalid_grant');
    const d = await authorize(c.client_id, challenge);
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code: d.code, code_verifier: verifier, client_id: c.client_id, redirect_uri: 'https://evil.example/cb' }), null))).error).toBe('invalid_grant');
    const e = await authorize(c.client_id, challenge);
    await O.tokenRequest(db, form({ grant_type: 'authorization_code', code: e.code, code_verifier: verifier, client_id: c.client_id }), null);
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code: e.code, code_verifier: verifier, client_id: c.client_id }), null))).error).toBe('invalid_grant');
  });

  it('checks authorization requests: unknown clients and redirect URIs never get redirected to', async () => {
    const c = await register();
    const { challenge } = pkce();
    const base = { response_type: 'code', client_id: c.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'trees', resource: MCP };
    const unknown = await err(O.checkAuthRequest(db, { ...base, client_id: 'tlc_nope' }, MCP));
    expect(unknown.redirectUri).toBeUndefined();
    const badUri = await err(O.checkAuthRequest(db, { ...base, redirect_uri: 'https://evil.example/cb' }, MCP));
    expect(badUri.redirectUri).toBeUndefined();
    // Other problems go back to the (verified) redirect URI as OAuth errors.
    for (const [patch, error] of [
      [{ code_challenge: null }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ scope: 'admin' }, 'invalid_scope'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ] as const) {
      const e = await err(O.checkAuthRequest(db, { ...base, ...patch }, MCP));
      expect([e.error, e.redirectUri]).toEqual([error, CB]);
    }
    // With or without www, and the site origin, are accepted as resource; redirect_uri may be left out with one registered.
    expect((await O.checkAuthRequest(db, { ...base, resource: 'https://twiglist.app/api/mcp/' }, MCP)).redirectUri).toBe(CB);
    expect((await O.checkAuthRequest(db, { ...base, resource: 'https://www.twiglist.app', redirect_uri: null }, MCP)).redirectUri).toBe(CB);
  });

  it('refresh tokens rotate: each works once', async () => {
    const c = await register();
    const { verifier, challenge } = pkce();
    const { code } = await authorize(c.client_id, challenge);
    const t1 = await O.tokenRequest(db, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.client_id }), null);
    const t2 = await O.tokenRequest(db, form({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: c.client_id }), null);
    expect(t2.access_token).not.toBe(t1.access_token);
    expect(await O.checkAccessToken(db, t2.access_token)).toMatchObject({ uid: 'user-1' });
    expect((await err(O.tokenRequest(db, form({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: c.client_id }), null))).error).toBe('invalid_grant');
    const other = await register();
    expect((await err(O.tokenRequest(db, form({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: other.client_id }), null))).error).toBe('invalid_grant');
  });

  it('confidential clients must authenticate', async () => {
    const c = await register({ token_endpoint_auth_method: 'client_secret_post' });
    expect(c.client_secret).toMatch(/^tls_/);
    const { verifier, challenge } = pkce();
    const { code } = await authorize(c.client_id, challenge);
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.client_id, client_secret: 'wrong' }), null))).error).toBe('invalid_client');
    const again = await authorize(c.client_id, challenge);
    const ok = await O.tokenRequest(db, form({ grant_type: 'authorization_code', code: again.code, code_verifier: verifier }), { id: c.client_id, secret: c.client_secret! });
    expect(ok.access_token).toMatch(/^tla_/);
  });

  it('lists connections; disconnecting, revoking or deleting the account stops the tokens', async () => {
    const c = await register();
    const { verifier, challenge } = pkce();
    const get = async () => {
      const { code } = await authorize(c.client_id, challenge);
      return O.tokenRequest(db, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.client_id }), null);
    };
    const t = await get();
    await O.checkAccessToken(db, t.access_token);
    const list = await O.listConnections(db, 'user-1');
    expect(list).toEqual([expect.objectContaining({ clientId: c.client_id, name: 'Claude' })]);
    expect(await O.listConnections(db, 'someone-else')).toEqual([]);

    await O.disconnect(db, 'user-1', c.client_id);
    expect(await O.checkAccessToken(db, t.access_token)).toBeNull();
    expect(await O.listConnections(db, 'user-1')).toEqual([]);

    const t2 = await get();
    await O.revokeToken(db, t2.refresh_token); // revoking the refresh token ends the whole connection
    expect(await O.checkAccessToken(db, t2.access_token)).toBeNull();

    const t3 = await get();
    await O.forgetUser(db, 'user-1');
    expect(await O.checkAccessToken(db, t3.access_token)).toBeNull();
  });

  it('expired codes and tokens don’t work', async () => {
    const c = await register();
    const { verifier, challenge } = pkce();
    const { code } = await authorize(c.client_id, challenge);
    await db.collection('oauth_codes').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await err(O.tokenRequest(db, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.client_id }), null))).error).toBe('invalid_grant');
    const fresh = await authorize(c.client_id, challenge);
    const t = await O.tokenRequest(db, form({ grant_type: 'authorization_code', code: fresh.code, code_verifier: verifier, client_id: c.client_id }), null);
    await db.collection('oauth_tokens').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await O.checkAccessToken(db, t.access_token)).toBeNull();
    await O.sweepExpired(db);
    expect(await db.collection('oauth_tokens').countDocuments()).toBe(0);
  });
});
