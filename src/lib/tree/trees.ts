import { countDesc, uid } from './model';
import { DOC_VERSION, type TreeDoc } from './types';

export type { TreeDoc };

/**
 * Several trees per user (work, personal, a side project…). Each tree is its own TreeDoc with its own
 * meetings and settings; this list only says which trees exist, in which order, and which was open last.
 * All functions are pure and return a new list.
 */

export const MAX_TREES = 10;
export const FIRST_TREE_ID = 'main';
export const FIRST_TREE_NAME = 'My projects';

export interface TreeEntry {
  id: string;
  name: string;
}

export interface TreeList {
  trees: TreeEntry[];
  lastOpenedId: string;
}

/** A tree that was just deleted and can still be restored. */
export interface RemovedTree {
  entry: TreeEntry;
  index: number;
  /** It was the open tree, so undo opens it again. */
  wasOpen: boolean;
}

export const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 40);

export const firstList = (name = FIRST_TREE_NAME): TreeList => ({
  trees: [{ id: FIRST_TREE_ID, name: cleanName(name) || FIRST_TREE_NAME }],
  lastOpenedId: FIRST_TREE_ID,
});

export function parseList(input: unknown): TreeList | null {
  try {
    const s = typeof input === 'string' ? JSON.parse(input) : input;
    if (!s || typeof s !== 'object' || !Array.isArray((s as TreeList).trees)) return null;
    const seen = new Set<string>();
    const trees: TreeEntry[] = [];
    for (const t of (s as TreeList).trees) {
      const id = t && typeof t === 'object' ? String(t.id || '') : '';
      if (!/^[\w-]{1,40}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      trees.push({ id, name: cleanName(String(t.name ?? '')) || 'Untitled' });
    }
    if (!trees.length) return null;
    const last = String((s as TreeList).lastOpenedId ?? '');
    return { trees: trees.slice(0, MAX_TREES), lastOpenedId: seen.has(last) ? last : trees[0].id };
  } catch {
    return null;
  }
}

export const currentTree = (list: TreeList) => list.trees.find((t) => t.id === list.lastOpenedId) ?? list.trees[0];

/** A new tree: empty, no meetings yet, default settings. Its root is shown with the tree's name. */
export function emptyTree(name: string): TreeDoc {
  return {
    v: DOC_VERSION,
    meetings: [],
    settings: { idleDays: 7 },
    root: { id: 'root', type: 'root', title: cleanName(name), done: false, collapsed: false, children: [] },
  };
}

export function addTree(list: TreeList, name: string): { list: TreeList; id: string } | null {
  const n = cleanName(name);
  if (!n || list.trees.length >= MAX_TREES) return null;
  const id = uid();
  return { list: { trees: [...list.trees, { id, name: n }], lastOpenedId: id }, id };
}

export function renameTree(list: TreeList, id: string, name: string): TreeList {
  const n = cleanName(name);
  if (!n) return list;
  return { ...list, trees: list.trees.map((t) => (t.id === id ? { ...t, name: n } : t)) };
}

export function moveTree(list: TreeList, id: string, dir: -1 | 1): TreeList {
  const i = list.trees.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.trees.length) return list;
  const trees = [...list.trees];
  [trees[i], trees[j]] = [trees[j], trees[i]];
  return { ...list, trees };
}

export function openTree(list: TreeList, id: string): TreeList {
  return list.trees.some((t) => t.id === id) ? { ...list, lastOpenedId: id } : list;
}

/** Remove a tree from the list. The last tree can't be removed. If it was open, its neighbour opens. */
export function removeTree(list: TreeList, id: string): { list: TreeList; removed: RemovedTree } | null {
  const index = list.trees.findIndex((t) => t.id === id);
  if (index < 0 || list.trees.length <= 1) return null;
  const trees = list.trees.filter((t) => t.id !== id);
  const lastOpenedId = list.lastOpenedId === id ? trees[Math.min(index, trees.length - 1)].id : list.lastOpenedId;
  return { list: { trees, lastOpenedId }, removed: { entry: list.trees[index], index, wasOpen: list.lastOpenedId === id } };
}

/** Undo a removal: back in its old place, and open again if it was the open tree. */
export function restoreTree(list: TreeList, r: RemovedTree): TreeList {
  if (list.trees.some((t) => t.id === r.entry.id) || list.trees.length >= MAX_TREES) return list;
  const trees = [...list.trees];
  trees.splice(Math.min(r.index, trees.length), 0, r.entry);
  return { trees, lastOpenedId: r.wasOpen ? r.entry.id : list.lastOpenedId };
}

/** Everything in a tree, for the delete confirmation. */
export const countItems = (doc: TreeDoc | null) => (doc ? countDesc(doc.root) : 0);

export const pluralItems = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
