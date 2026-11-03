'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SignInError, signInMessage, type AccountHint, type Method } from '@/lib/cloud/auth';
import type { SyncState } from '@/lib/cloud/library';
import { IconUser } from './icons';

/** Place a popover under its toolbar button, inside the window. */
function usePopover(anchorSel: string, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = document.querySelector(anchorSel)?.getBoundingClientRect();
    const W = window.innerWidth;
    el.style.left = `${Math.max(12, Math.min((r?.right ?? W - 12) - el.offsetWidth, W - el.offsetWidth - 12))}px`;
    el.style.top = `${(r?.bottom ?? 56) + 8}px`;
    el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [anchorSel]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest(anchorSel)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [anchorSel, onClose]);
  return ref;
}

/* ---------- Signed out: "Sign in" ---------- */

export function SignInButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className="tb sign-in" data-account-button aria-haspopup="dialog" aria-expanded={open} title="Sign in to sync your trees across devices" onClick={onToggle}>
      <IconUser />
      <span className="tb-label">Sign in</span>
    </button>
  );
}

export function SignInPanel({ onSignIn, onClose, busy, error }: { onSignIn: (m: Method) => void; onClose: () => void; busy: Method | null; error: string | null }) {
  const ref = usePopover('[data-account-button]', onClose);
  return (
    <div ref={ref} className="picker account-panel" role="dialog" aria-label="Sign in">
      <h2>Your trees, on every device</h2>
      <p>TwigList stays free. Sign in to keep your trees safe in your account and use them on your laptop and phone.</p>
      <div className="sign-in-methods">
        <button className="sign-in-method" disabled={!!busy} onClick={() => onSignIn('google')}>
          {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
        </button>
        <button className="sign-in-method" disabled={!!busy} onClick={() => onSignIn('microsoft')}>
          {busy === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
        </button>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <p className="fine">Stored in the EU. Download or delete everything at any time. Without an account, your trees stay in this browser.</p>
    </div>
  );
}

/* ---------- Signed in: the account menu ---------- */

const SYNC_TEXT: Record<SyncState, string> = {
  synced: 'All changes saved to your account',
  saving: 'Saving…',
  offline: 'Offline. Changes will sync when you’re back online.',
  error: 'Couldn’t save to your account. Trying again…',
};

const initial = (a: AccountHint) => (a.name || a.email || '?').trim().charAt(0).toUpperCase();

export function AccountButton({ account, open, sync, onToggle }: { account: AccountHint; open: boolean; sync: SyncState; onToggle: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      className={'tb icon account-button' + (sync === 'offline' || sync === 'error' ? ' unsynced' : '')}
      data-account-button
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Account: ${account.name || account.email || 'signed in'}`}
      title={account.email ?? 'Account'}
      onClick={onToggle}
    >
      {account.photo && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small avatar from the sign-in provider
        <img src={account.photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span className="account-initial">{initial(account)}</span>
      )}
    </button>
  );
}

interface MenuProps {
  account: AccountHint;
  sync: SyncState;
  /** Trees still in this browser that could move to the account. */
  localCount: number;
  onMoveLocal: () => void;
  onExport: () => Promise<void>;
  onSignOut: () => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function AccountMenu({ account, sync, localCount, onMoveLocal, onExport, onSignOut, onDelete, onClose }: MenuProps) {
  const ref = usePopover('[data-account-button]', onClose);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: 'export' | 'delete', f: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(
        e instanceof SignInError
          ? signInMessage(e.code)
          : what === 'export'
            ? 'Couldn’t download your data. Check your connection and try again.'
            : 'Couldn’t delete your account. Nothing was deleted; check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div ref={ref} className="picker account-panel account-menu" role="dialog" aria-label="Account">
      <div className="account-who">
        {account.name && <b>{account.name}</b>}
        {account.email && <span>{account.email}</span>}
      </div>
      <p className={'account-sync s-' + sync} aria-live="polite">
        {SYNC_TEXT[sync]}
      </p>
      {confirm ? (
        <div className="account-confirm">
          <p>
            <b>Delete your account and all your trees?</b> Everything is removed from our servers. This can’t be undone.
          </p>
          <div className="account-actions">
            <button className="pick danger" disabled={busy === 'delete'} onClick={() => run('delete', onDelete)}>
              {busy === 'delete' ? 'Deleting…' : 'Delete everything'}
            </button>
            <button className="pick" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="account-actions column">
          {localCount > 0 && (
            <button className="pick" onClick={onMoveLocal}>
              Move {localCount} tree{localCount === 1 ? '' : 's'} from this browser…
            </button>
          )}
          <button className="pick" disabled={busy === 'export'} onClick={() => run('export', onExport)}>
            {busy === 'export' ? 'Preparing…' : 'Download all my data'}
          </button>
          <button className="pick" onClick={onSignOut}>
            Sign out
          </button>
          <button className="pick danger" onClick={() => setConfirm(true)}>
            Delete my account…
          </button>
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Moving this browser's trees into the account ---------- */

export function MoveTreesDialog({
  names,
  onMove,
  onBackup,
  onLater,
}: {
  names: string[];
  onMove: () => Promise<void>;
  onBackup: () => void;
  onLater: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = names.length;
  return (
    <div className="dialog-backdrop">
      <div className="notes-dialog move-trees" role="dialog" aria-modal="true" aria-labelledby="move-trees-title">
        <h2 id="move-trees-title">
          Move your {n === 1 ? 'tree' : `${n} trees`} to your account?
        </h2>
        <p>
          This browser has {n === 1 ? 'a tree' : `${n} trees`}: <b>{names.join(', ')}</b>. Move {n === 1 ? 'it' : 'them'} to your account to keep {n === 1 ? 'it' : 'them'} safe and see{' '}
          {n === 1 ? 'it' : 'them'} on your other devices. After moving, {n === 1 ? 'it’s' : 'they’re'} no longer kept in this browser on {n === 1 ? 'its' : 'their'} own.
        </p>
        <p className="fine">
          Want a safety copy first?{' '}
          <button className="link" onClick={onBackup}>
            Download a backup
          </button>
        </p>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <div className="notes-foot">
          <div className="spacer" />
          <button className="tb" disabled={busy} onClick={onLater}>
            Not now
          </button>
          <button
            className="tb primary"
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onMove();
              } catch {
                setError('Moving didn’t work. Your trees are still here. Check your connection and try again.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Moving…' : 'Move to my account'}
          </button>
        </div>
      </div>
    </div>
  );
}
