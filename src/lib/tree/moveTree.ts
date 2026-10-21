import { allows, buildIndex, countDesc, uid } from './model';
import type { FlagKind, Meeting, TreeDoc, TreeNode } from './types';

/**
 * Moving an item (with everything inside it) to another tree.
 *
 * The moved copy gets fresh ids, so it can never clash with what's already in the target tree (two trees
 * restored from the same backup share ids). Meeting flags follow by meeting *name*: a flag for "Standup" stays
 * a "Standup" flag if the target tree has a meeting called Standup, and is dropped otherwise.
 */

export interface MovePlan {
  /** The copy that goes into the target tree. */
  node: TreeNode;
  /** The item plus everything inside it. */
  items: number;
  kept: number;
  dropped: number;
  /** Names of the meetings whose flags are dropped (for the confirmation). */
  droppedMeetings: string[];
}

const key = (name: string) => name.trim().toLowerCase();

export function planMove(src: TreeDoc, id: string, dst: TreeDoc, now = Date.now()): MovePlan | null {
  const idx = buildIndex(src.root);
  const original = idx.byId.get(id);
  if (!original || original.type === 'root') return null;
  const srcName = new Map(src.meetings.map((m) => [m.id, m.name]));
  const dstId = new Map(dst.meetings.map((m: Meeting) => [key(m.name), m.id]));
  let kept = 0;
  let dropped = 0;
  const droppedMeetings = new Set<string>();

  const copy = (n: TreeNode): TreeNode => {
    const out: TreeNode = { ...n, id: uid(), children: n.children.map(copy) };
    if (n.flags) {
      const flags: Record<string, FlagKind> = {};
      for (const [mid, kind] of Object.entries(n.flags)) {
        const name = srcName.get(mid) ?? '';
        const target = name ? dstId.get(key(name)) : undefined;
        if (target) {
          flags[target] = kind;
          kept++;
        } else {
          dropped++;
          if (name) droppedMeetings.add(name);
        }
      }
      if (Object.keys(flags).length) out.flags = flags;
      else delete out.flags;
    }
    return out;
  };
  const node = copy(structuredClone(original));
  // Moving counts as activity for the idle heads-up.
  node.touched = now;
  return { node, items: 1 + countDesc(original), kept, dropped, droppedMeetings: [...droppedMeetings] };
}

/** The target tree with the moved item added at the end of its top level. */
export function addToRoot(dst: TreeDoc, node: TreeNode): TreeDoc {
  const d = structuredClone(dst);
  d.root.children.push(node);
  return d;
}

/**
 * Put an item back where it came from (undo). If its old parent is gone or can no longer hold it,
 * it goes to the top level.
 */
export function insertAt(doc: TreeDoc, parentId: string, index: number, node: TreeNode): TreeDoc {
  const d = structuredClone(doc);
  const idx = buildIndex(d.root);
  if (idx.byId.has(node.id)) return d;
  const parent = idx.byId.get(parentId);
  const target = parent && allows(parent, node.type) ? parent : d.root;
  const at = target === parent ? Math.min(Math.max(0, index), target.children.length) : target.children.length;
  target.children.splice(at, 0, structuredClone(node));
  return d;
}
