import { DUE_RE, dueLevel, daysUntil, type DueLevel } from './dates';
import {
  DOC_VERSION,
  MAX_MEETINGS,
  MEETING_COLORS,
  TYPES,
  canSchedule,
  type ChildType,
  type FlagKind,
  type Meeting,
  type MeetingColor,
  type NodeType,
  type Stats,
  type TreeDoc,
  type TreeNode,
} from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const mk = (type: ChildType, title: string, children: TreeNode[] = [], done = false): TreeNode => ({
  id: uid(),
  type,
  title,
  done,
  collapsed: false,
  touched: Date.now(),
  children,
});

export const defaultMeetings = (): Meeting[] => [{ id: 'standup', name: 'Standup', color: 'amber' }];

export function starter(): TreeDoc {
  return {
    v: DOC_VERSION,
    meetings: defaultMeetings(),
    settings: { idleDays: 7 },
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

function readFlags(n: Record<string, unknown>): { flags?: Record<string, FlagKind> } {
  const flags: Record<string, FlagKind> = {};
  if (n.flags && typeof n.flags === 'object') {
    for (const [k, v] of Object.entries(n.flags as Record<string, unknown>)) if (v === 'ask' || v === 'mention') flags[k] = v;
  }
  // v2 had a single "open question for standup" flag.
  if (n.question === true && !flags.standup) flags.standup = 'ask';
  return Object.keys(flags).length ? { flags } : {};
}

function readMeetings(raw: unknown): Meeting[] {
  if (!Array.isArray(raw)) return defaultMeetings();
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const id = String((m as Meeting).id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const color = MEETING_COLORS.includes((m as Meeting).color) ? (m as Meeting).color : MEETING_COLORS[out.length % MEETING_COLORS.length];
    out.push({ id, name: String((m as Meeting).name || 'Meeting').slice(0, 40), color });
  }
  return out.slice(0, MAX_MEETINGS);
}

/** Drop flags that point at meetings that no longer exist. */
function pruneFlags(n: TreeNode, ids: Set<string>) {
  if (n.flags) {
    for (const k of Object.keys(n.flags)) if (!ids.has(k)) delete n.flags[k];
    if (!Object.keys(n.flags).length) delete n.flags;
  }
  n.children.forEach((c) => pruneFlags(c, ids));
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
    ...(depth > 0 ? readFlags(n) : {}),
    ...(n.high && canSchedule(type) ? { high: true } : {}),
    ...(typeof n.due === 'string' && DUE_RE.test(n.due) && canSchedule(type) ? { due: n.due } : {}),
    // Kept even if the type changes, so turning a project into a note and back loses nothing.
    ...(typeof n.notes === 'string' && n.notes.trim() && depth > 0 ? { notes: n.notes } : {}),
    // Items from before activity tracking start their clock now, so nothing is instantly "idle".
    ...(depth > 0 ? { touched: typeof n.touched === 'number' && isFinite(n.touched) ? n.touched : Date.now() } : {}),
    children,
  };
}

export function parseDoc(input: unknown): TreeDoc | null {
  try {
    const s = typeof input === 'string' ? JSON.parse(input) : input;
    if (s && typeof s === 'object' && 'root' in s && s.root) {
      const root = normalize((s as { root: unknown }).root, 0);
      const meetings = readMeetings((s as { meetings?: unknown }).meetings);
      pruneFlags(root, new Set(meetings.map((m) => m.id)));
      const raw = (s as { settings?: { idleDays?: unknown } }).settings;
      const idleDays = typeof raw?.idleDays === 'number' && raw.idleDays >= 0 ? Math.min(365, Math.round(raw.idleDays)) : 7;
      return { v: DOC_VERSION, root, meetings, settings: { idleDays } };
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
  if (!canSchedule(type)) {
    delete n.high;
    delete n.due;
  }
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

/* ---------- Meeting flags ---------- */

/** Flag an item for a meeting (`ask` or `mention`), or clear it with `null`. */
export function setFlag(doc: TreeDoc, id: string, meetingId: string, kind: FlagKind | null) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || n.type === 'root' || !d.meetings.some((m) => m.id === meetingId)) return null;
  if ((n.flags?.[meetingId] ?? null) === kind) return null;
  if (kind) n.flags = { ...n.flags, [meetingId]: kind };
  else if (n.flags) {
    delete n.flags[meetingId];
    if (!Object.keys(n.flags).length) delete n.flags;
  }
  return { doc: d };
}

export function addMeeting(doc: TreeDoc, name: string, color?: MeetingColor) {
  if (doc.meetings.length >= MAX_MEETINGS || !name.trim()) return null;
  const d = structuredClone(doc);
  const used = new Set(d.meetings.map((m) => m.color));
  const m: Meeting = {
    id: uid(),
    name: name.trim().slice(0, 40),
    color: color ?? MEETING_COLORS.find((c) => !used.has(c)) ?? MEETING_COLORS[d.meetings.length % MEETING_COLORS.length],
  };
  d.meetings.push(m);
  return { doc: d, id: m.id };
}

export function updateMeeting(doc: TreeDoc, meetingId: string, patch: Partial<Pick<Meeting, 'name' | 'color'>>) {
  const d = structuredClone(doc);
  const m = d.meetings.find((x) => x.id === meetingId);
  if (!m) return null;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 40) : m.name;
  const color = patch.color ?? m.color;
  if (!name || (name === m.name && color === m.color)) return null;
  m.name = name;
  m.color = color;
  return { doc: d };
}

/** Remove a meeting and every flag pointing at it. */
export function removeMeeting(doc: TreeDoc, meetingId: string) {
  if (!doc.meetings.some((m) => m.id === meetingId)) return null;
  const d = structuredClone(doc);
  d.meetings = d.meetings.filter((m) => m.id !== meetingId);
  pruneFlags(d.root, new Set(d.meetings.map((m) => m.id)));
  return { doc: d };
}

export interface FlaggedItem {
  id: string;
  title: string;
  type: TreeNode['type'];
  /** Titles of the projects/todos above it, top level first (root excluded). */
  path: string[];
  done: boolean;
  kind: FlagKind;
}

/** Everything flagged for a meeting, in tree order. */
export function collectFlags(root: TreeNode, idx: TreeIndex, meetingId: string): FlaggedItem[] {
  const out: FlaggedItem[] = [];
  const walk = (n: TreeNode, path: string[]) => {
    const kind = n.flags?.[meetingId];
    if (kind && n.type !== 'root') out.push({ id: n.id, title: n.title, type: n.type, path, done: isComplete(idx, n), kind });
    const next = n.type === 'root' ? path : [...path, n.title || 'Untitled'];
    n.children.forEach((c) => walk(c, next));
  };
  walk(root, []);
  return out;
}

/** Number of items flagged for any meeting. */
export const countFlagged = (root: TreeNode): number =>
  (root.flags && Object.keys(root.flags).length ? 1 : 0) + root.children.reduce((a, c) => a + countFlagged(c), 0);

/** Plain-text agenda for one meeting, ready to paste into a chat. */
export function meetingAsText(meeting: Meeting, items: FlaggedItem[], date = new Date()) {
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const line = (q: FlaggedItem) => `• ${q.path.length ? q.path.join(' › ') + ': ' : ''}${q.title || 'Untitled'}${q.done ? ' (done ✓)' : ''}`;
  const asks = items.filter((i) => i.kind === 'ask');
  const mentions = items.filter((i) => i.kind === 'mention');
  const out = [`${meeting.name} (${day})`];
  if (asks.length) out.push('', 'Questions', ...asks.map(line));
  if (mentions.length) out.push('', 'Updates', ...mentions.map(line));
  return out.join('\n');
}

/** Unfold every collapsed ancestor so `id` can be seen. Returns null when nothing needed unfolding. */
export function unfoldTo(doc: TreeDoc, id: string) {
  const { doc: d, idx } = draft(doc);
  let p = idx.parentOf.get(id) ?? null;
  let changed = false;
  while (p) {
    if (p.collapsed) {
      p.collapsed = false;
      changed = true;
    }
    p = idx.parentOf.get(p.id) ?? null;
  }
  return changed ? { doc: d } : null;
}

/* ---------- Priority & deadlines ---------- */

export function toggleHigh(doc: TreeDoc, id: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || !canSchedule(n.type)) return null;
  if (n.high) delete n.high;
  else n.high = true;
  return { doc: d, high: !!n.high };
}

