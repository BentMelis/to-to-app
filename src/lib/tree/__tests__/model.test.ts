import { describe, expect, it } from 'vitest';
import * as M from '../model';
import { applyFilters, isFolded, NO_FILTERS, visibleTree, stackId } from '../layout';
import type { TreeDoc } from '../types';

const doc = (): TreeDoc => ({
  v: 3,
  meetings: [{ id: 'standup', name: 'Standup', color: 'amber' }],
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

describe('meeting flags (ask / mention, several meetings or people)', () => {
  const withAnna = () => M.addMeeting(doc(), 'Anna (stakeholder)')!;
  it('flags an item to ask at one meeting and mention to someone else', () => {
    const { doc: d0, id: anna } = withAnna();
    let d = M.setFlag(d0, 't2', 'standup', 'ask')!.doc;
    d = M.setFlag(d, 't2', anna, 'mention')!.doc;
    d = M.setFlag(d, 'p2', 'standup', 'mention')!.doc;
    const idx = M.buildIndex(d.root);
    expect(M.collectFlags(d.root, idx, 'standup').map((f) => [f.id, f.kind, f.path])).toEqual([
      ['t2', 'ask', ['P1']],
      ['p2', 'mention', []],
    ]);
    expect(M.collectFlags(d.root, idx, anna).map((f) => f.id)).toEqual(['t2']);
    expect(M.countFlagged(d.root)).toBe(2);
  });
  it('lists done items as updates, e.g. "Delete legacy app (done ✓)"', () => {
    let d = M.setFlag(doc(), 't1', 'standup', 'mention')!.doc; // t1 is done
    d = M.setFlag(d, 't2', 'standup', 'ask')!.doc;
    const text = M.meetingAsText(d.meetings[0], M.collectFlags(d.root, M.buildIndex(d.root), 'standup'));
    expect(text.split('\n').slice(1)).toEqual(['', 'Questions', '• P1: b', '', 'Updates', '• P1: a (done ✓)']);
  });
  it('clears a flag and refuses unknown meetings or the root', () => {
    const d = M.setFlag(doc(), 't2', 'standup', 'ask')!.doc;
    expect(M.setFlag(d, 't2', 'standup', null)!.doc.root.children[0].children[1].flags).toBeUndefined();
    expect(M.setFlag(doc(), 't2', 'nope', 'ask')).toBeNull();
    expect(M.setFlag(doc(), 'root', 'standup', 'ask')).toBeNull();
  });
  it('removing a meeting removes its flags; renaming and recolouring work', () => {
    const { doc: d0, id: anna } = withAnna();
    let d = M.setFlag(d0, 't2', anna, 'mention')!.doc;
    d = M.updateMeeting(d, anna, { name: 'Anna', color: 'rose' })!.doc;
    expect(d.meetings[1]).toMatchObject({ name: 'Anna', color: 'rose' });
    d = M.removeMeeting(d, anna)!.doc;
    expect(d.meetings.map((m) => m.id)).toEqual(['standup']);
    expect(d.root.children[0].children[1].flags).toBeUndefined();
  });
  it('migrates the old "open question for standup" flag', () => {
    const d = M.parseDoc({ root: { title: 'R', children: [{ type: 'project', title: 'P', question: true, children: [] }] } })!;
    expect(d.meetings.map((m) => m.name)).toEqual(['Standup']);
    expect(d.root.children[0].flags).toEqual({ standup: 'ask' });
  });
  it('drops flags for meetings that no longer exist when loading', () => {
    const d = M.parseDoc({ meetings: [], root: { title: 'R', children: [{ type: 'todo', title: 't', flags: { gone: 'ask' }, children: [] }] } })!;
    expect(d.root.children[0].flags).toBeUndefined();
  });
});

describe('done todos with steps stay openable (bug: a fully ticked branch could not be opened)', () => {
  // t2 gets two steps; ticking t2 ticks both, so t2 is a done todo with children.
  const withSteps = () => {
    const d = doc();
    d.root.children[0].children[1].children = [
      { id: 's1', type: 'todo', title: 's1', done: false, collapsed: false, children: [] },
      { id: 's2', type: 'todo', title: 's2', done: false, collapsed: false, children: [] },
    ];
    return M.toggleDone(d, 't2')!.doc;
  };
  it('a done todo with steps starts folded but can be opened', () => {
    const d = withSteps();
    const idx = M.buildIndex(d.root);
    const t2 = idx.byId.get('t2')!;
    expect(M.isDone(idx, t2)).toBe(true);
    expect(isFolded(t2, idx, {})).toBe(true);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set(['p1']), openDone: new Set(['t2']) });
    expect(vis.kids.get('t2')!.map((k) => k.id)).toEqual([stackId('t2')]);
  });
  it('a user-collapsed item stays folded even when opened as done', () => {
    const d = withSteps();
    d.root.children[0].children[1].collapsed = true;
    const idx = M.buildIndex(d.root);
    expect(isFolded(idx.byId.get('t2')!, idx, { openDone: new Set(['t2']) })).toBe(true);
  });
});

