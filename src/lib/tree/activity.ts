import { isComplete, type TreeIndex } from './model';
import { canSchedule, type TreeDoc, type TreeNode } from './types';

/**
 * Activity tracking.
 *
 * Every item carries `touched`: when it last changed in a way that counts as work (title, done, kind,
 * flags, priority, deadline, notes, what's inside it, or where it lives). Folding is not work.
 * Stamping happens centrally in the store by diffing the old and new document, so individual
 * operations don't need to remember to do it.
 *
 * An item's *last activity* is the latest `touched` anywhere in its branch, so working on a todo
 * keeps its project fresh too.
 */

export const DAY = 86_400_000;
export const IDLE_CHOICES = [3, 7, 14, 30] as const;
export const DEFAULT_IDLE_DAYS = 7;

/** What counts as "this item changed". */
const signature = (n: TreeNode) =>
  JSON.stringify([n.type, n.title, n.done, n.flags ?? null, !!n.high, n.due ?? null, n.notes ?? null, n.children.map((c) => c.id)]);

/**
 * Stamp `touched = now` on every item that is new, changed, or moved between `prev` and `next`.
 * Mutates and returns `next` (a fresh document produced by an operation).
 */
export function stampChanges(prev: TreeDoc, next: TreeDoc, now = Date.now()): TreeDoc {
  const before = new Map<string, { sig: string; parent: string | null }>();
  const index = (n: TreeNode, parent: string | null) => {
    before.set(n.id, { sig: signature(n), parent });
    n.children.forEach((c) => index(c, n.id));
  };
  index(prev.root, null);
  const walk = (n: TreeNode, parent: string | null) => {
    if (n.type !== 'root') {
      const b = before.get(n.id);
      if (!b || b.sig !== signature(n) || b.parent !== parent) n.touched = now;
    }
    n.children.forEach((c) => walk(c, n.id));
  };
  walk(next.root, null);
  return next;
}

/** Latest activity anywhere in each item's branch. */
export function lastActivity(root: TreeNode): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (n: TreeNode): number => {
    let t = n.touched ?? 0;
    for (const c of n.children) t = Math.max(t, walk(c));
    out.set(n.id, t);
    return t;
  };
  walk(root);
  return out;
}

/**
 * Open todos and projects with no activity for `idleDays` or more → days idle.
 * Only the topmost idle item of a branch is returned: if a project is idle, everything in it is
 * too, and one heads-up on the project says it all.
 */
export function idleItems(root: TreeNode, idx: TreeIndex, idleDays: number, now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  if (!idleDays) return out;
  const act = lastActivity(root);
  const walk = (n: TreeNode, covered: boolean) => {
    let idle = false;
    if (n.type !== 'root' && canSchedule(n.type) && !isComplete(idx, n)) {
      const t = act.get(n.id) ?? 0;
      const days = t ? Math.floor((now - t) / DAY) : 0;
      idle = days >= idleDays;
      if (idle && !covered) out.set(n.id, days);
    }
    n.children.forEach((c) => walk(c, covered || idle));
  };
  walk(root, false);
  return out;
}

export function describeIdle(days: number, since: number) {
  const date = new Date(since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `No activity for ${days} day${days === 1 ? '' : 's'} (last on ${date})`;
}
