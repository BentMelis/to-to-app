import { beforeEach, describe, expect, it } from 'vitest';
import * as T from '../trees';
import { starter } from '../model';

const three = (): T.TreeList => ({
  trees: [
    { id: 'main', name: 'Work' },
    { id: 'b', name: 'Personal' },
    { id: 'c', name: 'Side project' },
  ],
  lastOpenedId: 'b',
});

describe('tree list', () => {
  it('adds, renames and reorders trees', () => {
    const r = T.addTree(three(), '  Household  ')!;
    expect(r.list.trees.map((t) => t.name)).toEqual(['Work', 'Personal', 'Side project', 'Household']);
    expect(r.list.lastOpenedId).toBe(r.id);
    expect(T.addTree(three(), '   ')).toBeNull();
    expect(T.renameTree(three(), 'c', 'Blog').trees[2].name).toBe('Blog');
    expect(T.renameTree(three(), 'c', '  ').trees[2].name).toBe('Side project');
    expect(T.moveTree(three(), 'c', -1).trees.map((t) => t.id)).toEqual(['main', 'c', 'b']);
    expect(T.moveTree(three(), 'main', -1)).toEqual(three());
  });

  it('stops at the maximum', () => {
    let l = T.firstList();
    for (let i = 1; i < T.MAX_TREES; i++) l = T.addTree(l, `Tree ${i}`)!.list;
    expect(l.trees).toHaveLength(T.MAX_TREES);
    expect(T.addTree(l, 'One too many')).toBeNull();
  });

  it('never removes the last tree, opens a neighbour, and restores in place', () => {
    expect(T.removeTree(T.firstList(), 'main')).toBeNull();
    const r = T.removeTree(three(), 'b')!;
    expect(r.list.trees.map((t) => t.id)).toEqual(['main', 'c']);
    expect(r.list.lastOpenedId).toBe('c');
    expect(T.removeTree(three(), 'c')!.list.lastOpenedId).toBe('b'); // not the open one: stays
    const back = T.restoreTree(r.list, r.removed);
    expect(back.trees.map((t) => t.id)).toEqual(['main', 'b', 'c']);
    expect(back.lastOpenedId).toBe('b');
    // Undoing the removal of a tree that wasn't open doesn't switch trees.
    const other = T.removeTree(three(), 'c')!;
    expect(T.restoreTree(other.list, other.removed).lastOpenedId).toBe('b');
  });

  it('parses saved lists defensively', () => {
    expect(T.parseList('nope')).toBeNull();
    expect(T.parseList({ trees: [] })).toBeNull();
    const l = T.parseList({ trees: [{ id: 'a', name: ' A ' }, { id: 'a', name: 'dup' }, { id: '../x', name: 'bad' }], lastOpenedId: 'gone' })!;
    expect(l).toEqual({ trees: [{ id: 'a', name: 'A' }], lastOpenedId: 'a' });
  });

  it('starts a new tree empty, without meetings', () => {
    const d = T.emptyTree('Personal');
    expect(d.root.children).toEqual([]);
    expect(d.meetings).toEqual([]);
    expect(d.settings?.idleDays).toBe(7);
    expect(T.countItems(starter())).toBeGreaterThan(5);
    expect(T.countItems(d)).toBe(0);
  });
});

/* ---------- Storage: migration of the single tree from before ---------- */

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('library storage', () => {
  let ls: MemoryStorage;
  beforeEach(() => {
    ls = new MemoryStorage();
    (globalThis as unknown as { window: unknown }).window = { localStorage: ls };
  });
  const load = async () => (await import('@/lib/storage')).localLibrary;

  it('migrates the existing tree into the first tree, named after its root, without loss', async () => {
    const old = starter();
    old.root.title = 'Bent’s work';
    old.meetings.push({ id: 'sync', name: 'Weekly sync', color: 'teal' });
    ls.setItem('todo-tree:v1', JSON.stringify(old));
    ls.setItem('todo-tree:filters', JSON.stringify({ high: true }));
    const lib = await load();
    const list = await lib.loadList();
    expect(list).toEqual({ trees: [{ id: 'main', name: 'Bent’s work' }], lastOpenedId: 'main' });
    const doc = await lib.adapter('main').load();
    expect(doc?.root.children.length).toBe(old.root.children.length);
    expect(doc?.meetings.map((m) => m.id)).toEqual(['standup', 'sync']);
    expect(JSON.parse(ls.getItem('todo-tree:filters:main')!)).toEqual({ high: true });
    expect(ls.getItem('todo-tree:v1')).not.toBeNull(); // safety copy left alone
    // Second start: no second migration.
    await lib.saveList(T.addTree(list, 'Personal')!.list);
    expect((await lib.loadList()).trees).toHaveLength(2);
  });

  it('first run without data gives one tree called My projects', async () => {
    const lib = await load();
    expect(await lib.loadList()).toEqual(T.firstList());
    expect(await lib.adapter('main').load()).toBeNull(); // the canvas then shows the starter tree
  });

  it('keeps trees apart and sweeps documents of deleted trees', async () => {
    const lib = await load();
    let list = await lib.loadList();
    const r = T.addTree(list, 'Personal')!;
    list = r.list;
    await lib.saveList(list);
    await lib.adapter('main').save(starter());
    await lib.adapter(r.id).save(T.emptyTree('Personal'));
    expect((await lib.adapter(r.id).load())?.root.children).toEqual([]);
    expect((await lib.adapter('main').load())?.root.children.length).toBeGreaterThan(0);
    // Deleted from the list, but the app closed before the undo window ended.
    await lib.saveList(T.removeTree(list, r.id)!.list);
    ls.setItem(`todo-tree:view:${r.id}`, '{"x":1,"y":2,"k":1}');
    await lib.loadList();
    expect(ls.getItem(`todo-tree:tree:${r.id}`)).toBeNull();
    expect(ls.getItem(`todo-tree:view:${r.id}`)).toBeNull();
    expect(ls.getItem('todo-tree:tree:main')).not.toBeNull();
  });
});
