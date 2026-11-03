/**
 * Sign-in with Firebase Authentication (KAN-41): Google and Microsoft.
 *
 * Firebase is loaded only when needed: when someone clicks "Sign in", or at start-up when this browser
 * remembers a signed-in account (`todo-tree:account`). People who never sign in never download it.
 */
import type { Auth, User } from '@firebase/auth';
import { authEmulatorHost, firebaseConfig } from './config';

export type Method = 'google' | 'microsoft';

/** What the app remembers about the signed-in account in this browser, to start quickly. Not a credential. */
export interface AccountHint {
  uid: string;
  email: string | null;
  name: string | null;
  photo: string | null;
  provider: string | null;
}

const HINT_KEY = 'todo-tree:account';

export function readHint(): AccountHint | null {
  try {
    const raw = window.localStorage.getItem(HINT_KEY);
    const h = raw ? (JSON.parse(raw) as AccountHint) : null;
    return h && typeof h.uid === 'string' ? h : null;
  } catch {
    return null;
  }
}
function writeHint(h: AccountHint | null) {
  try {
    if (h) window.localStorage.setItem(HINT_KEY, JSON.stringify(h));
    else window.localStorage.removeItem(HINT_KEY);
  } catch {
    /* ignore */
  }
}

export const hintOf = (u: User): AccountHint => ({
  uid: u.uid,
  email: u.email,
  name: u.displayName,
  photo: u.photoURL,
  provider: u.providerData[0]?.providerId ?? null,
});

let authPromise: Promise<{ auth: Auth; mod: typeof import('@firebase/auth') }> | null = null;

/** Load and start Firebase Auth (once). */
export function loadAuth() {
  if (!authPromise) {
    authPromise = Promise.all([import('@firebase/app'), import('@firebase/auth')]).then(([app, mod]) => {
      const fb = app.getApps().find((a) => a.name === 'twiglist') ?? app.initializeApp(firebaseConfig, 'twiglist');
      // Remembered across reloads (IndexedDB), with the browser popup/redirect helpers.
      const auth = mod.initializeAuth(fb, {
        persistence: [mod.indexedDBLocalPersistence, mod.browserLocalPersistence],
        popupRedirectResolver: mod.browserPopupRedirectResolver,
      });
      if (authEmulatorHost) mod.connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
      return { auth, mod };
    });
  }
  return authPromise;
}

/** Calls back with the signed-in user (or null) now and whenever it changes. */
export async function watchUser(cb: (u: User | null) => void) {
  const { auth, mod } = await loadAuth();
  return mod.onAuthStateChanged(auth, (u) => {
    writeHint(u ? hintOf(u) : null);
    cb(u);
  });
}

/** Wait until Firebase has restored a remembered session (or decided there is none). */
export async function currentUser(): Promise<User | null> {
  const { auth } = await loadAuth();
  await auth.authStateReady();
  return auth.currentUser;
}

export class SignInError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Sign in with a popup; falls back to a full-page redirect when the browser blocks popups. */
export async function signIn(method: Method): Promise<User | null> {
  const { auth, mod } = await loadAuth();
  const provider = method === 'google' ? new mod.GoogleAuthProvider() : new mod.OAuthProvider('microsoft.com');
  // Always let people pick the account (work vs personal), instead of silently reusing the last one.
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const r = await mod.signInWithPopup(auth, provider);
    writeHint(hintOf(r.user));
    return r.user;
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'unknown';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await mod.signInWithRedirect(auth, provider);
      return null;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    throw new SignInError(code);
  }
}

export async function signOut() {
  writeHint(null);
  const { auth, mod } = await loadAuth();
  await mod.signOut(auth);
}

/** Firebase only deletes an account right after a sign-in; older sessions confirm once more first. */
const RECENT_MS = 4 * 60_000;

/**
 * Delete the signed-in account: confirm the sign-in again if it's not recent (a Google/Microsoft popup),
 * then `removeData` (our server deletes the trees), then the Firebase account itself.
 * Confirming comes first, so the data is never deleted while the account stays.
 */
export async function deleteAccount(removeData: () => Promise<void>) {
  const { auth, mod } = await loadAuth();
  const u = auth.currentUser;
  if (!u) throw new SignInError('auth/no-current-user');
  const t = await u.getIdTokenResult();
  if (Date.now() - Date.parse(t.authTime) > RECENT_MS) {
    const provider = u.providerData[0]?.providerId === 'microsoft.com' ? new mod.OAuthProvider('microsoft.com') : new mod.GoogleAuthProvider();
    try {
      await mod.reauthenticateWithPopup(u, provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const known = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/popup-blocked', 'auth/user-mismatch', 'auth/network-request-failed'];
      throw new SignInError(known.includes(code) ? code : 'auth/reauth-failed');
    }
  }
  await removeData();
  try {
    await mod.deleteUser(u);
  } catch {
    // Rare (e.g. the confirmation expired in between): the data is gone; deleting again finishes the job.
    throw new SignInError('auth/data-deleted-account-left');
  }
  writeHint(null);
}

/** A fresh ID token for API calls (Firebase refreshes it when it's about to expire). */
export async function idToken(): Promise<string | null> {
  const { auth } = await loadAuth();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

/** Plain-language message for a sign-in error. */
export function signInMessage(code: string): string {
  switch (code) {
    case 'auth/account-exists-with-different-credential':
      return 'You already signed in with this email using the other button. Use that one.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/unauthorized-domain':
      return 'Sign-in isn’t set up for this address yet.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method isn’t switched on yet.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Deleting needs you to confirm your sign-in. Nothing was deleted; try again when you’re ready.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow popups for TwigList and try again.';
    case 'auth/user-mismatch':
      return 'That was a different account. Confirm with the account you’re signed in with.';
    case 'auth/reauth-failed':
      return 'Couldn’t confirm your sign-in, so nothing was deleted. Please try again.';
    case 'auth/data-deleted-account-left':
      return 'Your trees are deleted, but the sign-in account couldn’t be removed. Sign in again and choose Delete my account to finish.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    default:
      return 'Signing in didn’t work. Please try again.';
  }
}
