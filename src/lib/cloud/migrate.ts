/**
 * Moving the trees in this browser into the account (KAN-43), on first sign-in or later from the account menu.
 * - Empty account: they go in as they are.
 * - The account already has trees: they're added next to them; a name that's taken gets " (this browser)".
 * - At most 10 trees per account: what doesn't fit stays in the browser, and the user is told.
 * Only trees that were moved successfully are removed from the browser.
 */
import { forgetLocalTrees, localLibrary, localTreesWithContent } from '@/lib/storage';
import { uid as newId } from '@/lib/tree/model';
import { cleanName, MAX_TREES } from '@/lib/tree/trees';
import { starter } from '@/lib/tree/model';
import type { TreeDoc } from '@/lib/tree/types';
import type { TreeMeta } from './types';
import { api } from './api';

export interface LocalTree {
  id: string;
  name: string;
  doc: TreeDoc;
}

/** Trees in this browser worth moving (with content), in their order. */
export async function localTrees(): Promise<LocalTree[]> {
  const found = localTreesWithContent();
  if (!found) return [];
  const out: LocalTree[] = [];
  for (const t of found.list.trees) {
    if (!found.ids.includes(t.id)) continue;
    const doc = await localLibrary.adapter(t.id).load();
    if (doc) out.push({ id: t.id, name: t.name, doc });
  }
  return out;
}

export async function moveLocalTrees(trees: LocalTree[]): Promise<{ moved: number; left: number }> {
  const existing = (await api<{ trees: TreeMeta[] }>('/api/trees')).trees;
  const ids = new Set(existing.map((t) => t.id));
  const names = new Set(existing.map((t) => t.name.toLowerCase()));
  let count = existing.length;
  const moved: string[] = [];
  for (const t of trees) {
    if (count >= MAX_TREES) break;
    const id = ids.has(t.id) ? newId() : t.id;
    let name = t.name;
    if (names.has(name.toLowerCase())) name = cleanName(`${t.name.slice(0, 26)} (this browser)`);
    const doc: TreeDoc = { ...t.doc, root: { ...t.doc.root, title: name } };
    await api(`/api/trees/${encodeURIComponent(id)}`, { method: 'PUT', body: { doc, rev: 0, name } });
    ids.add(id);
    names.add(name.toLowerCase());
    moved.push(t.id);
    count++;
  }
  forgetLocalTrees(moved);
  return { moved: moved.length, left: trees.length - moved.length };
}

/** A new, empty account starts like the app does: one tree with the sample to show how it works. */
export async function ensureFirstTree() {
  const { trees } = await api<{ trees: TreeMeta[] }>('/api/trees');
  if (trees.length) return;
  await api(`/api/trees/${newId()}`, { method: 'PUT', body: { doc: starter(), rev: 0, name: 'My projects' } });
}

/** "Not now" on moving local trees: don't ask again for this account (the account menu still offers it). */
const skipKey = (uid: string) => `todo-tree:cloud:${uid}:skip-move`;
export const skippedMove = (uid: string) => {
  try {
    return window.localStorage.getItem(skipKey(uid)) === '1';
  } catch {
    return false;
  }
};
export const skipMove = (uid: string) => {
  try {
    window.localStorage.setItem(skipKey(uid), '1');
  } catch {
    /* ignore */
  }
};
