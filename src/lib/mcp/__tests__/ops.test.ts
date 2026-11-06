import { describe, expect, it } from 'vitest';
import * as Ops from '../ops';
import * as M from '@/lib/tree/model';
import type { TreeDoc, TreeNode } from '@/lib/tree/types';

const node = (id: string, type: TreeNode['type'], title: string, children: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({
  id,
  type,
  title,
  done: false,
  collapsed: false,
  children,
  ...extra,
});

/** Work: Client A (todos a1, a2 done, steps), Secret (sensitive, with s1), Notes note. Personal: Gym. */
const work = (): Ops.TreeRef => ({
  id: 'main',
  name: 'Work',
  doc: {
    v: 5,
    meetings: [],
    settings: { idleDays: 7 },
    root: node('root', 'root', 'Work', [
      node('ca', 'project', 'Client A', [
        node('a1', 'todo', 'Draft proposal', [], { due: '2026-11-08', high: true, notes: 'Budget **5k**' }),
        node('a2', 'todo', 'Kickoff', [], { done: true, doneAt: 1 }),
        node('a3', 'todo', 'Report', [node('s1x', 'todo', 'Collect numbers'), node('s2x', 'todo', 'Write summary')]),
      ]),
      node('sec', 'project', 'Salary talk', [node('s1', 'todo', 'Ask for raise', [], { due: '2026-11-07' })], { sensitive: true }),
      node('dup1', 'todo', 'Follow up'),
      node('cb', 'project', 'Client B', [node('dup2', 'todo', 'Follow up')]),
    ]),
  } as TreeDoc,
});
const personal = (): Ops.TreeRef => ({
  id: 'p2',
  name: 'Personal',
  doc: { v: 5, meetings: [], settings: { idleDays: 7 }, root: node('root', 'root', 'Personal', [node('g', 'todo', 'Gym', [], { due: '2026-11-06' })]) } as TreeDoc,
});
const TODAY = '2026-11-06';
const ok = (c: Ops.Change) => {
  if ('error' in c) throw new Error(c.error);
  return c;
};
const find = (doc: TreeDoc, id: string) => M.buildIndex(doc.root).byId.get(id)!;

describe('MCP tools: reading', () => {
  it('outlines a tree with ids, deadlines and priority, and summarises finished todos', () => {
    const o = Ops.outline(work(), { today: TODAY });
    expect(o).toContain('Tree “Work” (tree id: main)');
    expect(o).toContain('- [project] Client A (id: ca) · 1/4 done');
    expect(o).toContain('[ ] Draft proposal (id: a1) · high priority · due 2026-11-08 (in 2 days) · has notes');
    expect(o).not.toContain('Kickoff');
    expect(o).toContain('(+1 finished todo; include_done to see them)');
    expect(Ops.outline(work(), { today: TODAY, includeDone: true })).toContain('[x] Kickoff (id: a2)');
  });

  it('never shows sensitive items, only that something is hidden', () => {
    const o = Ops.outline(work(), { today: TODAY, includeDone: true, notes: true });
    expect(o).toContain('🔒 (a sensitive item, hidden)');
    expect(o).not.toMatch(/Salary|raise|s1\b|sec\b/);
    expect(Ops.search([work()], 'raise')).toEqual([]);
    expect(Ops.search([work()], 'salary')).toEqual([]);
    expect('error' in Ops.findItem([work()], 'sec')).toBe(true);
    expect('error' in Ops.findItem([work()], 'Ask for raise')).toBe(true);
    expect(Ops.upcoming([work()], TODAY, 7).due.map((h) => h.id)).not.toContain('s1');
    expect(Ops.counts(work())).toEqual({ open: 5, projects: 2 });
  });

  it('shows one branch with its notes and path', () => {
    const o = Ops.outline(work(), { today: TODAY, itemId: 'a3' });
    expect(o).toContain('Todo “Report” (id: a3) in tree “Work”, path: Work / Client A');
    expect(o).toContain('[ ] Collect numbers (id: s1x)');
  });

  it('searches titles and notes in all trees, best match first', () => {
    expect(Ops.search([work(), personal()], 'budget').map((h) => h.id)).toEqual(['a1']);
    expect(Ops.search([work(), personal()], 'gym')[0]).toMatchObject({ id: 'g', treeName: 'Personal', path: 'Personal' });
    expect(Ops.search([work()], 'follow up').map((h) => h.path)).toEqual(['Work', 'Work / Client B']);
  });

  it('lists what is due soon or overdue, then other high-priority items', () => {
    const u = Ops.upcoming([work(), personal()], TODAY, 7);
    expect(u.due.map((h) => [h.id, h.daysLeft])).toEqual([
      ['g', 0],
      ['a1', 2],
    ]);
    expect(Ops.upcoming([work()], TODAY, 1).high.map((h) => h.id)).toEqual(['a1']);
  });
});

describe('MCP tools: finding items', () => {
  it('by id or exact title, case-insensitive; ambiguous titles list the candidates', () => {
    expect(Ops.findItem([work()], 'a1')).toMatchObject({ node: { id: 'a1' } });
    expect(Ops.findItem([work(), personal()], 'GYM')).toMatchObject({ tree: { id: 'p2' }, node: { id: 'g' } });
    const amb = Ops.findItem([work()], 'Follow up');
    expect('error' in amb && amb.error).toMatch(/More than one[\s\S]*id: dup1[\s\S]*id: dup2/);
    expect('error' in Ops.findItem([work()], 'nope')).toBe(true);
  });

  it('trees by id or name; the first tree by default', () => {
    expect(Ops.findTree([work(), personal()], 'personal')).toMatchObject({ id: 'p2' });
    expect(Ops.findTree([work(), personal()])).toMatchObject({ id: 'main' });
    expect('error' in Ops.findTree([work()], 'Hobby')).toBe(true);
  });
});

describe('MCP tools: changing', () => {
  it('adds projects and todos with details, following the tree rules', () => {
    const t = work();
    const c = ok(Ops.addItem(t, find(t.doc, 'ca'), 'todo', { title: '  Send   invoice ', due: '2026-11-20', high: true, notes: 'Ref 12' }));
    const n = find(c.doc, c.itemId!);
    expect(n).toMatchObject({ type: 'todo', title: 'Send invoice', due: '2026-11-20', high: true, notes: 'Ref 12' });
    expect(n.touched).toBeGreaterThan(0); // counts as activity, like in the app
    expect(c.message).toContain('to “Client A”');
    expect(ok(Ops.addItem(t, null, 'project', { title: 'New client' })).message).toContain('top level of “Work”');
    expect(Ops.addItem(t, find(t.doc, 'a1'), 'project', { title: 'x' })).toMatchObject({ error: expect.stringMatching(/can’t hold a project/) });
    expect(Ops.addItem(t, null, 'todo', { title: '   ' })).toMatchObject({ error: expect.any(String) });
    expect(Ops.addItem(t, null, 'todo', { title: 'x', due: '14-11-2026' })).toMatchObject({ error: expect.stringMatching(/YYYY-MM-DD/) });
    expect(Ops.addItem(t, null, 'note', { title: 'x', high: true })).toMatchObject({ error: expect.any(String) });
  });

  it('ticks todos off (with their steps), and back', () => {
    const t = work();
    const c = ok(Ops.setDone(t, find(t.doc, 'a3'), true, 1000));
    expect(find(c.doc, 's1x')).toMatchObject({ done: true, doneAt: 1000 });
    expect(c.message).toBe('Ticked off “Report” and its 2 steps.');
    expect(Ops.setDone(t, find(t.doc, 'a2'), true)).toMatchObject({ error: expect.stringMatching(/already done/) });
    expect(ok(Ops.setDone(t, find(t.doc, 'a2'), false)).message).toBe('Unticked “Kickoff”.');
    expect(Ops.setDone(t, find(t.doc, 'ca'), true)).toMatchObject({ error: expect.stringMatching(/Only todos/) });
  });

  it('updates only what is given', () => {
    const t = work();
    const c = ok(Ops.updateItem(t, find(t.doc, 'a1'), { title: 'Final proposal', due: null, high: false }));
    expect(find(c.doc, 'a1')).toMatchObject({ title: 'Final proposal', notes: 'Budget **5k**' });
    expect(find(c.doc, 'a1').due).toBeUndefined();
    expect(find(c.doc, 'a1').high).toBeUndefined();
    expect(c.message).toBe('Updated “Final proposal”: title → “Final proposal”, deadline removed, normal priority.');
    expect(Ops.updateItem(t, find(t.doc, 'a1'), {})).toMatchObject({ error: expect.stringMatching(/Nothing to change/) });
    expect(Ops.updateItem(t, find(t.doc, 'a1'), { title: 'Draft proposal' })).toMatchObject({ error: expect.any(String) });
  });

  it('moves items within the tree, never into themselves', () => {
    const t = work();
    const c = ok(Ops.moveItem(t, find(t.doc, 'dup1'), find(t.doc, 'cb')));
    expect(M.buildIndex(c.doc.root).parentOf.get('dup1')!.id).toBe('cb');
    expect(ok(Ops.moveItem(t, find(t.doc, 'a1'), null)).message).toContain('top level');
    expect(Ops.moveItem(t, find(t.doc, 'ca'), find(t.doc, 'a1'))).toMatchObject({ error: expect.any(String) });
    expect(Ops.moveItem(t, find(t.doc, 'ca'), find(t.doc, 'a3'))).toMatchObject({ error: expect.stringMatching(/inside itself|can’t hold/) });
  });
});
