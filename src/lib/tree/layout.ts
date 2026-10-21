import { isComplete, isDone, type TreeIndex } from './model';
import { daysUntil, dueLevel } from './dates';
import type { TreeNode } from './types';

export const HGAP = 76;
export const VGAP = 12;
export const GROUPGAP = 8;
/** Finished siblings collapse into a stack once there are at least this many. */
export const STACK_MIN = 2;

export type VisItem =
  | { kind: 'node'; id: string; node: TreeNode; depth: number; parentId: string | null }
  | { kind: 'stack'; id: string; parentId: string; items: TreeNode[]; depth: number };

export interface ViewOptions {
  hideDone: boolean;
  /** Parents whose done todos are shown individually instead of as a stack. */
  openStacks: Set<string>;
  /** Done todos the user unfolded to look inside (done todos with steps start folded). */
  openDone?: Set<string>;
  /** When set, only these items are shown (see `applyFilters`). */
  filter?: FilterResult | null;
  /** Sensitive items (and what's inside them) while hidden: shown as a locked placeholder, never opened. */
  sealed?: ReadonlySet<string>;
}

/* ---------- Filters ---------- */

export interface Filters {
  /** Open items marked high priority. */
  high: boolean;
  /** Open items whose deadline is orange or red (3 days or fewer left, or overdue). */
  dueSoon: boolean;
  /** Open items without activity for the idle threshold (see activity.ts). */
  idle?: boolean;
}
export const NO_FILTERS: Filters = { high: false, dueSoon: false, idle: false };
export const anyFilter = (f: Filters) => f.high || f.dueSoon || !!f.idle;

export interface FilterResult {
  /** Everything that stays visible: matches, the path above them, and what's inside them. */
  show: Set<string>;
  /** Items above a match: shown as context and kept open even if folded. */
  context: Set<string>;
  matches: number;
}

/** True when an unfinished item matches any of the active filters. */
export function matchesFilters(n: TreeNode, idx: TreeIndex, f: Filters, today: string, idle?: Map<string, number>) {
  if (n.type === 'root' || n.type === 'note' || isComplete(idx, n)) return false;
  if (f.idle && idle?.has(n.id)) return true;
  if (f.high && n.high) return true;
  if (f.dueSoon && n.due && dueLevel(daysUntil(n.due, today)) !== 'later') return true;
  return false;
}

export function applyFilters(root: TreeNode, idx: TreeIndex, f: Filters, today: string, idle?: Map<string, number>, sealed?: ReadonlySet<string>): FilterResult | null {
  if (!anyFilter(f)) return null;
  const show = new Set<string>(['root']);
  const context = new Set<string>(['root']);
  let matches = 0;
  const addAll = (n: TreeNode) => {
    show.add(n.id);
    n.children.forEach(addAll);
  };
  const walk = (n: TreeNode) => {
    // Hidden sensitive branches never match: a filter must not reveal what's inside them.
    if (sealed?.has(n.id)) return;
    if (matchesFilters(n, idx, f, today, idle)) {
      matches++;
      addAll(n);
      for (let p = idx.parentOf.get(n.id); p; p = idx.parentOf.get(p.id) ?? null) {
        show.add(p.id);
        context.add(p.id);
      }
    }
    n.children.forEach(walk);
  };
  walk(root);
  return { show, context, matches };
}

/**
 * Whether an item's children are hidden: folded by the user, or a done todo that wasn't opened.
 * A done todo always has to be openable, otherwise ticking its last step would lock its contents away.
 * Complete projects are never folded automatically (KAN-34): they keep their saved fold state.
 */
export function isFolded(n: TreeNode, idx: TreeIndex, opts: Pick<ViewOptions, 'openDone'>) {
  if (!n.children.length) return false;
  if (n.collapsed) return true;
  return isDone(idx, n) && !opts.openDone?.has(n.id);
}

