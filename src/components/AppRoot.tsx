'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TreesApp from './TreesApp';
import { AccountButton, AccountMenu, MoveTreesDialog, SignInButton, SignInPanel } from './Account';
import { signInAvailable } from '@/lib/cloud/config';
import { type AccountHint, type Method, currentUser, deleteAccount, hintOf, readHint, signIn, signInMessage, SignInError, signOut, watchUser } from '@/lib/cloud/auth';
import { api, ApiError, OfflineError } from '@/lib/cloud/api';
import { CloudLibrary, clearCache, type SyncState } from '@/lib/cloud/library';
import { ensureFirstTree, localTrees, moveLocalTrees, skipMove, skippedMove, type LocalTree } from '@/lib/cloud/migrate';
import { exportAllDocs, localTreesWithContent } from '@/lib/storage';
import { forgetAllSessions } from '@/lib/tree/useTreeStore';
import { track } from '@/lib/analytics';

/**
 * TwigList is free and works without an account: trees are kept in this browser.
 * Signing in (Google or Microsoft, KAN-41) keeps them in the account instead, synced across devices (KAN-43).
 */
type Phase =
  | { k: 'boot' }
  | { k: 'local' }
  | { k: 'connecting'; account: AccountHint }
  | { k: 'cloud'; account: AccountHint; lib: CloudLibrary; gen: number };

/** A redirect sign-in (when popups are blocked) is under way: check for its result after the page loads. */
const REDIRECT_KEY = 'todo-tree:signing-in';

