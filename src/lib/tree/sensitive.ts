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
 * Browsers never tell a page that it's being shared (Zoom, Teams, Meet). So we hide at the moments sharing usually
 * starts: when you leave TwigList (to click "Share" elsewhere), when TwigList opens, or some minutes after showing them.
 */

export interface AutoHide {
  /** Hide as soon as TwigList loses focus (window, tab or app switch). */
  leave: boolean;
  /** Every visit starts with sensitive items hidden. */
  start: boolean;
  /** Hide again this many minutes after they were shown (0 = never). */
  again: number;
}
export const AUTO_OFF: AutoHide = { leave: false, start: false, again: 0 };
export const AGAIN_CHOICES = [5, 15, 30] as const;

const AUTO_KEY = 'todo-tree:sensitive-auto';

export function parseAutoHide(raw: string | null): AutoHide {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<AutoHide> | null;
    if (!v || typeof v !== 'object') return AUTO_OFF;
    const again = Number(v.again);
    return { leave: v.leave === true, start: v.start === true, again: Number.isFinite(again) && again > 0 ? Math.min(again, 24 * 60) : 0 };
  } catch {
    return AUTO_OFF;
  }
}
export function loadAutoHide(): AutoHide {
  try {
    return parseAutoHide(localStorage.getItem(AUTO_KEY));
  } catch {
    return AUTO_OFF;
  }
}
export function saveAutoHide(a: AutoHide) {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(a));
  } catch {
    /* not remembered */
  }
}

/** True when anything in the tree is marked sensitive (automatic hiding only acts then). */
export function anySensitive(root: TreeNode): boolean {
  return root.children.some((c) => !!c.sensitive || anySensitive(c));
}

/** "Start hidden" applies once per page load, not every time another tree is opened. */
let startChecked = false;

/**
 * The hide state when a tree opens: what was last chosen in this browser, unless "start hidden" is on and this is the
 * first tree opened since the page loaded. `auto` says the start rule switched it on (for analytics).
 */
export function initialHideSensitive(): { hidden: boolean; auto: boolean } {
  const saved = loadHideSensitive();
  const first = !startChecked;
  startChecked = true;
  if (first && !saved && loadAutoHide().start) {
    saveHideSensitive(true);
    return { hidden: true, auto: true };
  }
  return { hidden: saved, auto: false };
}

/** Tests only: pretend the page was just loaded. */
export function resetStartCheck() {
  startChecked = false;
}
