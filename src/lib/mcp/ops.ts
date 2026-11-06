/**
 * What the TwigList MCP tools do to a tree, as pure functions: no database, no network.
 * The MCP server (src/lib/mcp/server.ts) loads a tree, calls one of these, and saves the result.
 *
 * Rules
 * - Sensitive items (and everything inside them) are hidden from AI tools: they never appear in outlines or
 *   search results, can't be looked up, changed, or used as a place to add things. The outline only shows that
 *   something hidden is there.
 * - Nothing is deleted through MCP. Changes reuse the same operations as the app, so they follow the same rules
 *   (which item can hold which, deadlines only on projects and todos, …).
 * - Items can be named by id (from an outline or search) or by exact title; an ambiguous title is an error that
 *   lists the candidates with their ids.
 */
import * as M from '@/lib/tree/model';
import { stampChanges } from '@/lib/tree/activity';
import { sealedIds } from '@/lib/tree/sensitive';
import { DUE_RE, addDays, daysUntil } from '@/lib/tree/dates';
import { canHaveNotes, canSchedule, type ChildType, type TreeDoc, type TreeNode } from '@/lib/tree/types';

export interface TreeRef {
  id: string;
  name: string;
  doc: TreeDoc;
}

export type Change = { doc: TreeDoc; message: string; itemId?: string } | { error: string };

const KIND: Record<string, string> = { project: 'project', todo: 'todo', note: 'note' };
const MAX_TITLE = 300;
const MAX_NOTES = 20_000;

/* ---------- Reading ---------- */