/** Set or clear (`null`) a deadline. */
export function setDue(doc: TreeDoc, id: string, due: string | null) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || !canSchedule(n.type)) return null;
  if (due !== null && !DUE_RE.test(due)) return null;
  if ((n.due ?? null) === due) return null;
  if (due) n.due = due;
  else delete n.due;
  return { doc: d };
}

const RANK: Record<DueLevel, number> = { later: 0, soon: 1, urgent: 2 };

/** The most pressing deadline among unfinished items below `n` (for hints on folded branches). */
export function worstDueBelow(n: TreeNode, idx: TreeIndex, today: string): DueLevel | null {
  let worst: DueLevel | null = null;
  const walk = (c: TreeNode) => {
    if (c.due && !isComplete(idx, c)) {
      const lvl = dueLevel(daysUntil(c.due, today));
      if (!worst || RANK[lvl] > RANK[worst]) worst = lvl;
    }
    c.children.forEach(walk);
  };
  n.children.forEach(walk);
  return worst;
}

/* ---------- Notes panel ---------- */

export function setNotes(doc: TreeDoc, id: string, notes: string) {
  const { doc: d, idx } = draft(doc);
  const n = idx.byId.get(id);
  if (!n || n.type === 'root') return null;
  const v = notes.replace(/\s+$/, '');
  if ((n.notes ?? '') === v) return null;
  if (v) n.notes = v;
  else delete n.notes;
  return { doc: d };
}

/** Titles from the top level down to (not including) `id`. */
export function pathTo(idx: TreeIndex, id: string) {
  const out: string[] = [];
  for (let p = idx.parentOf.get(id); p && p.type !== 'root'; p = idx.parentOf.get(p.id) ?? null) out.unshift(p.title || 'Untitled');
  return out;
}

/* ---------- Settings ---------- */

export const idleDaysOf = (doc: TreeDoc) => doc.settings?.idleDays ?? 7;

export function setIdleDays(doc: TreeDoc, days: number) {
  if (days < 0 || idleDaysOf(doc) === days) return null;
  return { doc: { ...doc, settings: { ...doc.settings, idleDays: days } } };
}
