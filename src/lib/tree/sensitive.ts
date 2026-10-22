import type { TreeNode } from './types';

/**
 * Sensitive items (KAN-20): an item marked sensitive, and everything inside it, can be hidden with one toggle,
 * e.g. while screen-sharing. Hidden items show as a locked placeholder; nothing of their content is rendered.
 */

/** Ids of every sensitive item and everything inside one. */
export function sealedIds(root: TreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode, inside: boolean) => {
    const sealed = inside || (n.type !== 'root' && !!n.sensitive);
    if (sealed) out.add(n.id);
    n.children.forEach((c) => walk(c, sealed));
  };
  walk(root, false);
  return out;
}

export const NONE: ReadonlySet<string> = new Set();

/** Remember the toggle in this browser, for every tree: forgetting to turn it on before a meeting is the risk. */
const KEY = 'todo-tree:hide-sensitive';
export function loadHideSensitive(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function saveHideSensitive(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* not remembered */
  }
}

/* ---------- Automatic hiding (KAN-38) ---------- */
/*
 * Browsers never tell a page that it's being shared (Zoom, Teams, Meet). Sharing almost always starts by leaving
 * TwigList to click "Share" elsewhere, so every time TwigList loses focus, sensitive items are hidden.
 * Showing them again is always manual (Shift+H or the eye button).
 */

/** True when anything in the tree is marked sensitive (automatic hiding only acts then). */
export function anySensitive(root: TreeNode): boolean {
  return root.children.some((c) => !!c.sensitive || anySensitive(c));
}
