/**
 * View preferences that belong to the person, not to a tree (KAN-44): remembered in this browser for all trees.
 * Per-tree view state (camera, filters, last meeting tab) lives in `prefs` in ./index.ts.
 *
 * Kept as one small object so it can move to the account as-is once there is one (KAN-39 `users.settings`, KAN-43).
 */
export interface UserPrefs {
  /** Selecting something fades everything outside its project. */
  focus: boolean;
  /** Finished todos hidden from the tree. */
  hideDone: boolean;
  /** Sensitive items shown as locked placeholders (KAN-20). */
  hideSensitive: boolean;
}

export const DEFAULT_USER_PREFS: UserPrefs = { focus: true, hideDone: false, hideSensitive: false };

const KEY = 'todo-tree:user-prefs';
/** Before KAN-44 the sensitive toggle had a key of its own. */
const LEGACY_HIDE_SENSITIVE = 'todo-tree:hide-sensitive';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Anything missing or malformed falls back to the default; unknown fields are dropped. */
export function parseUserPrefs(raw: string | null, legacyHideSensitive: string | null = null): UserPrefs {
  let v: Partial<Record<keyof UserPrefs, unknown>> = {};
  try {
    const p = JSON.parse(raw ?? 'null');
    if (p && typeof p === 'object') v = p;
  } catch {
    /* defaults */
  }
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
  return {
    focus: bool(v.focus, DEFAULT_USER_PREFS.focus),
    hideDone: bool(v.hideDone, DEFAULT_USER_PREFS.hideDone),
    hideSensitive: bool(v.hideSensitive, legacyHideSensitive === '1'),
  };
}

export function loadUserPrefs(): UserPrefs {
  return parseUserPrefs(get(KEY), get(LEGACY_HIDE_SENSITIVE));
}

export function saveUserPref<K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) {
  const next = { ...loadUserPrefs(), [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_HIDE_SENSITIVE);
  } catch {
    /* private mode or full: not remembered */
  }
}
