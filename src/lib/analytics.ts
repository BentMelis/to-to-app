/**
 * Google Analytics, only with consent.
 *
 * - Nothing from Google loads until the visitor clicks "Accept". "Decline" (or Global Privacy Control) means
 *   nothing is ever sent.
 * - Events never contain anything someone wrote: no titles, notes, tree or meeting names. Only what happened.
 * - The choice is remembered in this browser and can be changed any time ("Cookie settings").
 */

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-NE8N3PVBMS';
const KEY = 'todo-tree:consent';
/** Bump when what we measure changes, so people are asked again. */
const VERSION = 1;

export type Consent = 'granted' | 'denied';

/*
 * Internal traffic: our own visits are marked so GA's "Internal traffic" data filter can leave them out.
 * Visit any page with ?internal=1 to mark this browser, ?internal=0 to unmark it. Remembered per browser.
 */
const INTERNAL_KEY = 'todo-tree:internal';

export function isInternal(): boolean {
  try {
    return localStorage.getItem(INTERNAL_KEY) === '1';
  } catch {
    return false;
  }
}

/** Read ?internal=1 / ?internal=0 from the address and remember it. Runs before analytics loads. */
export function applyInternalParam() {
  if (typeof window === 'undefined') return;
  const v = new URLSearchParams(window.location.search).get('internal');
  if (v !== '1' && v !== '0') return;
  try {
    if (v === '1') localStorage.setItem(INTERNAL_KEY, '1');
    else localStorage.removeItem(INTERNAL_KEY);
  } catch {
    /* not remembered */
  }
  // Keep the address clean so the flag isn't shared by copying the link.
  const url = new URL(window.location.href);
  url.searchParams.delete('internal');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event('todo-tree:internal'));
}

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

/** The stored choice, or null when the visitor hasn't decided yet. */
export function getConsent(): Consent | null {
  if (typeof window === 'undefined') return null;
  if (navigator.globalPrivacyControl) return 'denied';
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as { v: number; c: Consent } | null;
    return raw && raw.v === VERSION && (raw.c === 'granted' || raw.c === 'denied') ? raw.c : null;
  } catch {
    return null;
  }
}

export function setConsent(c: Consent) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, c, at: new Date().toISOString().slice(0, 10) }));
  } catch {
    /* not remembered: they'll be asked again next time */
  }
  if (c === 'granted') loadAnalytics();
  else stopAnalytics();
  window.dispatchEvent(new Event('todo-tree:consent'));
}

/** Ask again (from "Cookie settings"). */
export function resetConsent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('todo-tree:consent'));
}

let loaded = false;

/** Load gtag.js. Only ever called after consent. */
export function loadAnalytics() {
  if (loaded || typeof window === 'undefined' || getConsent() !== 'granted') return;
  loaded = true;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js expects the arguments object itself.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // Our own visits: filtered out by GA's "Internal traffic" data filter.
    ...(isInternal() ? { traffic_type: 'internal' } : {}),
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

/** Withdrawn: stop sending and remove Google's cookies. */
function stopAnalytics() {
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = true;
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (!name.startsWith('_ga')) continue;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
  }
}

/** What people do with the product. No content, ever: only names from this list and small, fixed parameters. */
export type AppEvent =
  | 'open_app'
  | 'todo_completed'
  | 'tree_created'
  | 'tree_switched'
  | 'tree_deleted'
  | 'notes_opened'
  | 'meeting_list_copied'
  | 'filter_used'
  | 'backup_downloaded'
  | 'backup_restored'
  | 'item_moved_to_tree'
  | 'sensitive_marked'
  | 'sensitive_view_toggled'
  | 'sensitive_auto_hidden'
  | 'items_archived'
  | 'archive_opened'
  | 'archive_restored'
  | 'archive_deleted'
  | 'item_menu_opened'
  | 'item_menu_action';

export function track(event: AppEvent, params?: Record<string, string | number | boolean>) {
  if (!loaded || typeof window === 'undefined' || !window.gtag || getConsent() !== 'granted') return;
  window.gtag('event', event, params ?? {});
}
