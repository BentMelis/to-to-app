'use client';

import { useEffect, useState } from 'react';
import { signInAvailable } from '@/lib/cloud/config';
import { currentUser, idToken, signIn, signInMessage, SignInError, type Method } from '@/lib/cloud/auth';

type Info = { clientName: string; redirectHost: string; deny: string };
type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ask'; info: Info; email: string | null }
  | { k: 'going' };

/**
 * "Allow <app> to use your TwigList?". The app (e.g. Claude) sent the browser here; after Allow, TwigList
 * sends it back with a one-time code. The user signs in with Firebase as in the app.
 */
export default function Consent() {
  const [state, setState] = useState<State>({ k: 'loading' });
  const [busy, setBusy] = useState<Method | 'allow' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = () => new URLSearchParams(window.location.search);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!signInAvailable) return alive && setState({ k: 'error', message: 'Accounts aren’t set up on this TwigList yet.' });
      const r = await fetch(`/api/oauth/authorize?${params().toString()}`, { cache: 'no-store' });
      const data = (await r.json().catch(() => ({}))) as Partial<Info> & { redirect?: string; error_description?: string };
      if (!alive) return;
      if (data.redirect) {
        window.location.replace(data.redirect); // an error the app should hear about
        return setState({ k: 'going' });
      }
      if (!r.ok || !data.clientName) return setState({ k: 'error', message: data.error_description ?? 'This link to connect an app isn’t valid.' });
      const u = await currentUser().catch(() => null);
      if (alive) setState({ k: 'ask', info: data as Info, email: u?.email ?? null });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const doSignIn = async (m: Method) => {
    setBusy(m);
    setError(null);
    try {
      const u = await signIn(m);
      if (u) setState((s) => (s.k === 'ask' ? { ...s, email: u.email } : s));
    } catch (e) {
      setError(signInMessage(e instanceof SignInError ? e.code : 'unknown'));
    } finally {
      setBusy(null);
    }
  };

  const allow = async () => {
    setBusy('allow');
    setError(null);
    try {
      const t = await idToken();
      const r = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(params())),
      });
      const data = (await r.json().catch(() => ({}))) as { redirect?: string; error_description?: string };
      if (data.redirect) {
        setState({ k: 'going' });
        window.location.assign(data.redirect);
        return;
      }
      setError(r.status === 503 ? 'Accounts aren’t set up on this TwigList yet.' : (data.error_description ?? 'Something went wrong. Please try again.'));
    } catch {
      setError('No connection. Check your internet and try again.');
    }
    setBusy(null);
  };

  return (
    <main className="oauth">
      <div className="oauth-card">
        <p className="oauth-brand">TwigList</p>
        {state.k === 'loading' && <p className="oauth-muted">Loading…</p>}
        {state.k === 'going' && <p className="oauth-muted">Taking you back…</p>}
        {state.k === 'error' && (
          <>
            <h1>Can’t connect this app</h1>
            <p>{state.message}</p>
          </>
        )}
        {state.k === 'ask' && (
          <>
            <h1>
              Allow <b>{state.info.clientName}</b> to use your TwigList?
            </h1>
            <ul className="oauth-can">
              <li>See your trees, projects, todos and notes</li>
              <li>Add projects, todos and notes, tick todos off, and change or move them</li>
            </ul>
            <ul className="oauth-cant">
              <li>It can’t delete anything</li>
              <li>It never sees items you marked as sensitive</li>
            </ul>
            {state.email ? (
              <>
                <p className="oauth-muted">
                  Signed in as <b>{state.email}</b>. You’ll be sent back to <b>{state.info.redirectHost}</b>. You can disconnect it any time in your account
                  menu.
                </p>
                <div className="oauth-actions">
                  <a className="tb" href={state.info.deny}>
                    Cancel
                  </a>
                  <button className="tb primary" disabled={!!busy} onClick={allow} autoFocus>
                    {busy === 'allow' ? 'Connecting…' : 'Allow'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="oauth-muted">Sign in with the account that has your trees.</p>
                <div className="sign-in-methods">
                  <button className="sign-in-method" disabled={!!busy} onClick={() => doSignIn('google')}>
                    {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
                  </button>
                  <button className="sign-in-method" disabled={!!busy} onClick={() => doSignIn('microsoft')}>
                    {busy === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
                  </button>
                </div>
                <p className="oauth-muted">
                  <a href={state.info.deny}>Cancel</a>
                </p>
              </>
            )}
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
