import { DOC_VERSION, TYPES, type ChildType, type NodeType, type Stats, type TreeDoc, type TreeNode } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const mk = (type: ChildType, title: string, children: TreeNode[] = [], done = false): TreeNode => ({
  id: uid(),
  type,
  title,
  done,
  collapsed: false,
  children,
});

export function starter(): TreeDoc {
  return {
    v: DOC_VERSION,
    root: {
      id: 'root',
      type: 'root',
      title: 'My projects',
      done: false,
      collapsed: false,
      children: [
        mk('project', 'Project one', [
          mk('note', 'Goal: ship a first version by the end of the month'),
          mk('project', 'Research', [mk('todo', 'Collect examples', [], true), mk('todo', 'List open questions')]),
          mk('project', 'Build', [
            mk('todo', 'First draft', [mk('todo', 'Outline', [], true), mk('todo', 'Write it up')]),
            mk('todo', 'Review with the team'),
          ]),
        ]),
        mk('project', 'Project two', [mk('todo', 'Plan the kickoff'), mk('todo', 'Book a room', [], true), mk('todo', 'Send invites', [], true)]),
      ],
    },
  };
}

/** Repairs anything malformed and infers types for trees saved by older versions. */
function normalize(raw: unknown, depth: number): TreeNode {
  const n = (raw && typeof raw === 'object' ? raw : {}) as Partial<TreeNode> & Record<string, unknown>;
  const children = Array.isArray(n.children) ? n.children.map((c) => normalize(c, depth + 1)) : [];
  let type = n.type as NodeType | undefined;
  if (!type || !(type in TYPES) || (type === 'root' && depth > 0)) {
    type = depth === 0 ? 'root' : children.length || depth === 1 ? 'project' : 'todo';
  }
  if (type === 'todo' && children.some((c) => c.type === 'project')) type = 'project';
  if (type === 'note' && children.length) type = 'project';
  return {
    id: depth === 0 ? 'root' : String(n.id || uid()),
    type,
    title: String(n.title ?? ''),
    done: !!n.done,
    collapsed: !!n.collapsed,
    children,
  };
}

export function parseDoc(input: unknown): TreeDoc | null {
  try {
    const s = typeof input === 'string' ? JSON.parse(input) : input;
    if (s && typeof s === 'object' && 'root' in s && s.root) {
      return { v: DOC_VERSION, root: normalize((s as { root: unknown }).root, 0) };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/* ---------- Indexing & derived data ---------- */

export interface TreeIndex {
  byId: Map<string, TreeNode>;
  parentOf: Map<string, TreeNode | null>;
  stats: Map<string, Stats>;
}

export function buildIndex(root: TreeNode): TreeIndex {
  const byId = new Map<string, TreeNode>();
  const parentOf = new Map<string, TreeNode | null>();
  const stats = new Map<string, Stats>();
  // Progress counts todos only. A todo with sub-todos counts as its steps; notes never count.
  const walk = (n: TreeNode, p: TreeNode | null): Stats => {
    byId.set(n.id, n);
    parentOf.set(n.id, p);
    const r: Stats = { total: 0, done: 0 };
    for (const c of n.children) {
      const x = walk(c, n);
      r.total += x.total;
      r.done += x.done;
    }
    if (n.type === 'todo' && r.total === 0) {
      r.total = 1;
      r.done = n.done ? 1 : 0;
    }
    if (n.type === 'note') {
      r.total = 0;
      r.done = 0;
    }
    stats.set(n.id, r);
    return r;
  };
  walk(root, null);
  return { byId, parentOf, stats };
}

export const isComplete = (idx: TreeIndex, n: TreeNode) => {
  if (n.type !== 'todo' && n.type !== 'project') return false;
  const s = idx.stats.get(n.id);
  return !!s && s.total > 0 && s.done === s.total;
};

export const countDesc = (n: TreeNode): number => n.children.reduce((a, c) => a + 1 + countDesc(c), 0);

export const allows = (n: TreeNode, type: NodeType) => (TYPES[n.type].allows as NodeType[]).includes(type);

export const isAncestor = (idx: TreeIndex, ancestorId: string, id: string) => {
  let p = idx.parentOf.get(id);
  while (p) {
    if (p.id === ancestorId) return true;
    p = idx.parentOf.get(p.id) ?? null;
  }
  return false;
};

/** Nearest project (or the root) containing `id`, including the node itself. */
export function focusProjectOf(idx: TreeIndex, id: string | null): string | null {
  let n = id ? idx.byId.get(id) ?? null : null;
  while (n && n.type !== 'project') n = idx.parentOf.get(n.id) ?? null;
  return n ? n.id : null;
}

/** Why `n` can't become `type`, or null if it can. */
export function blockReason(idx: TreeIndex, n: TreeNode, type: ChildType): string | null {
  if (n.type === type) return null;
  const p = idx.parentOf.get(n.id);
  if (p && !allows(p, type)) return `A ${TYPES[p.type].label.toLowerCase()} can’t hold a ${TYPES[type].label.toLowerCase()}`;
  const bad = n.children.find((c) => !(TYPES[type].allows as NodeType[]).includes(c.type));
  if (bad) return type === 'note' ? 'Notes can’t have anything inside them' : `It has a ${TYPES[bad.type].label.toLowerCase()} inside`;
  return null;
}

/** Why `id` can't be moved into `parentId`, or null if it can. */
export function dropBlockReason(idx: TreeIndex, id: string, parentId: string): string | null {
  const n = idx.byId.get(id);
  const p = idx.byId.get(parentId);
  if (!n || !p || n.type === 'root') return 'Can’t move that';
  if (id === parentId || isAncestor(idx, id, parentId)) return 'Can’t move an item inside itself';
  if (!allows(p, n.type)) return `A ${TYPES[p.type].label.toLowerCase()} can’t hold a ${TYPES[n.type].label.toLowerCase()}`;
  return null;
}

/* ---------- Mutations ----------
 * Every operation clones the document and returns a new one, so undo can keep old docs as-is.
 * Operations return null when the change isn't allowed. */

type Draft = { doc: TreeDoc; idx: TreeIndex };
const draft = (doc: TreeDoc): Draft => {
  const d = structuredClone(doc);
  return { doc: d, idx: buildIndex(d.root) };
};

export function addChild(doc: TreeDoc, parentId: string, type: ChildType, title = '') {
  const { doc: d, idx } = draft(doc);
  const p = idx.byId.get(parentId);
  if (!p || !allows(p, type)) return null;
  const n = mk(type, title);
  p.collapsed = false;
  p.children.push(n);
  return { doc: d, id: n.id };
}

export function addSibling(doc: TreeDoc, id: string, title = '') {
  const { doc: d, idx } = draft(doc);
  const node = idx.byId.get(id);
  const p = idx.parentOf.get(id);
  if (!node || !p || node.type === 'root') return null;
  const n = mk(node.type as ChildType, title);
  p.children.splice(p.children.indexOf(node) + 1, 0, n);
  return { doc: d, id: n.id };
}

export function removeNode(doc: TreeDoc, id: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  const p = idx.parentOf.get(id);
  if (!n || !p) return null;
  const i = p.children.indexOf(n);
  const next = p.children[i + 1] || p.children[i - 1] || p;
  p.children.splice(i, 1);
  return { doc: d, nextId: next.id, title: n.title, below: countDesc(n) };
}

export function rename(doc: TreeDoc, id: string, title: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n) return null;
  n.title = title;
  return { doc: d };
}

function setAll(n: TreeNode, v: boolean) {
  if (n.type === 'todo') n.done = v;
  n.children.forEach((c) => setAll(c, v));
}

export function toggleDone(doc: TreeDoc, id: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || n.type !== 'todo') return null;
  const target = !isComplete(idx, n);
  if (n.children.some((c) => c.type === 'todo')) setAll(n, target);
  else n.done = target;
  return { doc: d, done: target };
}

export function toggleFold(doc: TreeDoc, id: string, force?: boolean) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || !n.children.length) return null;
  const v = force ?? !n.collapsed;
  if (v === n.collapsed) return null;
  n.collapsed = v;
  return { doc: d };
}

