import { describe, expect, it } from 'vitest';
import * as M from '../model';
import { archiveItem, autoArchive, canArchive, deleteArchived, dueForArchive, entryItems, restoreItem } from '../archive';
import { addDays } from '../dates';
import type { TreeDoc, TreeNode } from '../types';

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 1, 12).getTime(); // 1 Oct 2026, noon local
const today = (days: number) => addDays('2026-10-01', days);
const todo = (id: string, done = false, doneAt?: number, children: TreeNode[] = []): TreeNode =>
  ({ id, type: 'todo', title: id, done, collapsed: false, children, ...(done && doneAt ? { doneAt } : {}) });
const project = (id: string, children: TreeNode[]): TreeNode => ({ id, type: 'project', title: id, done: false, collapsed: false, children });

/** Client: a (done day 0), b (open), c (done day 3), steps (a todo whose two steps are done). Side: x (done day 0). */
const doc = (): TreeDoc => ({
  v: 5,
  meetings: [{ id: 'standup', name: 'Standup', color: 'amber' }],
  root: {
    id: 'root', type: 'root', title: 'R', done: false, collapsed: false,
    children: [
      project('client', [
        todo('a', true, T0),
        todo('b'),
        todo('c', true, T0 + 3 * DAY),
        todo('steps', false, undefined, [todo('s1', true, T0), todo('s2', true, T0 + DAY)]),
        { id: 'n1', type: 'note', title: 'note', done: false, collapsed: false, children: [] },
      ]),
      project('side', [todo('x', true, T0)]),
    ],
  },
});
const ids = (n: TreeNode) => n.children.map((c) => c.id);
const stats = (d: TreeDoc, id: string) => M.buildIndex(d.root).stats.get(id);

