import { isComplete, type TreeIndex } from './model';
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
  /** Parents whose finished children are shown individually instead of as a stack. */
  openStacks: Set<string>;
}

export const stackId = (parentId: string) => `stack:${parentId}`;
export const isStackId = (id: string | null | undefined): id is string => !!id && id.startsWith('stack:');

/** Children in display order: open items keep their order, finished ones sink to the bottom. */
export function displayChildren(n: TreeNode, idx: TreeIndex, opts: ViewOptions, depth: number): VisItem[] {
  if (n.collapsed) return [];
  const open: TreeNode[] = [];
  const done: TreeNode[] = [];
  for (const c of n.children) (isComplete(idx, c) ? done : open).push(c);
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
    // Finished items keep their children folded away; expanding the stack shows the items, not their insides.
    const ks = it.node.id !== 'root' && isComplete(idx, it.node) ? [] : displayChildren(it.node, idx, opts, it.depth + 1);
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