export const stackId = (parentId: string) => `stack:${parentId}`;
export const isStackId = (id: string | null | undefined): id is string => !!id && id.startsWith('stack:');

/** Children in display order: everything keeps its order, done todos sink to the bottom (complete projects don't). */
export function displayChildren(n: TreeNode, idx: TreeIndex, opts: ViewOptions, depth: number): VisItem[] {
  if (n.collapsed && !opts.filter?.context.has(n.id)) return [];
  const open: TreeNode[] = [];
  const done: TreeNode[] = [];
  for (const c of n.children) {
    if (opts.filter && !opts.filter.show.has(c.id)) continue;
    (isDone(idx, c) ? done : open).push(c);
  }
  const items: VisItem[] = open.map((c) => ({ kind: 'node', id: c.id, node: c, depth, parentId: n.id }));
  if (opts.hideDone || !done.length) return items;
  if (done.length >= STACK_MIN && !opts.openStacks.has(n.id)) {
    items.push({ kind: 'stack', id: stackId(n.id), parentId: n.id, items: done, depth });
  } else {
    done.forEach((c) => items.push({ kind: 'node', id: c.id, node: c, depth, parentId: n.id }));
  }
  return items;
}

export interface Visible {
  items: VisItem[];
  kids: Map<string, VisItem[]>;
}

export function visibleTree(root: TreeNode, idx: TreeIndex, opts: ViewOptions): Visible {
  const items: VisItem[] = [];
  const kids = new Map<string, VisItem[]>();
  const walk = (it: VisItem) => {
    items.push(it);
    if (it.kind !== 'node') return;
    // Finished items start folded; their fold button opens them like any other branch.
    // A filter keeps the path to its matches open, even through folded branches.
    const folded = !!opts.sealed?.has(it.id) || (!opts.filter?.context.has(it.id) && isFolded(it.node, idx, opts));
    const ks = folded ? [] : displayChildren(it.node, idx, opts, it.depth + 1);
    kids.set(it.id, ks);
    ks.forEach(walk);
  };
  walk({ kind: 'node', id: root.id, node: root, depth: 0, parentId: null });
  return { items, kids };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
}

/** Classic tidy tree: one column per depth, parents centred on their children. */
export function layout(vis: Visible, size: (id: string) => { w: number; h: number }) {
  const colW: number[] = [];
  vis.items.forEach((it) => {
    colW[it.depth] = Math.max(colW[it.depth] || 0, size(it.id).w);
  });
  const colX: number[] = [];
  let acc = 0;
  colW.forEach((w, i) => {
    colX[i] = acc;
    acc += w + HGAP;
  });

  const pos: Record<string, Box> = {};
  let cursor = 0;
  const place = (it: VisItem) => {
    const s = size(it.id);
    const p: Box = { x: colX[it.depth], y: 0, w: s.w, h: s.h, d: it.depth };
    pos[it.id] = p;
    const ks = vis.kids.get(it.id) || [];
    if (!ks.length) {
      p.y = cursor;
      cursor += s.h + VGAP;
      return;
    }
    const start = cursor;
    ks.forEach(place);
    const f = pos[ks[0].id];
    const l = pos[ks[ks.length - 1].id];
    p.y = Math.max(start, (f.y + f.h / 2 + (l.y + l.h / 2)) / 2 - s.h / 2);
    cursor = Math.max(cursor, p.y + s.h + VGAP) + GROUPGAP;
  };
  place(vis.items[0]);
  return pos;
}

/** Bounding box of an item and everything visible beneath it. */
export function branchBounds(vis: Visible, pos: Record<string, Box>, id: string) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (i: string) => {
    const p = pos[i];
    if (!p) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w + 44);
    maxY = Math.max(maxY, p.y + p.h);
    (vis.kids.get(i) || []).forEach((k) => walk(k.id));
  };
  walk(id);
  return { minX, minY, maxX, maxY };
}
