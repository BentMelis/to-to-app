import type { TreeNode } from './types';
import { loadUserPrefs, saveUserPref } from '@/lib/storage/userPrefs';

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
export const loadHideSensitive = () => loadUserPrefs().hideSensitive;
export const saveHideSensitive = (on: boolean) => saveUserPref('hideSensitive', on);