export function changeType(doc: TreeDoc, id: string, type: ChildType) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || n.type === 'root' || n.type === type || blockReason(idx, n, type)) return null;
  n.type = type;
  if (type !== 'todo') n.done = false;
  return { doc: d };
}

/**
 * Move up/down among siblings. Finished items are shown stacked after open ones, so we swap with the
 * nearest sibling in the same group (open or finished) to match what the user sees.
 */
export function moveSibling(doc: TreeDoc, id: string, dir: -1 | 1) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  const p = idx.parentOf.get(id);
  if (!n || !p) return null;
  const group = isComplete(idx, n);
  const i = p.children.indexOf(n);
  let j = i + dir;
  while (j >= 0 && j < p.children.length && isComplete(idx, p.children[j]) !== group) j += dir;
  if (j < 0 || j >= p.children.length) return null;
  [p.children[i], p.children[j]] = [p.children[j], p.children[i]];
  return { doc: d };
}

export function indent(doc: TreeDoc, id: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  const p = idx.parentOf.get(id);
  if (!n || !p) return null;
  const i = p.children.indexOf(n);
  if (i < 1) return null;
  const np = p.children[i - 1];
  if (!allows(np, n.type)) return { error: `Can’t put a ${TYPES[n.type].label.toLowerCase()} inside a ${TYPES[np.type].label.toLowerCase()}` };
  p.children.splice(i, 1);
  np.collapsed = false;
  np.children.push(n);
  return { doc: d };
}

export function outdent(doc: TreeDoc, id: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  const p = idx.parentOf.get(id);
  const gp = p ? idx.parentOf.get(p.id) : null;
  if (!n || !p || !gp) return null;
  if (!allows(gp, n.type)) return { error: `Can’t put a ${TYPES[n.type].label.toLowerCase()} inside a ${TYPES[gp.type].label.toLowerCase()}` };
  p.children.splice(p.children.indexOf(n), 1);
  gp.children.splice(gp.children.indexOf(p) + 1, 0, n);
  return { doc: d };
}

/**
 * Drag & drop: put `id` into `parentId`, before `beforeId` (or at the end when null).
 */
export function moveTo(doc: TreeDoc, id: string, parentId: string, beforeId: string | null) {
  const { doc: d, idx } = draft(doc);
  const why = dropBlockReason(idx, id, parentId);
  if (why) return { error: why };
  const n = idx.byId.get(id)!;
  const oldP = idx.parentOf.get(id)!;
  const newP = idx.byId.get(parentId)!;
  if (beforeId === id) return null;
  oldP.children.splice(oldP.children.indexOf(n), 1);
  const at = beforeId ? newP.children.findIndex((c) => c.id === beforeId) : -1;
  if (at < 0) newP.children.push(n);
  else newP.children.splice(at, 0, n);
  newP.collapsed = false;
  if (JSON.stringify(d) === JSON.stringify(doc)) return null;
  return { doc: d };
}
