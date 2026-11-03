/** Verifying Firebase ID tokens without firebase-admin (KAN-41). Keys are generated here instead of Google's. */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { verifyIdToken } from '../auth';

const PROJECT = 'twiglist-test';
const now = () => Math.floor(Date.now() / 1000);

let getKey: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>, opts?: { kid?: string; alg?: string; key?: CryptoKey }) => Promise<string>;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  getKey = createLocalJWKSet({ keys: [jwk] });
  sign = (claims, opts = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' }).sign(opts.key ?? privateKey);
});

const good = () => ({
  iss: `https://securetoken.google.com/${PROJECT}`,
  aud: PROJECT,
  sub: 'uid-123',
  iat: now() - 60,
  exp: now() + 3000,
  auth_time: now() - 120,
  email: 'bent@example.com',
  name: 'Bent',
  firebase: { sign_in_provider: 'google.com' },
});
const check = (t: string) => verifyIdToken(t, { projectId: PROJECT, getKey });

describe('verifyIdToken', () => {
  it('accepts a valid token and reads who it is', async () => {
    expect(await check(await sign(good()))).toEqual({ uid: 'uid-123', email: 'bent@example.com', name: 'Bent', provider: 'google.com' });
  });

  it('rejects tokens for another project, from another issuer, or without a user', async () => {
    expect(await check(await sign({ ...good(), aud: 'other-project' }))).toBeNull();
    expect(await check(await sign({ ...good(), iss: 'https://securetoken.google.com/other-project' }))).toBeNull();
    expect(await check(await sign({ ...good(), iss: 'https://evil.example.com' }))).toBeNull();
    expect(await check(await sign({ ...good(), sub: '' }))).toBeNull();
  });

  it('rejects expired tokens, tokens from the future and sign-ins in the future', async () => {
    expect(await check(await sign({ ...good(), exp: now() - 3600 }))).toBeNull();
    expect(await check(await sign({ ...good(), iat: now() + 3600 }))).toBeNull();
    expect(await check(await sign({ ...good(), auth_time: now() + 3600 }))).toBeNull();
    expect(await check(await sign({ ...good(), auth_time: undefined }))).toBeNull();
  });

  it('rejects forged tokens: wrong key, unknown key id, other algorithm, unsigned, tampered, garbage', async () => {
    expect(await check(await sign(good(), { key: otherKey }))).toBeNull();
    expect(await check(await sign(good(), { kid: 'unknown' }))).toBeNull();
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(good())).toString('base64url')}.`;
    expect(await check(unsigned)).toBeNull();
    const [h, , s] = (await sign(good())).split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...good(), sub: 'someone-else' })).toString('base64url')}.${s}`;
    expect(await check(tampered)).toBeNull();
    expect(await check('not-a-token')).toBeNull();
    expect(await check('')).toBeNull();
    expect(await verifyIdToken(await sign(good()), { projectId: '', getKey })).toBeNull();
  });

  it('emulator mode checks the claims of unsigned tokens, and still the project', async () => {
    const unsigned = (c: object) => `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(c)).toString('base64url')}.`;
    expect((await verifyIdToken(unsigned(good()), { projectId: PROJECT, emulator: true }))?.uid).toBe('uid-123');
    expect(await verifyIdToken(unsigned({ ...good(), aud: 'other' }), { projectId: PROJECT, emulator: true })).toBeNull();
    expect(await verifyIdToken(unsigned({ ...good(), exp: now() - 3600 }), { projectId: PROJECT, emulator: true })).toBeNull();
  });
});
