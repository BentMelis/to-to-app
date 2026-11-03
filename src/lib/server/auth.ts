/**
 * Who is calling (KAN-41): every API request carries a Firebase ID token (`Authorization: Bearer …`).
 *
 * Verified here with `jose`, following Firebase's guide for third-party JWT libraries
 * (https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library):
 * - signed with RS256 by one of Google's public keys (securetoken@system.gserviceaccount.com);
 * - `aud` = our Firebase project id, `iss` = https://securetoken.google.com/<project id>;
 * - not expired, not issued in the future, `auth_time` in the past, `sub` (the uid) not empty.
 * No credentials or service account are needed. (We don't use firebase-admin: its token code didn't load on Vercel.)
 *
 * Local development with the Firebase Auth emulator (FIREBASE_AUTH_EMULATOR_HOST set): emulator tokens aren't
 * signed, so only the claims are checked, like firebase-admin does. Never set that variable in production.
 */
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { serverConfig } from './config';

export interface Caller {
  uid: string;
  email: string | null;
  name: string | null;
  /** e.g. google.com, microsoft.com */
  provider: string | null;
}

const GOOGLE_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
/** Fetched on first use, cached and refreshed by jose (Google rotates the keys every few hours). */
let googleKeys: JWTVerifyGetKey | null = null;
const keys = () => (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_KEYS), { cooldownDuration: 60_000, cacheMaxAge: 6 * 3600_000 }));

/** A few seconds of difference between our clock and Google's. */
const SKEW_S = 30;

function callerOf(p: JWTPayload, projectId: string): Caller | null {
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (p.aud !== projectId) return null;
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) return null;
  if (typeof p.exp !== 'number' || p.exp < now - SKEW_S) return null;
  if (typeof p.iat !== 'number' || p.iat > now + SKEW_S) return null;
  const authTime = (p as { auth_time?: unknown }).auth_time;
  if (typeof authTime !== 'number' || authTime > now + SKEW_S) return null;
  const firebase = (p as { firebase?: { sign_in_provider?: unknown } }).firebase;
  return {
    uid: p.sub,
    email: typeof p.email === 'string' ? p.email : null,
    name: typeof p.name === 'string' ? p.name : null,
    provider: typeof firebase?.sign_in_provider === 'string' ? firebase.sign_in_provider : null,
  };
}

/**
 * Check a Firebase ID token. `getKey` is Google's key set; tests pass their own.
 * Returns the caller, or null when the token is missing, expired, forged or for another project.
 */
export async function verifyIdToken(token: string, opts: { projectId: string; getKey?: JWTVerifyGetKey; emulator?: boolean }): Promise<Caller | null> {
  const { projectId } = opts;
  if (!projectId || !token) return null;
  try {
    if (opts.emulator) return callerOf(decodeJwt(token), projectId);
    const { payload } = await jwtVerify(token, opts.getKey ?? keys(), {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      clockTolerance: SKEW_S,
    });
    return callerOf(payload, projectId);
  } catch {
    return null;
  }
}

/** The signed-in user behind a request, or null when the token is missing, expired or invalid. */
export async function callerFrom(req: Request): Promise<Caller | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const { projectId } = serverConfig();
  return verifyIdToken(m[1], { projectId, emulator: !!process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim() });
}