export default function AppRoot() {
  const [phase, setPhase] = useState<Phase>({ k: 'boot' });
  const [panel, setPanel] = useState<'signin' | 'account' | null>(null);
  const [busy, setBusy] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [move, setMove] = useState<{ trees: LocalTree[]; first: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>('synced');
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });

  const goLocal = useCallback(() => {
    forgetAllSessions();
    setPanel(null);
    setMove(null);
    setPhase({ k: 'local' });
  }, []);

  /** The account's library while the "move your trees?" question is open. */
  const pending = useRef<CloudLibrary | null>(null);
  const open = useCallback((account: AccountHint, lib: CloudLibrary) => {
    forgetAllSessions();
    lib.start();
    setSync(lib.syncState);
    setPhase((p) => ({ k: 'cloud', account, lib, gen: (p.k === 'cloud' ? p.gen : 0) + 1 }));
  }, []);

  /** Open the account: load the profile, offer to move this browser's trees, make sure there's a tree. */
  const connect = useCallback(
    async (account: AccountHint) => {
      setPhase({ k: 'connecting', account });
      const lib = new CloudLibrary(account.uid);
      try {
        await api('/api/me');
        const locals = await localTrees();
        if (locals.length && !skippedMove(account.uid)) {
          // Ask first; the account opens after the answer (see finishMove).
          pending.current = lib;
          setMove({ trees: locals, first: true });
          return;
        }
        await ensureFirstTree();
      } catch (e) {
        if (e instanceof OfflineError) {
          // Offline: open what this browser has cached for the account.
        } else if (e instanceof ApiError && e.status === 503) {
          setNotice('Sync isn’t available yet. Your trees stay in this browser for now.');
          await signOut().catch(() => {});
          return goLocal();
        } else {
          setNotice('Couldn’t open your account. Your trees in this browser are still here.');
          await signOut().catch(() => {});
          return goLocal();
        }
      }
      open(account, lib);
    },
    [goLocal, open],
  );

  // Start: signed in before in this browser (or coming back from a redirect sign-in)? Otherwise local.
  // (Decided after mounting: it reads this browser's storage.)
  useEffect(() => {
    let redirect = false;
    try {
      redirect = window.sessionStorage.getItem(REDIRECT_KEY) === '1';
      window.sessionStorage.removeItem(REDIRECT_KEY);
    } catch {
      /* ignore */
    }
    const hint = signInAvailable ? readHint() : null;
    const local = () => setPhase({ k: 'local' });
    if (!hint && !redirect) {
      void Promise.resolve().then(local);
      return;
    }
    void Promise.resolve().then(() => hint && setPhase({ k: 'connecting', account: hint }));
    currentUser().then(
      (u) => (u ? connect(hintOf(u)) : local()),
      () => (hint ? connect(hint) : local()), // Firebase didn't load (offline): use the cache
    );
  }, [connect]);

  // Signed out elsewhere (another tab, account deleted): back to this browser's trees.
  const cloudLib = phase.k === 'cloud' ? phase.lib : null;
  useEffect(() => {
    if (!cloudLib) return;
    const offState = cloudLib.onState(setSync);
    let off: (() => void) | null = null;
    let alive = true;
    watchUser((u) => {
      if (!u && phaseRef.current.k === 'cloud') {
        cloudLib.stop();
        goLocal();
      }
    }).then((f) => (alive ? (off = f) : f()));
    return () => {
      alive = false;
      offState();
      off?.();
      cloudLib.stop();
    };
  }, [cloudLib, goLocal]);

  const onSignIn = async (m: Method) => {
    setBusy(m);
    setError(null);
    try {
      try {
        window.sessionStorage.setItem(REDIRECT_KEY, '1');
      } catch {
        /* ignore */
      }
      const u = await signIn(m);
      if (!u) return; // closed the popup, or redirecting
      window.sessionStorage.removeItem(REDIRECT_KEY);
      track('signed_in', { method: m });
      setPanel(null);
      await connect(hintOf(u));
    } catch (e) {
      setError(signInMessage(e instanceof SignInError ? e.code : 'unknown'));
    } finally {
      setBusy(null);
      try {
        window.sessionStorage.removeItem(REDIRECT_KEY);
      } catch {
        /* ignore */
      }
    }
  };

  const onSignOut = async () => {
    if (phase.k !== 'cloud') return;
    const { lib, account } = phase;
    setPanel(null);
    if (lib.hasUnsynced) await Promise.race([lib.sync(), new Promise((r) => setTimeout(r, 5000))]);
    if (lib.hasUnsynced && !window.confirm('Some changes haven’t reached your account yet (you seem to be offline). If you sign out now, they’re lost. Sign out anyway?')) return;
    lib.stop();
    clearCache(account.uid);
    await signOut().catch(() => {});
    track('signed_out');
    goLocal();
  };

  const onExport = async () => {
    const data = await api<object>('/api/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `twiglist-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const onDelete = async () => {
    if (phase.k !== 'cloud') return;
    const { lib, account } = phase;
    // Confirms the sign-in if needed, deletes the trees on our server, then the Firebase account.
    await deleteAccount(async () => {
      await api('/api/me', { method: 'DELETE' });
    });
    lib.stop();
    clearCache(account.uid);
    await signOut().catch(() => {});
    track('account_deleted');
    setNotice('Your account and all its trees are deleted.');
    goLocal();
  };

  const onMoveLocal = async () => {
    setPanel(null);
    const trees = await localTrees();
    if (trees.length) setMove({ trees, first: false });
  };

  const accountOf = (p: Phase) => (p.k === 'cloud' || p.k === 'connecting' ? p.account : null);
  const finishMove = async () => {
    const account = accountOf(phaseRef.current);
    const lib = phaseRef.current.k === 'cloud' ? phaseRef.current.lib : pending.current;
    pending.current = null;
    setMove(null);
    if (!account || !lib) return;
    await ensureFirstTree().catch(() => {});
    open(account, phaseRef.current.k === 'cloud' ? new CloudLibrary(account.uid) : lib);
  };

  /* ---------- Render ---------- */

  let accountSlot: React.ReactNode = null;
  if (phase.k === 'local' && signInAvailable)
    accountSlot = <SignInButton open={panel === 'signin'} onToggle={() => setPanel((p) => (p === 'signin' ? null : 'signin'))} />;
  else if (phase.k === 'cloud')
    accountSlot = <AccountButton account={phase.account} sync={sync} open={panel === 'account'} onToggle={() => setPanel((p) => (p === 'account' ? null : 'account'))} />;

  return (
    <>
      {phase.k === 'local' && <TreesApp key="local" account={accountSlot} />}
      {phase.k === 'cloud' && <TreesApp key={`cloud-${phase.account.uid}-${phase.gen}`} library={phase.lib} cloud={phase.lib} account={accountSlot} />}
      {(phase.k === 'boot' || phase.k === 'connecting') && !move && <div className="boot" aria-busy="true" />}

      {panel === 'signin' && phase.k === 'local' && <SignInPanel onSignIn={onSignIn} busy={busy} error={error} onClose={() => setPanel(null)} />}
      {panel === 'account' && phase.k === 'cloud' && (
        <AccountMenu
          account={phase.account}
          sync={sync}
          localCount={localTreesWithContent()?.ids.length ?? 0}
          onMoveLocal={onMoveLocal}
          onExport={onExport}
          onSignOut={onSignOut}
          onDelete={onDelete}
          onClose={() => setPanel(null)}
        />
      )}
      {move && (
        <MoveTreesDialog
          names={move.trees.map((t) => t.name)}
          onBackup={() => exportAllDocs(move.trees.map((t) => ({ name: t.name, doc: t.doc })))}
          onMove={async () => {
            const r = await moveLocalTrees(move.trees);
            track('local_trees_moved', { trees: r.moved, left: r.left });
            if (r.left) setNotice(`Your account is full (10 trees). ${r.left} tree${r.left === 1 ? '' : 's'} stayed in this browser.`);
            await finishMove();
          }}
          onLater={() => {
            const account = accountOf(phaseRef.current);
            if (account && move.first) skipMove(account.uid);
            void finishMove();
          }}
        />
      )}
      {notice && (
        <div className="toast tree-toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>OK</button>
        </div>
      )}
    </>
  );
}