describe('archive (KAN-28)', () => {
  it('stores when a todo was finished, and forgets it when unticked', () => {
    let d = doc();
    d = M.toggleDone(d, 'b', T0 + 5 * DAY)!.doc;
    expect(M.buildIndex(d.root).byId.get('b')!.doneAt).toBe(T0 + 5 * DAY);
    d = M.toggleDone(d, 'b')!.doc;
    expect(M.buildIndex(d.root).byId.get('b')!.doneAt).toBeUndefined();
  });

  it('archives finished todos a week after they were ticked, not before', () => {
    expect(dueForArchive(doc(), today(6))).toEqual([]);
    expect(dueForArchive(doc(), today(7))).toEqual(['a', 'x']);
    // A todo with steps goes as a whole, a week after its last step; steps never go on their own.
    expect(dueForArchive(doc(), today(8))).toEqual(['a', 'steps', 'x']);
  });

  it('never takes projects, open todos, flagged todos or steps of an open todo', () => {
    const d = doc();
    d.root.children[0].children[0].flags = { standup: 'mention' };
    const open = todo('parent', false, undefined, [todo('p1', true, T0), todo('p2')]);
    d.root.children[1].children.push(open);
    expect(dueForArchive(d, today(30))).toEqual(['c', 'steps', 'x']);
  });

  it('moves them out of the tree but keeps counting them, so progress stays the same', () => {
    const before = stats(doc(), 'client');
    const r = autoArchive(doc(), today(7), T0 + 7 * DAY)!;
    expect(r.todos).toBe(2);
    expect(ids(r.doc.root.children[0])).toEqual(['b', 'c', 'steps', 'n1']);
    expect(stats(r.doc, 'client')).toEqual({ ...before, arch: 1 });
    expect(r.doc.archive!.map((e) => [e.node.id, e.parentId, e.index, e.path.join('/'), e.how])).toEqual([
      ['a', 'client', 0, 'client', 'auto'],
      ['x', 'side', 0, 'side', 'auto'],
    ]);
    // "side" now only has archived work: complete, with nothing left in the tree.
    expect(M.isComplete(M.buildIndex(r.doc.root), r.doc.root.children[1])).toBe(true);
  });

  it('archives by hand: finished todos and complete projects only', () => {
    const d = doc();
    const idx = M.buildIndex(d.root);
    expect(canArchive(idx, idx.byId.get('a')!)).toBe(true);
    expect(canArchive(idx, idx.byId.get('b')!)).toBe(false);
    expect(canArchive(idx, idx.byId.get('s1')!)).toBe(false); // a step
    expect(canArchive(idx, idx.byId.get('client')!)).toBe(false); // open todos
    expect(canArchive(idx, idx.byId.get('side')!)).toBe(true);
    const r = archiveItem(d, 'side')!;
    expect(ids(r.doc.root)).toEqual(['client']);
    expect(stats(r.doc, 'root')).toMatchObject({ total: 6, done: 5, arch: 1 });
  });

  it('a project takes the todos archived from it earlier along, and restores as a whole', () => {
    let d = autoArchive(doc(), today(7), T0 + 7 * DAY)!.doc; // a, x
    d = archiveItem(d, 'side', T0 + 8 * DAY)!.doc; // side is complete (only archived work)
    const e = d.archive!.find((x) => x.node.id === 'x')!;
    expect(e.within).toBe('side');
    expect(entryItems(d, 'side')).toBe(2);
    const r = restoreItem(d, 'side', T0 + 9 * DAY)!;
    expect(ids(r.doc.root)).toEqual(['client', 'side']);
    expect(r.doc.archive!.find((x) => x.node.id === 'x')!.within).toBeUndefined();
    // Still counts its archived todo.
    expect(stats(r.doc, 'side')).toMatchObject({ total: 1, done: 1, arch: 1 });
    expect(stats(r.doc, 'root')!.arch).toBe(2);
  });

  it('restores a todo to its old place, still done, with a fresh week before it can go again', () => {
    const d = autoArchive(doc(), today(7), T0 + 7 * DAY)!.doc;
    const r = restoreItem(d, 'a', T0 + 10 * DAY)!;
    expect(ids(r.doc.root.children[0])).toEqual(['a', 'b', 'c', 'steps', 'n1']);
    expect(stats(r.doc, 'client')).toEqual({ total: 5, done: 4 });
    expect(r.note).toBeUndefined();
    expect(dueForArchive(r.doc, today(16))).not.toContain('a');
    expect(dueForArchive(r.doc, today(17))).toContain('a');
  });

  it('restoring a todo whose project is archived brings the project back with only that todo', () => {
    let d = autoArchive(doc(), today(7), T0 + 7 * DAY)!.doc; // a, x archived
    // Finish client and archive it.
    d = M.toggleDone(d, 'b', T0 + 7 * DAY)!.doc;
    d = archiveItem(d, 'client', T0 + 8 * DAY)!.doc;
    expect(ids(d.root)).toEqual(['side']);
    let r = restoreItem(d, 'a', T0 + 9 * DAY)!;
    expect(r.note).toMatch(/came back with just this item/);
    expect(ids(r.doc.root)).toEqual(['client', 'side']);
    expect(ids(r.doc.root.children[0])).toEqual(['a']);
    expect(stats(r.doc, 'client')).toEqual({ total: 1, done: 1 });
    // Restoring the project later merges the rest back in, without counting anything twice.
    r = restoreItem(r.doc, 'client', T0 + 10 * DAY)!;
    expect(ids(r.doc.root.children[0])).toEqual(['a', 'b', 'c', 'steps', 'n1']);
    expect(stats(r.doc, 'client')).toEqual({ total: 5, done: 5 });
    expect(r.doc.archive!.map((e) => e.node.id)).toEqual(['x']);
    expect(stats(r.doc, 'root')).toMatchObject({ total: 6, done: 6, arch: 1 }); // x is still archived
  });

  it('restores at the top level when its project was deleted', () => {
    let d = autoArchive(doc(), today(7), T0 + 7 * DAY)!.doc;
    d = M.removeNode(d, 'side')!.doc;
    const r = restoreItem(d, 'x')!;
    expect(r.note).toMatch(/top level/);
    expect(ids(r.doc.root)).toEqual(['client', 'x']);
  });

  it('deletes for good, and stops counting it', () => {
    const d = autoArchive(doc(), today(7), T0 + 7 * DAY)!.doc;
    const r = deleteArchived(d, 'a')!;
    expect(r.items).toBe(1);
    expect(r.doc.archive!.map((e) => e.node.id)).toEqual(['x']);
    expect(stats(r.doc, 'client')).toEqual({ total: 4, done: 3 });
  });

  it('survives saving and loading; older trees count finished todos as done today', () => {
    const d = autoArchive(doc(), today(7), T0 + 7 * DAY)!.doc;
    const back = M.parseDoc(JSON.stringify(d))!;
    expect(back.archive!.map((e) => e.node.id)).toEqual(['a', 'x']);
    expect(back.root.children[0].arch).toBe(1);
    const old = { v: 4, meetings: [], root: { id: 'root', type: 'root', title: 'R', children: [{ id: 'z', type: 'todo', title: 'z', done: true, children: [] }] } };
    const before = Date.now();
    expect(M.parseDoc(old)!.root.children[0].doneAt).toBeGreaterThanOrEqual(before);
  });
});
