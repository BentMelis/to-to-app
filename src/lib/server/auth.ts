/**
 * Who is calling (KAN-41): every API request carries a Firebase ID token (`Authorization: Bearer …`),
 * verified here with firebase-admin (signature, expiry, audience = our project). Firebase is used for sign-in only;
 * data lives in MongoDB.
 */
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { serverConfig } from './config';

export interface Caller {
  uid: string;
  email: string | null;
  name: string | null;
  /** e.g. google.com, microsoft.com */
  provider: string | null;
}

function adminApp(): App {
  const existing = getApps().find((a) => a.name === 'twiglist');
  if (existing) return existing;
  // Only the project id: enough to verify ID tokens (no credentials, so no secret to keep).
  // With FIREBASE_AUTH_EMULATOR_HOST set, firebase-admin checks tokens against the local emulator instead.
  const { projectId } = serverConfig();
  if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set');
  return initializeApp({ projectId }, 'twiglist');
}

const adminAuth = () => getAuth(adminApp());

/** The signed-in user behind a request, or null when the token is missing, expired or invalid. */
export async function callerFrom(req: Request): Promise<Caller | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  try {
    const t = await adminAuth().verifyIdToken(m[1]);
    return {
      uid: t.uid,
      email: t.email ?? null,
      name: (t.name as string | undefined) ?? null,
      provider: t.firebase?.sign_in_provider ?? null,
    };
  } catch {
    return null;
  }
}
