import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_PREFS, loadUserPrefs, parseUserPrefs, saveUserPref } from '../userPrefs';

describe('user view preferences (KAN-44)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts from sensible defaults: focus on, done items and sensitive items shown', () => {
    expect(loadUserPrefs()).toEqual({ focus: true, hideDone: false, hideSensitive: false });
    expect(DEFAULT_USER_PREFS.focus).toBe(true);
  });

  it('remembers each choice without touching the others', () => {
    saveUserPref('focus', false);
    saveUserPref('hideDone', true);
    expect(loadUserPrefs()).toEqual({ focus: false, hideDone: true, hideSensitive: false });
    saveUserPref('hideSensitive', true);
    expect(loadUserPrefs()).toEqual({ focus: false, hideDone: true, hideSensitive: true });
  });

  it('takes over the old hide-sensitive key, then drops it', () => {
    store.set('todo-tree:hide-sensitive', '1');
    expect(loadUserPrefs().hideSensitive).toBe(true);
    saveUserPref('focus', false);
    expect(store.has('todo-tree:hide-sensitive')).toBe(false);
    expect(loadUserPrefs()).toEqual({ focus: false, hideDone: false, hideSensitive: true });
  });

  it('ignores malformed values', () => {
    expect(parseUserPrefs('{"focus":"no","hideDone":1,"extra":true}')).toEqual(DEFAULT_USER_PREFS);
    expect(parseUserPrefs('not json')).toEqual(DEFAULT_USER_PREFS);
  });
});
