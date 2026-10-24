/**
 * Archive (KAN-28): finished work leaves the tree without being lost.
 *
 * - A finished todo moves to the archive ARCHIVE_DAYS after it was ticked (fixed, no setting). A todo with steps
 *   goes as a whole once all steps are done; steps never go on their own.
 * - Projects are never archived automatically (complete ≠ done, KAN-34). A complete project can be archived by hand,
 *   with everything in it.
 * - Archived items keep counting as done (`arch` on the parent), so 8/10 stays 8/10.
 * - Restoring puts an item back where it was. If its project was archived too, the project comes back with only that
 *   item; restoring the project later merges the rest back in.
 *
 * The archive lives in the tree document (`doc.archive`), so it is part of backups, moves and (later) sync.
 * Everything here is pure: it returns a new document.
 */
import { buildIndex, countDesc, isComplete, isDone, type TreeIndex } from './model';
import { addDays, daysUntil, toISODate } from './dates';
import type { TreeDoc, TreeNode } from './types';

export const ARCHIVE_DAYS = 7;

/** How many done todos an item counts for in its parent's progress. */
const unitsOf = (n: TreeNode) => buildIndex(n).stats.get(n.id)?.total ?? 0;

/** The latest moment anything in this branch was ticked, or put on hold (restored, flag cleared). */
export function finishedAt(n: TreeNode): number {
  let t = Math.max(n.doneAt ?? 0, n.holdFrom ?? 0);
  for (const c of n.children) t = Math.max(t, finishedAt(c));
  return t;
}

/** The day this branch is due to be archived ("YYYY-MM-DD"), counted in local calendar days. */
export const archiveDay = (n: TreeNode) => addDays(toISODate(new Date(finishedAt(n) || Date.now())), ARCHIVE_DAYS);

const hasFlags = (n: TreeNode): boolean => (!!n.flags && Object.keys(n.flags).length > 0) || n.children.some(hasFlags);

/** A finished todo (not a step of an open todo) or a complete project. */
export function canArchive(idx: TreeIndex, n: TreeNode): boolean {
  const p = idx.parentOf.get(n.id);
  if (!p) return false;
  if (n.type === 'project') return isComplete(idx, n);
  return isDone(idx, n) && p.type !== 'todo';
}

/** Todos the archive should take now: finished a week ago or more, not flagged for a meeting, not a step. */
export function dueForArchive(doc: TreeDoc, today: string): string[] {
  const idx = buildIndex(doc.root);
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    for (const c of n.children) {
      if (c.type === 'todo') {
        // A todo is archived as a whole; its steps are never looked at on their own.
        if (isDone(idx, c) && !hasFlags(c) && daysUntil(archiveDay(c), today) <= 0) out.push(c.id);
      } else if (c.type === 'project') walk(c);
    }
  };
  walk(doc.root);
  return out;
}

const pathOf = (idx: TreeIndex, id: string) => {
  const ids: string[] = [];
  const titles: string[] = [];
  let sensitive = false;
  for (let p = idx.parentOf.get(id); p && p.type !== 'root'; p = idx.parentOf.get(p.id) ?? null) {
    ids.unshift(p.id);
    titles.unshift(p.title || 'Untitled');
    if (p.sensitive) sensitive = true;
  }
  return { ids, titles, sensitive };
};

function archiveInto(d: TreeDoc, idx: TreeIndex, id: string, how: 'auto' | 'manual', now: number): number {
  const n = idx.byId.get(id);
  const p = idx.parentOf.get(id);
  if (!n || !p) return 0;
  const units = unitsOf(n);
  const at = pathOf(idx, id);
  const archive = (d.archive ??= []);
  // A project takes the items archived from inside it earlier with it (shown inside its entry).
  if (n.type === 'project') {
    for (const e of archive) if (!e.within && e.ancestors.includes(n.id)) e.within = n.id;
  }
  archive.push({
    node: n,
    parentId: p.id,
    index: p.children.indexOf(n),
    ancestors: at.ids,
    path: at.titles,
    archivedAt: now,
    how,
    ...(n.sensitive || at.sensitive ? { sensitive: true } : {}),
  });
  p.children.splice(p.children.indexOf(n), 1);
  if (units) p.arch = (p.arch ?? 0) + units;
  return 1 + countDesc(n);
}

/** Archive one finished todo or complete project by hand. */
export function archiveItem(doc: TreeDoc, id: string, now = Date.now()) {
  const d = structuredClone(doc);
  const idx = buildIndex(d.root);
  const n = idx.byId.get(id);
  if (!n || !canArchive(idx, n)) return null;
  const title = n.title;
  const items = archiveInto(d, idx, id, 'manual', now);
  return items ? { doc: d, title, items } : null;
}

/** Archive everything that's due. Returns null when there's nothing to do. */
export function autoArchive(doc: TreeDoc, today: string, now = Date.now()) {
  const ids = dueForArchive(doc, today);
  if (!ids.length) return null;
  const d = structuredClone(doc);
  let todos = 0;
  for (const id of ids) {
    // Rebuild the index each time: archiving changes the counts above.
    if (archiveInto(d, buildIndex(d.root), id, 'auto', now)) todos++;
  }
  return todos ? { doc: d, todos } : null;
}

/* ---------- Restore & delete ---------- */

const find = (n: TreeNode, id: string): TreeNode[] | null => {
  if (n.id === id) return [n];
  for (const c of n.children) {
    const r = find(c, id);
    if (r) return [n, ...r];
  }
  return null;
};