function describe(n: TreeNode, idx: M.TreeIndex, today: string): string {
  const bits: string[] = [];
  if (n.type === 'project') {
    const s = idx.stats.get(n.id);
    if (s && s.total) bits.push(`${s.done}/${s.total} done`);
  }
  if (n.high) bits.push('high priority');
  if (n.due && !M.isComplete(idx, n)) {
    const d = daysUntil(n.due, today);
    bits.push(`due ${n.due} (${d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`})`);
  }
  if (n.flags && Object.keys(n.flags).length) bits.push('to bring up at a meeting');
  if (n.notes) bits.push('has notes');
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

function marker(n: TreeNode, idx: M.TreeIndex) {
  if (n.type === 'project') return '[project]';
  if (n.type === 'note') return '[note]';
  return M.isComplete(idx, n) ? '[x]' : '[ ]';
}

/**
 * The tree (or one branch) as an indented outline with ids. Finished todos are summarised unless `includeDone`;
 * sensitive items show as a single hidden line.
 */
export function outline(t: TreeRef, opts: { itemId?: string; includeDone?: boolean; today: string; notes?: boolean }): string {
  const idx = M.buildIndex(t.doc.root);
  const sealed = sealedIds(t.doc.root);
  const start = opts.itemId ? idx.byId.get(opts.itemId) : t.doc.root;
  if (!start) return 'Item not found.';
  const lines: string[] = [];
  const walk = (n: TreeNode, depth: number) => {
    const pad = '  '.repeat(depth);
    let doneHidden = 0;
    for (const c of n.children) {
      if (sealed.has(c.id)) {
        lines.push(`${pad}- 🔒 (a sensitive item, hidden)`);
        continue;
      }
      if (!opts.includeDone && c.type === 'todo' && M.isComplete(idx, c)) {
        doneHidden++;
        continue;
      }
      lines.push(`${pad}- ${marker(c, idx)} ${c.title || 'Untitled'} (id: ${c.id})${describe(c, idx, opts.today)}`);
      if (opts.notes && c.notes) lines.push(...c.notes.split('\n').slice(0, 20).map((l) => `${pad}    > ${l}`));
      walk(c, depth + 1);
    }
    if (doneHidden) lines.push(`${pad}- (+${doneHidden} finished todo${doneHidden === 1 ? '' : 's'}; include_done to see them)`);
  };
  const head =
    start.type === 'root'
      ? `Tree “${t.name}” (tree id: ${t.id})`
      : `${start.type === 'project' ? 'Project' : start.type === 'todo' ? 'Todo' : 'Note'} “${start.title || 'Untitled'}” (id: ${start.id}) in tree “${t.name}”, path: ${[t.name, ...M.pathTo(idx, start.id)].join(' / ')}${describe(start, idx, opts.today)}`;
  if (start.type !== 'root' && start.notes) lines.push(`Notes:\n${start.notes}`, '');
  walk(start, 0);
  return [head, ...(lines.length ? lines : ['(empty)'])].join('\n');
}

export interface Hit {
  treeId: string;
  treeName: string;
  id: string;
  type: string;
  title: string;
  path: string;
  done: boolean;
  due?: string;
  high?: boolean;
}

const hitOf = (t: TreeRef, idx: M.TreeIndex, n: TreeNode): Hit => ({
  treeId: t.id,
  treeName: t.name,
  id: n.id,
  type: n.type,
  title: n.title || 'Untitled',
  path: [t.name, ...M.pathTo(idx, n.id)].join(' / '),
  done: n.type === 'todo' && M.isComplete(idx, n),
  ...(n.due ? { due: n.due } : {}),
  ...(n.high ? { high: true } : {}),
});

/** Every visible (not sensitive) item, with its tree. */
function* visible(trees: TreeRef[]) {
  for (const t of trees) {
    const idx = M.buildIndex(t.doc.root);
    const sealed = sealedIds(t.doc.root);
    for (const n of idx.byId.values()) if (n.type !== 'root' && !sealed.has(n.id)) yield { t, idx, n };
  }
}

/** Open todos and projects in a tree (sensitive items not counted). */
export function counts(t: TreeRef) {
  let open = 0;
  let projects = 0;
  for (const { idx, n } of visible([t])) {
    if (n.type === 'project') projects++;
    else if (n.type === 'todo' && !n.children.some((c) => c.type === 'todo') && !M.isComplete(idx, n)) open++;
  }
  return { open, projects };
}

/** Items whose title (or notes) contain all words of the query, best matches first. */
export function search(trees: TreeRef[], query: string, limit = 25): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { hit: Hit; score: number }[] = [];
  for (const { t, idx, n } of visible(trees)) {
    const title = n.title.toLowerCase();
    const notes = (n.notes ?? '').toLowerCase();
    if (!words.every((w) => title.includes(w) || notes.includes(w))) continue;
    const inTitle = words.filter((w) => title.includes(w)).length;
    const score = (title === query.toLowerCase() ? 100 : 0) + inTitle * 10 - (n.type === 'todo' && M.isComplete(idx, n) ? 5 : 0);
    scored.push({ hit: hitOf(t, idx, n), score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.hit);
}

/** Open items with a deadline within `days` (or overdue), and open high-priority items. Soonest first. */
export function upcoming(trees: TreeRef[], today: string, days: number) {
  const until = addDays(today, days);
  const due: (Hit & { daysLeft: number })[] = [];
  const high: Hit[] = [];
  for (const { t, idx, n } of visible(trees)) {
    if (!canSchedule(n.type) || M.isComplete(idx, n)) continue;
    if (n.due && n.due <= until) due.push({ ...hitOf(t, idx, n), daysLeft: daysUntil(n.due, today) });
    else if (n.high) high.push(hitOf(t, idx, n));
  }
  due.sort((a, b) => a.daysLeft - b.daysLeft);
  return { due, high };
}

/* ---------- Finding the item a tool means ---------- */

export type Found = { tree: TreeRef; node: TreeNode } | { error: string };

/**
 * An item by id, or by exact title (case-insensitive). Searches `trees` (one tree when the tool was given a tree).
 * Sensitive items can't be found. `root` may be returned when `allowRoot` and the reference is empty.
 */
export function findItem(trees: TreeRef[], ref: string): Found {
  const r = ref.trim();
  if (!r) return { error: 'Say which item: its id (from get_tree or search) or its exact title.' };
  const all = [...visible(trees)];
  const byId = all.filter((x) => x.n.id === r);
  if (byId.length === 1) return { tree: byId[0].t, node: byId[0].n };
  const byTitle = all.filter((x) => x.n.title.trim().toLowerCase() === r.toLowerCase());
  if (byTitle.length === 1) return { tree: byTitle[0].t, node: byTitle[0].n };
  if (byTitle.length > 1 || byId.length > 1) {
    const list = (byTitle.length ? byTitle : byId).slice(0, 10).map((x) => `- ${x.n.title || 'Untitled'} (id: ${x.n.id}) in ${[x.t.name, ...M.pathTo(x.idx, x.n.id)].join(' / ')}`);
    return { error: `More than one item matches “${r}”. Use the id of the one you mean:\n${list.join('\n')}` };
  }
  return { error: `No item “${r}” found (sensitive items can’t be used). Use search or get_tree to find the id.` };
}

/** A tree by id or name (case-insensitive). Without a reference: the first tree. */
export function findTree(trees: TreeRef[], ref?: string): TreeRef | { error: string } {
  if (!trees.length) return { error: 'There are no trees yet.' };
  if (!ref?.trim()) return trees[0];
  const r = ref.trim().toLowerCase();
  const t = trees.find((x) => x.id.toLowerCase() === r) ?? trees.find((x) => x.name.toLowerCase() === r);
  return t ?? { error: `No tree “${ref}”. Trees: ${trees.map((x) => `${x.name} (id: ${x.id})`).join(', ')}.` };
}

/* ---------- Changing ---------- */

const cleanTitle = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

function checkDue(due: string | null | undefined): string | null {
  if (due === undefined || due === null) return null;
  return DUE_RE.test(due) && !Number.isNaN(Date.parse(due)) ? null : 'Deadlines are dates as YYYY-MM-DD, e.g. 2026-11-14.';
}

/** Apply optional details to a just-made or existing item. */
function applyDetails(doc: TreeDoc, id: string, d: { notes?: string; due?: string | null; high?: boolean }): { doc: TreeDoc } | { error: string } {
  let cur = doc;
  const n = () => M.buildIndex(cur.root).byId.get(id)!;
  if (d.notes !== undefined) {
    if (!canHaveNotes(n().type)) return { error: 'Only projects and todos can have notes.' };
    cur = M.setNotes(cur, id, d.notes.slice(0, MAX_NOTES))?.doc ?? cur;
  }
  if (d.due !== undefined) {
    if (!canSchedule(n().type)) return { error: 'Only projects and todos can have a deadline.' };
    const bad = checkDue(d.due);
    if (bad) return { error: bad };
    cur = M.setDue(cur, id, d.due)?.doc ?? cur;
  }
  if (d.high !== undefined && !!n().high !== d.high) {
    if (!canSchedule(n().type)) return { error: 'Only projects and todos can be high priority.' };
    cur = M.toggleHigh(cur, id)?.doc ?? cur;
  }
  return { doc: cur };
}

/** Mark what changed as activity (like edits in the app), so the idle heads-up stays right. */
const stamped = (before: TreeDoc, after: TreeDoc) => stampChanges(before, after);

export function addItem(
  tree: TreeRef,
  parent: TreeNode | null,
  type: ChildType,
  input: { title: string; notes?: string; due?: string | null; high?: boolean },
): Change {
  const title = cleanTitle(input.title);
  if (!title) return { error: 'A title is needed.' };
  const p = parent ?? tree.doc.root;
  if (!M.allows(p, type)) return { error: `A ${KIND[p.type] ?? 'top level'} can’t hold a ${KIND[type]}${p.type === 'todo' && type === 'project' ? ' (todos only hold todos and notes)' : ''}.` };
  const added = M.addChild(tree.doc, p.id, type, title);
  if (!added) return { error: 'That can’t be added there.' };
  const details = applyDetails(added.doc, added.id, input);
  if ('error' in details) return details;
  const where = p.type === 'root' ? `the top level of “${tree.name}”` : `“${p.title || 'Untitled'}”`;
  return { doc: stamped(tree.doc, details.doc), itemId: added.id, message: `Added ${KIND[type]} “${title}” (id: ${added.id}) to ${where}.` };
}

export function setDone(tree: TreeRef, node: TreeNode, done: boolean, now = Date.now()): Change {
  if (node.type !== 'todo') return { error: 'Only todos can be ticked off. A project is done when all its todos are.' };
  const idx = M.buildIndex(tree.doc.root);
  if (M.isComplete(idx, node) === done) return { error: `“${node.title}” is already ${done ? 'done' : 'not done'}.` };
  const r = M.toggleDone(tree.doc, node.id, now);
  if (!r) return { error: 'That todo can’t be changed.' };
  const steps = node.children.filter((c) => c.type === 'todo').length;
  return {
    doc: stamped(tree.doc, r.doc),
    itemId: node.id,
    message: `${done ? 'Ticked off' : 'Unticked'} “${node.title}”${steps ? ` and its ${steps} step${steps === 1 ? '' : 's'}` : ''}.`,
  };
}

export function updateItem(tree: TreeRef, node: TreeNode, input: { title?: string; notes?: string; due?: string | null; high?: boolean }): Change {
  let doc = tree.doc;
  const changed: string[] = [];
  if (input.title !== undefined) {
    const t = cleanTitle(input.title);
    if (!t) return { error: 'The title can’t be empty.' };
    if (t !== node.title) {
      doc = M.rename(doc, node.id, t)!.doc;
      changed.push(`title → “${t}”`);
    }
  }
  const before = doc;
  const d = applyDetails(doc, node.id, input);
  if ('error' in d) return d;
  doc = d.doc;
  if (doc !== before) {
    if (input.notes !== undefined) changed.push(input.notes.trim() ? 'notes' : 'notes removed');
    if (input.due !== undefined) changed.push(input.due ? `deadline ${input.due}` : 'deadline removed');
    if (input.high !== undefined) changed.push(input.high ? 'high priority' : 'normal priority');
  }
  if (!changed.length) return { error: 'Nothing to change: give a new title, notes, deadline or priority.' };
  return { doc: stamped(tree.doc, doc), itemId: node.id, message: `Updated “${input.title !== undefined ? cleanTitle(input.title) : node.title}”: ${changed.join(', ')}.` };
}

export function moveItem(tree: TreeRef, node: TreeNode, to: TreeNode | null): Change {
  const target = to ?? tree.doc.root;
  const r = M.moveTo(tree.doc, node.id, target.id, null);
  if (!r) return { error: `“${node.title}” is already there.` };
  if ('error' in r) return { error: `${r.error}.` };
  return { doc: stamped(tree.doc, r.doc), itemId: node.id, message: `Moved “${node.title}” to ${target.type === 'root' ? `the top level of “${tree.name}”` : `“${target.title}”`}.` };
}
