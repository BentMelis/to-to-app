import { describe, expect, it } from 'vitest';
import * as M from '../model';
import { DAY, idleItems, lastActivity, stampChanges } from '../activity';
import type { TreeDoc } from '../types';

const T0 = Date.UTC(2026, 9, 1); // 1 Oct
const node = (id: string, type: 'project' | 'todo' | 'note', touched: number, children: TreeDoc['root']['children'] = [], done = false) =>
  ({ id, type, title: id, done, collapsed: false, touched, children });
const doc = (): TreeDoc => ({
  v: 3,
  meetings: [],
  settings: { idleDays: 7 },
  root: { id: 'root', type: 'root', title: 'R', done: false, collapsed: false, children: [
    node('p1', 'project', T0, [node('a', 'todo', T0), node('b', 'todo', T0 + 9 * DAY)]),
    node('p2', 'project', T0, [node('c', 'todo', T0), node('sub', 'project', T0, [node('d', 'todo', T0)])]),
    node('p3', 'project', T0, [node('e', 'todo', T0, [], true)]),
  ] },
});
const now = T0 + 12 * DAY;

describe('activity tracking', () => {
  it('rolls activity up to the parents', () => {
    expect(lastActivity(doc().root).get('p1')).toBe(T0 + 9 * DAY);
  });
  it('flags only the topmost idle item, and only open todos/projects', () => {
    const d = doc();
    const idle = idleItems(d.root, M.buildIndex(d.root), 7, now);
    // p1 is fresh thanks to b (3 days ago); a is idle (12 days); p2 idle covers c, sub, d; p3 is finished
    expect([...idle.entries()]).toEqual([['a', 12], ['p2', 12]]);
  });
  it('respects the threshold and can be switched off', () => {
    const d = doc();
    expect(idleItems(d.root, M.buildIndex(d.root), 14, now).size).toBe(0);
    expect(idleItems(d.root, M.buildIndex(d.root), 0, now).size).toBe(0);
  });
  it('stamps changed, new and moved items, but not folding', () => {
    const d = doc();
    let n = M.toggleDone(d, 'c')!.doc;
    n = stampChanges(d, n, now);
    expect(n.root.children[1].children[0].touched).toBe(now);
    expect(n.root.children[1].touched).toBe(T0); // parent itself unchanged, but rolls up:
    expect(idleItems(n.root, M.buildIndex(n.root), 7, now).has('p2')).toBe(false);

    const moved = stampChanges(d, M.moveTo(d, 'd', 'p1', null)!.doc!, now);
    const i = M.buildIndex(moved.root);
    expect(i.byId.get('d')!.touched).toBe(now);
    expect(i.byId.get('sub')!.touched).toBe(now); // lost a child
    expect(i.byId.get('p1')!.touched).toBe(now); // gained one

    const folded = stampChanges(d, M.toggleFold(d, 'p2')!.doc, now);
    expect(folded.root.children[1].touched).toBe(T0);
  });
  it('gives old trees a fresh start instead of marking everything idle', () => {
    const before = Date.now();
    const d = M.parseDoc({ root: { title: 'R', children: [{ type: 'project', title: 'P', children: [] }] } })!;
    expect(d.root.children[0].touched).toBeGreaterThanOrEqual(before);
    expect(d.settings?.idleDays).toBe(7);
  });
  it('keeps the idle setting', () => {
    const d = M.setIdleDays(doc(), 14)!.doc;
    expect(M.parseDoc(JSON.stringify(d))!.settings?.idleDays).toBe(14);
    expect(M.setIdleDays(d, 14)).toBeNull();
  });
});
