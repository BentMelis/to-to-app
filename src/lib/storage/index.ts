import { parseDoc } from '@/lib/tree/model';
import type { TreeDoc } from '@/lib/tree/types';

/**
 * Where a tree lives. v1 ships with browser storage only; a server-backed adapter
 * (accounts + sync) implements the same interface later without touching the UI.
 */
export interface StorageAdapter {
  readonly kind: 'local' | 'remote';
  load(): Promise<TreeDoc | null>;
  save(doc: TreeDoc): Promise<void>;
}

/** Same key as the POC, so trees saved by the old PWA carry over. */
export const LOCAL_KEY = 'todo-tree:v1';

export const localAdapter: StorageAdapter = {
  kind: 'local',
  async load() {
    try {
      const raw = window.localStorage.getItem(LOCAL_KEY);
      return raw ? parseDoc(raw) : null;
    } catch {
      return null;
    }
  },
  async save(doc) {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
  },
};

export function exportDoc(doc: TreeDoc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `todo-tree-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importDoc(file: File): Promise<TreeDoc | null> {
  return parseDoc(await file.text());
}