/** Put `src` into `dst` (same item, e.g. a project that was brought back with only one todo): add what's missing. */
function merge(dst: TreeNode, src: TreeNode) {
  if (src.arch) dst.arch = (dst.arch ?? 0) + src.arch;
  // The archived order wins; items that came back earlier keep their current position.
  const out = src.children.map((c) => {
    const there = dst.children.find((x) => x.id === c.id);
    if (!there) return c;
    merge(there, c);
    return there;
  });
  dst.children.forEach((c, i) => {
    if (!out.includes(c)) out.splice(Math.min(i, out.length), 0, c);
  });
  dst.children = out;
}

const holdBranch = (n: TreeNode, now: number) => {
  n.holdFrom = now;
};

export type RestoreResult = { doc: TreeDoc; id: string; title: string; note?: string };

/**
 * Bring an archived item back where it was (it stays finished, and gets a fresh week before it can be archived again).
 * - Parent still in the tree: back at its old position.
 * - Parent archived too (its project was archived later): the project comes back with only this item in it.
 * - Parent deleted: at the end of the top level.
 */
export function restoreItem(doc: TreeDoc, entryId: string, now = Date.now()): RestoreResult | null {
  const d = structuredClone(doc);
  const archive = d.archive ?? [];
  const at = archive.findIndex((e) => e.node.id === entryId);
  if (at < 0) return null;
  const e = archive[at];
  archive.splice(at, 1);
  // Entries archived from inside this one are no longer "inside an archived project".
  for (const x of archive) if (x.within === entryId) delete x.within;

  const idx = buildIndex(d.root);
  const units = unitsOf(e.node);
  const node = e.node;
  holdBranch(node, now);
  let note: string | undefined;
  const existing = idx.byId.get(node.id);

  if (existing) {
    // Brought back earlier with only some of its items: merge the rest in.
    merge(existing, node);
    existing.holdFrom = now;
    const p = idx.parentOf.get(existing.id);
    if (p && units) p.arch = Math.max(0, (p.arch ?? 0) - units);
  } else {
    let parent = idx.byId.get(e.parentId) ?? null;
    if (parent) {
      if (units) parent.arch = Math.max(0, (parent.arch ?? 0) - units);
    } else {
      // Is its project in the archive? Bring that project back as a shell holding just this item.
      const holder = archive.find((x) => find(x.node, e.parentId));
      if (holder) {
        const chain = find(holder.node, e.parentId)!;
        const owner = chain[chain.length - 1];
        if (units) owner.arch = Math.max(0, (owner.arch ?? 0) - units);
        // The holder's own parent counted this item as part of the archived project.
        const holderParent = idx.byId.get(holder.parentId);
        if (holderParent && units) holderParent.arch = Math.max(0, (holderParent.arch ?? 0) - units);
        let into: TreeNode = holderParent ?? d.root;
        chain.forEach((a, i) => {
          let there = into.children.find((x) => x.id === a.id);
          if (!there) {
            // A shell: the archived project's own details, without its other items (they stay archived).
            there = { ...a, children: [], holdFrom: now };
            delete there.arch;
            if (i === 0) into.children.splice(Math.min(holder.index, into.children.length), 0, there);
            else into.children.push(there);
          }
          into = there;
        });
        parent = into;
        note = `“${holder.node.title || 'Untitled'}” came back with just this item; the rest stays in the archive.`;
      } else {
        parent = d.root;
        note = 'Its project no longer exists, so it’s back at the top level.';
      }
    }
    if (note && parent === d.root && !idx.byId.get(e.parentId)) parent.children.push(node);
    else parent.children.splice(Math.min(e.index, parent.children.length), 0, node);
    parent.collapsed = false;
  }
  if (!archive.length) delete d.archive;
  return { doc: d, id: node.id, title: node.title, note };
}

/** Delete an archived item for good (and anything archived from inside it). */
export function deleteArchived(doc: TreeDoc, entryId: string) {
  const d = structuredClone(doc);
  const archive = d.archive ?? [];
  const e = archive.find((x) => x.node.id === entryId);
  if (!e) return null;
  const gone = new Set([entryId, ...archive.filter((x) => x.within === entryId).map((x) => x.node.id)]);
  const items = archive.filter((x) => gone.has(x.node.id)).reduce((a, x) => a + 1 + countDesc(x.node), 0);
  // Gone for good: stop counting them in the progress of the project they came from.
  const idx = buildIndex(d.root);
  const units = unitsOf(e.node);
  const parent = idx.byId.get(e.parentId) ?? archive.map((x) => find(x.node, e.parentId)).find(Boolean)?.slice(-1)[0];
  if (parent && units) parent.arch = Math.max(0, (parent.arch ?? 0) - units);
  d.archive = archive.filter((x) => !gone.has(x.node.id));
  if (!d.archive.length) delete d.archive;
  return { doc: d, items, title: e.node.title };
}

/** Item count of an entry including what was archived from inside it (for confirmations). */
export const entryItems = (doc: TreeDoc, entryId: string) =>
  (doc.archive ?? []).filter((x) => x.node.id === entryId || x.within === entryId).reduce((a, x) => a + 1 + countDesc(x.node), 0);

/** When the last todo in this branch was ticked (for "finished on" in the archive). */
export function lastDoneAt(n: TreeNode): number {
  let t = n.doneAt ?? 0;
  for (const c of n.children) t = Math.max(t, lastDoneAt(c));
  return t;
}
