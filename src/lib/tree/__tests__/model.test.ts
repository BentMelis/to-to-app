import { describe, expect, it } from 'vitest';
import * as M from '../model';
import { visibleTree, stackId } from '../layout';
import type { TreeDoc } from '../types';

const doc = (): TreeDoc => ({
  v: 2,
  root: {
    id: 'root', type: 'root', title: 'R', done: false, collapsed: false,
    children: [
      { id: 'p1', type: 'project', title: 'P1', done: false, collapsed: false, children: [
        { id: 't1', type: 'todo', title: 'a', done: true, collapsed: false, children: [] },
        { id: 't2', type: 'todo', title: 'b', done: false, collapsed: false, children: [] },
        { id: 't3', type: 'todo', title: 'c', done: true, collapsed: false, children: [] },
        { id: 'n1', type: 'note', title: 'note', done: false, collapsed: false, children: [] },
      ] },
      { id: 'p2', type: 'project', title: 'P2', done: false, collapsed: false, children: [
        { id: 't4', type: 'todo', title: 'd', done: false, collapsed: false, children: [] },
      ] },
    ],
  },
});

describe('stats', () => {
  it('counts todos only', () => {
    const idx = M.buildIndex(doc().root);
    expect(idx.stats.get('p1')).toEqual({ total: 3, done: 2 });
    expect(idx.stats.get('root')).toEqual({ total: 4, done: 2 });
  });
});

describe('moveTo (drag & drop)', () => {
  it('moves a todo into another project before a sibling', () => {
    const r = M.moveTo(doc(), 't2', 'p2', 't4')!;
    expect(r.doc!.root.children[1].children.map((c) => c.id)).toEqual(['t2', 't4']);
    expect(r.doc!.root.children[0].children.map((c) => c.id)).toEqual(['t1', 't3', 'n1']);
  });
  it('appends when beforeId is null', () => {
    const r = M.moveTo(doc(), 't1', 'p2', null)!;
    expect(r.doc!.root.children[1].children.map((c) => c.id)).toEqual(['t4', 't1']);
  });
  it('refuses moving a project into itself or its descendants', () => {
    expect(M.moveTo(doc(), 'p1', 'p1', null)).toHaveProperty('error');
  });
  it('refuses a project inside a todo', () => {
    expect(M.moveTo(doc(), 'p2', 't2', null)).toHaveProperty('error');
  });
  it('refuses anything inside a note', () => {
    expect(M.moveTo(doc(), 't2', 'n1', null)).toHaveProperty('error');
  });
  it('does not mutate the input document', () => {
    const d = doc();
    const snap = JSON.stringify(d);
    M.moveTo(d, 't2', 'p2', null);
    expect(JSON.stringify(d)).toBe(snap);
  });
});

describe('done items sink and stack', () => {
  it('stacks two or more finished siblings after the open ones', () => {
    const d = doc();
    const idx = M.buildIndex(d.root);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set() });
    const kids = vis.kids.get('p1')!;
    expect(kids.map((k) => k.id)).toEqual(['t2', 'n1', stackId('p1')]);
  });
  it('shows them one by one when the stack is opened', () => {
    const d = doc();
    const idx = M.buildIndex(d.root);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set(['p1']) });
    expect(vis.kids.get('p1')!.map((k) => k.id)).toEqual(['t2', 'n1', 't1', 't3']);
  });
  it('hides them entirely with hide done', () => {
    const d = doc();
    const idx = M.buildIndex(d.root);
    const vis = visibleTree(d.root, idx, { hideDone: true, openStacks: new Set() });
    expect(vis.kids.get('p1')!.map((k) => k.id)).toEqual(['t2', 'n1']);
  });
  it('moveSibling swaps within the same group', () => {
    const r = M.moveSibling(doc(), 't3', -1)!;
    expect(r.doc.root.children[0].children.map((c) => c.id)).toEqual(['t3', 't2', 't1', 'n1']);
  });
});

describe('focus', () => {
  it('finds the nearest project', () => {
    const idx = M.buildIndex(doc().root);
    expect(M.focusProjectOf(idx, 't4')).toBe('p2');
    expect(M.focusProjectOf(idx, 'p1')).toBe('p1');
    expect(M.focusProjectOf(idx, 'root')).toBeNull();
  });
});

describe('parseDoc', () => {
  it('infers types for untyped legacy trees', () => {
    const d = M.parseDoc({ root: { title: 'x', children: [{ title: 'a', children: [{ title: 'b' }] }] } })!;
    expect(d.root.type).toBe('root');
    expect(d.root.children[0].type).toBe('project');
    expect(d.root.children[0].children[0].type).toBe('todo');
  });
  it('rejects junk', () => {
    expect(M.parseDoc('not json')).toBeNull();
  });
});