describe('complete projects stay in the tree (KAN-34)', () => {
  // P1 complete: t1, t2, t3 done. A third project P3 sits after P2, so P1 is not the last sibling.
  const setup = () => {
    const d = M.toggleDone(doc(), 't2')!.doc;
    d.root.children.push({ id: 'p3', type: 'project', title: 'P3', done: false, collapsed: false, children: [
      { id: 't5', type: 'todo', title: 'e', done: true, collapsed: false, children: [] },
    ] });
    return d;
  };
  it('is complete but not done', () => {
    const d = setup();
    const idx = M.buildIndex(d.root);
    expect(M.isComplete(idx, idx.byId.get('p1')!)).toBe(true);
    expect(M.isDone(idx, idx.byId.get('p1')!)).toBe(false);
  });
  it('keeps its saved position and is never stacked, even next to another complete project', () => {
    const d = setup();
    const idx = M.buildIndex(d.root);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set() });
    expect(vis.kids.get('root')!.map((k) => k.id)).toEqual(['p1', 'p2', 'p3']);
  });
  it('is not folded automatically; its done todos still sink and stack inside it', () => {
    const d = setup();
    const idx = M.buildIndex(d.root);
    expect(isFolded(idx.byId.get('p1')!, idx, {})).toBe(false);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set() });
    expect(vis.kids.get('p1')!.map((k) => k.id)).toEqual(['n1', stackId('p1')]);
  });
  it('stays visible with Hide done; only the done todos under it are hidden', () => {
    const d = setup();
    const idx = M.buildIndex(d.root);
    const vis = visibleTree(d.root, idx, { hideDone: true, openStacks: new Set() });
    expect(vis.kids.get('root')!.map((k) => k.id)).toEqual(['p1', 'p2', 'p3']);
    expect(vis.kids.get('p1')!.map((k) => k.id)).toEqual(['n1']);
    expect(vis.kids.get('p3')).toEqual([]);
  });
  it('opens again when a todo is added', () => {
    const r = M.addChild(setup(), 'p1', 'todo');
    const idx = M.buildIndex(r!.doc.root);
    expect(M.isComplete(idx, idx.byId.get('p1')!)).toBe(false);
    expect(idx.stats.get('p1')).toEqual({ total: 4, done: 3 });
  });
  it('a project without todos is empty, not complete', () => {
    const d = doc();
    d.root.children[1].children = [{ id: 'n9', type: 'note', title: 'x', done: false, collapsed: false, children: [] }];
    const idx = M.buildIndex(d.root);
    expect(M.isComplete(idx, idx.byId.get('p2')!)).toBe(false);
  });
  it('moving up/down treats a complete project like any open sibling', () => {
    const d = setup();
    const r = M.moveSibling(d, 'p2', -1)!;
    expect(r.doc.root.children.map((c) => c.id)).toEqual(['p2', 'p1', 'p3']);
  });
  it('shows no deadline warning on folded branches and is never matched by filters', () => {
    const d = setup();
    d.root.children[0].due = '2026-10-14';
    const idx = M.buildIndex(d.root);
    expect(M.worstDueBelow(d.root, idx, '2026-10-13')).toBeNull();
    const f = applyFilters(d.root, idx, { high: false, dueSoon: true }, '2026-10-13');
    expect(f!.matches).toBe(0);
  });
});

describe('filters', () => {
  const today = '2026-10-13';
  const setup = () => {
    let d = doc();
    d = M.toggleHigh(d, 't4')!.doc; // in P2
    d = M.setDue(d, 't2', '2026-10-14')!.doc; // P1, red
    d.root.children[1].collapsed = true; // match hidden in a folded branch
    return d;
  };
  it('shows only matches, the path above them and what is inside them', () => {
    const d = setup();
    const idx = M.buildIndex(d.root);
    const f = applyFilters(d.root, idx, { high: true, dueSoon: false }, today)!;
    expect(f.matches).toBe(1);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set(), filter: f });
    expect(vis.items.map((i) => i.id)).toEqual(['root', 'p2', 't4']);
    expect(f.context.has('p2')).toBe(true);
  });
  it('combines filters as "any of"', () => {
    const d = setup();
    const idx = M.buildIndex(d.root);
    const f = applyFilters(d.root, idx, { high: true, dueSoon: true }, today)!;
    expect(f.matches).toBe(2);
    const vis = visibleTree(d.root, idx, { hideDone: false, openStacks: new Set(), filter: f });
    expect(vis.items.map((i) => i.id)).toEqual(['root', 'p1', 't2', 'p2', 't4']);
  });
  it('ignores finished items and far-off deadlines', () => {
    let d = setup();
    d = M.setDue(d, 't2', '2026-11-30')!.doc;
    d = M.toggleDone(d, 't4')!.doc;
    const idx = M.buildIndex(d.root);
    expect(applyFilters(d.root, idx, { high: true, dueSoon: true }, today)!.matches).toBe(0);
  });
  it('is off when no filter is chosen', () => {
    const d = setup();
    expect(applyFilters(d.root, M.buildIndex(d.root), NO_FILTERS, today)).toBeNull();
  });
});

describe('notes panel', () => {
  it('sets, trims trailing space and clears notes', () => {
    let d = M.setNotes(doc(), 'p1', 'Kickoff on Monday\nBudget: 5k  \n\n')!.doc;
    expect(d.root.children[0].notes).toBe('Kickoff on Monday\nBudget: 5k');
    expect(M.setNotes(d, 'p1', 'Kickoff on Monday\nBudget: 5k')).toBeNull();
    d = M.setNotes(d, 'p1', '   ')!.doc;
    expect(d.root.children[0].notes).toBeUndefined();
  });
  it('survives save/load and a round trip through another type', () => {
    let d = M.setNotes(doc(), 't2', 'Ask Sam')!.doc;
    d = M.changeType(d, 't2', 'note')!.doc;
    d = M.changeType(M.parseDoc(JSON.stringify(d))!, 't2', 'todo')!.doc;
    expect(d.root.children[0].children[1].notes).toBe('Ask Sam');
  });
  it('gives the path above an item', () => {
    expect(M.pathTo(M.buildIndex(doc().root), 't2')).toEqual(['P1']);
  });
});
