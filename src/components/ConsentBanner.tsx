'use client';

import { useEffect, useState } from 'react';
import { applyInternalParam, getConsent, isInternal, loadAnalytics, resetConsent, setConsent } from '@/lib/analytics';

/**
 * Asks once whether we may count visits with Google Analytics. Nothing loads before "Accept".
 * Shows again after "Cookie settings" (resetConsent).
 */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // ?internal=1 / ?internal=0 first, so analytics loads with the right flag.
    applyInternalParam();
    const sync = () => {
      const c = getConsent();
      if (c === 'granted') loadAnalytics();
      setOpen(c === null);
    };
    sync();
    window.addEventListener('todo-tree:consent', sync);
    return () => window.removeEventListener('todo-tree:consent', sync);
  }, []);

  if (!open) return null;
  return (
    <section className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title" aria-describedby="consent-text">
      <h2 id="consent-title">Can we count your visit?</h2>
      <p id="consent-text">
        With your permission we use Google Analytics to see how TwigList is used: which pages, and actions like creating a tree. Never what you
        write: your projects, todos and notes stay in your browser.
      </p>
      <div className="consent-actions">
        <button type="button" className="consent-btn" onClick={() => setConsent('denied')}>
          Decline
        </button>
        <button type="button" className="consent-btn primary" onClick={() => setConsent('granted')}>
          Accept
        </button>
      </div>
    </section>
  );
}

/** Shown in the help panel while this browser is marked as internal (our own visits). */
export function InternalTrafficNote() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(isInternal());
    sync();
    window.addEventListener('todo-tree:internal', sync);
    return () => window.removeEventListener('todo-tree:internal', sync);
  }, []);
  if (!on) return null;
  return (
    <span className="internal-chip" title="Visits from this browser are marked as internal and filtered out of the statistics. Open TwigList with ?internal=0 to undo.">
      Internal traffic
    </span>
  );
}

/** A link-styled button that asks again. */
export function CookieSettings({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className ?? 'cookie-settings'}
      onClick={resetConsent}
    >
      Cookie settings
    </button>
  );
}
