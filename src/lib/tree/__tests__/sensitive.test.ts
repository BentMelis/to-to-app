import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anySensitive, initialHideSensitive, loadAutoHide, parseAutoHide, resetStartCheck, saveAutoHide, saveHideSensitive, sealedIds } from '../sensitive';
import { buildIndex, parseDoc, starter, toggleSensitive, worstDueBelow } from '../model';
import { applyFilters, visibleTree } from '../layout';

function doc() {
  const d = starter();
  // Project one › Build › First draft: make "Build" sensitive and give a todo inside it a deadline + high priority.
  const p1 = d.root.children[0];
  const build = p1.children.find((c) => c.title === 'Build')!;
  build.sensitive = true;
  build.children[1].high = true;
  build.children[1].due = '2026-10-22';
  return { d, p1, build };
}

describe('sensitive items', () => {
  it('seals the item and everything inside it, nothing else', () => {
    const { d, build, p1 } = doc();
    const s = sealedIds(d.root);
    expect(s.has(build.id)).toBe(true);
    expect(s.has(build.children[0].id)).toBe(true);
    expect(s.has(build.children[0].children[0].id)).toBe(true);
    expect(s.has(p1.id)).toBe(false);
    expect(s.has('root')).toBe(false);
  });

  it('marks and unmarks, never the root, and survives saving', () => {
    const { d, p1 } = doc();
    const on = toggleSensitive(d, p1.id)!;
    expect(on.sensitive).toBe(true);
    expect(toggleSensitive(on.doc, p1.id)!.sensitive).toBe(false);
    expect(toggleSensitive(d, 'root')).toBeNull();
    const back = parseDoc(JSON.stringify(on.doc))!;
    expect(back.root.children[0].sensitive).toBe(true);
  });

  it('a hidden branch stays closed and its matches do not show up in filters or hints', () => {
    const { d, build, p1 } = doc();
    const idx = buildIndex(d.root);
    const s = sealedIds(d.root);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set(), sealed: s });
    expect(vis.items.some((i) => i.id === build.id)).toBe(true);
    expect(vis.items.some((i) => i.id === build.children[0].id)).toBe(false);
    expect(applyFilters(d.root, idx, { high: true, dueSoon: false }, '2026-10-21', undefined, s)!.matches).toBe(0);
    expect(applyFilters(d.root, idx, { high: true, dueSoon: false }, '2026-10-21')!.matches).toBe(1);
    expect(worstDueBelow(p1, idx, '2026-10-21')).toBe('urgent');
    expect(worstDueBelow(p1, idx, '2026-10-21', s)).toBeNull();
  });
});

describe('automatic hiding (KAN-38)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    resetStartCheck();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is off by default and survives bad stored values', () => {
    expect(loadAutoHide()).toEqual({ leave: false, start: false, again: 0 });
    expect(parseAutoHide('{"leave":"yes","start":true,"again":-4}')).toEqual({ leave: false, start: true, again: 0 });
    expect(parseAutoHide('not json')).toEqual({ leave: false, start: false, again: 0 });
  });

  it('remembers the settings', () => {
    saveAutoHide({ leave: true, start: false, again: 15 });
    expect(loadAutoHide()).toEqual({ leave: true, start: false, again: 15 });
  });

  it('start hidden: only for the first tree opened after the page loads', () => {
    saveAutoHide({ leave: false, start: true, again: 0 });
    saveHideSensitive(false);
    expect(initialHideSensitive()).toEqual({ hidden: true, auto: true });
    // The user shows them again, then switches to another tree: that choice stands.
    saveHideSensitive(false);
    expect(initialHideSensitive()).toEqual({ hidden: false, auto: false });
  });

  it('without start hidden, the last choice is kept', () => {
    saveHideSensitive(true);
    expect(initialHideSensitive()).toEqual({ hidden: true, auto: false });
    resetStartCheck();
    saveHideSensitive(false);
    expect(initialHideSensitive()).toEqual({ hidden: false, auto: false });
  });

  it('knows whether there is anything to hide', () => {
    const { d } = doc();
    expect(anySensitive(d.root)).toBe(true);
    expect(anySensitive(starter().root)).toBe(false);
  });
});
