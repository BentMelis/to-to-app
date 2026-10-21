import { describe, expect, it } from 'vitest';
import { addToRoot, insertAt, planMove } from '../moveTree';
import { buildIndex, removeNode, starter } from '../model';
import { emptyTree } from '../trees';
import type { TreeDoc, TreeNode } from '../types';

const node = (id: string, title: string, children: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({
  id,
  type: children.length ? 'project' : 'todo',
  title,
  done: false,
  collapsed: false,
  children,
  ...extra,
});

function work(): TreeDoc {
  return {
    v: 4,
    meetings: [
      { id: 'standup', name: 'Standup', color: 'amber' },
      { id: 'sync', name: 'Weekly sync', color: 'blue' },
    ],
    settings: { idleDays: 7 },
    root: {
      id: 'root',
      type: 'root',
      title: 'Work',
      done: false,
      collapsed: false,
      children: [
        node('p1', 'Website', [
          node('t1', 'Copy', [], { flags: { standup: 'ask' }, high: true, due: '2026-11-02', notes: '# Brief' }),
          node('t2', 'Designs', [], { flags: { sync: 'mention', standup: 'mention' } }),
        ]),
        node('p2', 'Report'),
      ],
    },
  };
}

function personal(): TreeDoc {
  const d = emptyTree('Personal');
  d.meetings = [{ id: 'x1', name: 'standup ', color: 'teal' }];
  d.root.children = [node('h1', 'Garden')];
  return d;
}

describe('moving an item to another tree', () => {
  it('copies the whole branch with fresh ids and keeps its details', () => {
    const plan = planMove(work(), 'p1', personal(), 1000)!;
    expect(plan.items).toBe(3);
    expect(plan.node.title).toBe('Website');
    expect(plan.node.touched).toBe(1000);
    const ids = [plan.node.id, ...plan.node.children.map((c) => c.id)];
    expect(ids.some((i) => ['p1', 't1', 't2'].includes(i))).toBe(false);
    const copy = plan.node.children[0];
    expect(copy).toMatchObject({ title: 'Copy', high: true, due: '2026-11-02', notes: '# Brief' });
  });

  it('keeps flags for meetings with the same name, drops the rest', () => {
    const plan = planMove(work(), 'p1', personal())!;
    expect(plan.kept).toBe(2); // two "Standup" flags → mapped to x1
    expect(plan.dropped).toBe(1); // "Weekly sync" doesn't exist in Personal
    expect(plan.droppedMeetings).toEqual(['Weekly sync']);
    expect(plan.node.children[0].flags).toEqual({ x1: 'ask' });
    expect(plan.node.children[1].flags).toEqual({ x1: 'mention' });
  });

  it('adds to the end of the target top level and leaves the rest alone', () => {
    const dst = personal();
    const plan = planMove(work(), 't1', dst)!;
    const after = addToRoot(dst, plan.node);
    expect(after.root.children.map((c) => c.title)).toEqual(['Garden', 'Copy']);
    expect(dst.root.children).toHaveLength(1); // not mutated
  });

  it('refuses the root and unknown items', () => {
    expect(planMove(work(), 'root', personal())).toBeNull();
    expect(planMove(work(), 'nope', personal())).toBeNull();
  });

  it('undo puts the item back in its old place, or at the top level if that place is gone', () => {
    const src = work();
    const original = buildIndex(src.root).byId.get('t1')!;
    const removed = removeNode(src, 't1')!.doc;
    const back = insertAt(removed, 'p1', 0, original);
    expect(back.root.children[0].children.map((c) => c.id)).toEqual(['t1', 't2']);
    const parentGone = removeNode(removed, 'p1')!.doc;
    expect(insertAt(parentGone, 'p1', 0, original).root.children.map((c) => c.id)).toEqual(['p2', 't1']);
    // Never twice.
    expect(insertAt(back, 'p1', 0, original).root.children[0].children).toHaveLength(2);
  });

  it('works from the starter tree too', () => {
    const s = starter();
    const id = s.root.children[0].id;
    expect(planMove(s, id, personal())!.items).toBeGreaterThan(5);
  });
});
