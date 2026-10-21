import { parseDoc } from '@/lib/tree/model';
import { firstList, FIRST_TREE_ID, FIRST_TREE_NAME, parseList, type TreeList } from '@/lib/tree/trees';
import type { TreeDoc } from '@/lib/tree/types';

/**
 * Where one tree lives. v1 ships with browser storage only; a server-backed adapter
 * (accounts + sync) implements the same interface later without touching the UI.
 */
export interface StorageAdapter {
  readonly kind: 'local' | 'remote';
  load(): Promise<TreeDoc | null>;
  save(doc: TreeDoc): Promise<void>;
}

/**
 * All of a user's trees: the list (names, order, last opened) plus one document per tree.
 * Sync (KAN-11) should keep this shape: one document per tree, plus the small list.
 */
export interface Library {
  loadList(): Promise<TreeList>;
  saveList(list: TreeList): Promise<void>;
  /** Storage for one tree. Stable per id. */
  adapter(treeId: string): StorageAdapter;
  /** Permanently delete a tree's document and its viewing preferences. */
  remove(treeId: string): Promise<void>;
}

/** Single-tree storage from before multiple trees (and from the POC). Left in place as a safety copy. */
export const LEGACY_KEY = 'todo-tree:v1';
const LIST_KEY = 'todo-tree:trees';
const PREFIX = 'todo-tree:';
const docKey = (id: string) => `${PREFIX}tree:${id}`;
/** Per-tree viewing preferences (camera, filters, last meeting tab): not part of the tree itself. */
const PREF_KINDS = ['view', 'filters', 'meeting'] as const;
type PrefKind = (typeof PREF_KINDS)[number];
const prefKey = (kind: PrefKind, id: string) => `${PREFIX}${kind}:${id}`;

const get = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode or full: not remembered */
  }
};
const del = (k: string) => {
  try {
    window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

/** Viewing preferences per tree, remembered in this browser only. */
export const prefs = {
  get<T>(kind: PrefKind, treeId: string): T | null {
    const raw = get(prefKey(kind, treeId));
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  set(kind: PrefKind, treeId: string, value: unknown) {
    set(prefKey(kind, treeId), JSON.stringify(value));
  },
};

/** First run after the update: the single existing tree becomes the first tree. Nothing is lost. */
function migrate(): TreeList {
  const legacy = get(LEGACY_KEY);
  const doc = legacy ? parseDoc(legacy) : null;
  const list = firstList(doc?.root.title || FIRST_TREE_NAME);
  if (doc && legacy) set(docKey(FIRST_TREE_ID), legacy);
  const filters = get(`${PREFIX}filters`);
  if (filters) set(prefKey('filters', FIRST_TREE_ID), filters);
  const meeting = get(`${PREFIX}meeting`);
  if (meeting) set(prefKey('meeting', FIRST_TREE_ID), JSON.stringify(meeting));
  set(LIST_KEY, JSON.stringify(list));
  return list;
}

/** Documents of trees that are no longer in the list (e.g. the app closed during "Undo"). */
function sweep(list: TreeList) {
  const keep = new Set(list.trees.map((t) => t.id));
  const kinds = ['tree', ...PREF_KINDS];
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i) ?? '';
      const m = /^todo-tree:([a-z]+):([\w-]+)$/.exec(k);
      if (m && kinds.includes(m[1]) && !keep.has(m[2])) stale.push(k);
    }
    stale.forEach(del);
  } catch {
    /* ignore */
  }
}

const adapters = new Map<string, StorageAdapter>();

export const localLibrary: Library = {
  async loadList() {
    const list = parseList(get(LIST_KEY));
    if (!list) return migrate();
    sweep(list);
    return list;
  },
  async saveList(list) {
    set(LIST_KEY, JSON.stringify(list));
  },
  adapter(treeId) {
    let a = adapters.get(treeId);
    if (!a) {
      a = {
        kind: 'local',
        async load() {
          const raw = get(docKey(treeId));
          return raw ? parseDoc(raw) : null;
        },
        async save(doc) {
          window.localStorage.setItem(docKey(treeId), JSON.stringify(doc));
        },
      };
      adapters.set(treeId, a);
    }
    return a;
  },
  async remove(treeId) {
    del(docKey(treeId));
    PREF_KINDS.forEach((k) => del(prefKey(k, treeId)));
    adapters.delete(treeId);
  },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'tree';

/** Download one tree as a JSON backup. The root carries the tree's name. */
export function exportDoc(doc: TreeDoc, treeName: string) {
  const data: TreeDoc = { ...doc, root: { ...doc.root, title: treeName } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `twiglist-${slug(treeName)}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importDoc(file: File): Promise<TreeDoc | null> {
  return parseDoc(await file.text());
}
