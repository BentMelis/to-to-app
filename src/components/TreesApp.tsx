'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localLibrary } from '@/lib/storage';
import * as T from '@/lib/tree/trees';
import { forgetSession } from '@/lib/tree/useTreeStore';
import TodoTree from './TodoTree';
import { TreeMenu } from './TreeMenu';
import { track } from '@/lib/analytics';

/** How long a deleted tree can be brought back. */
const UNDO_MS = 10_000;

const lib = localLibrary;

/**
 * The user's trees around the canvas: loads the list (migrating a single old tree into the first one),
 * remembers which tree is open, and handles the switcher, creating, renaming, reordering and deleting.
 * Every tree gets its own canvas (keyed by id), so selection, camera, filters and undo never leak between trees.
 */
export default function TreesApp() {
  const [list, setList] = useState<T.TreeList | null>(null);
  const [menu, setMenu] = useState(false);
  const [deleted, setDeleted] = useState<{ removed: T.RemovedTree; key: number } | null>(null);
  const finalizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T.RemovedTree | null>(null);

  useEffect(() => {
    lib.loadList().then(setList);
  }, []);

  /** Change the list based on its latest state (two quick changes in a row must not overwrite each other). */
  const update = useCallback((change: (l: T.TreeList) => T.TreeList) => {
    setList((prev) => {
      if (!prev) return prev;
      const next = change(prev);
      if (next !== prev) lib.saveList(next);
      return next;
    });
  }, []);

  /** A deleted tree is only really removed once its undo window has passed. */
  const finalize = useCallback(() => {
    if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
    finalizeTimer.current = null;
    const r = pending.current;
    pending.current = null;
    if (r) {
      lib.remove(r.entry.id);
      forgetSession(r.entry.id);
    }
    setDeleted(null);
  }, []);
  useEffect(() => {
    // Leaving the page during the undo window: the list no longer has the tree, so it's swept on next start.
    return () => {
      if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
    };
  }, []);

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(false);
    if (refocus) requestAnimationFrame(() => document.getElementById('vp')?.focus({ preventScroll: true }));
  }, []);

  if (!list) return <div className="boot" aria-busy="true" />;
  const current = T.currentTree(list);

  const open = (id: string) => {
    if (id !== list.lastOpenedId) track('tree_switched');
    update((l) => (id === l.lastOpenedId ? l : T.openTree(l, id)));
    closeMenu(true);
  };
  const create = async (name: string) => {
    const r = T.addTree(list, name);
    if (!r) return;
    await lib.adapter(r.id).save(T.emptyTree(name));
    track('tree_created', { trees: r.list.trees.length });
    update((l) => (l.trees.length >= T.MAX_TREES ? l : { trees: [...l.trees, r.list.trees[r.list.trees.length - 1]], lastOpenedId: r.id }));
    closeMenu(true);
  };
  const remove = (id: string) => {
    const r = T.removeTree(list, id);
    if (!r) return;
    finalize(); // an earlier deletion is now final
    track('tree_deleted');
    pending.current = r.removed;
    update((l) => T.removeTree(l, id)?.list ?? l);
    setDeleted({ removed: r.removed, key: Date.now() });
    finalizeTimer.current = setTimeout(finalize, UNDO_MS);
  };
  const undoDelete = () => {
    const r = pending.current;
    if (!r) return;
    if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
    pending.current = null;
    setDeleted(null);
    update((l) => T.restoreTree(l, r));
  };

  return (
    <>
      <TodoTree
        key={current.id}
        treeId={current.id}
        treeName={current.name}
        adapter={lib.adapter(current.id)}
        treeMenuOpen={menu}
        onTreeMenu={() => setMenu((m) => !m)}
        onRenameTree={(name) => update((l) => T.renameTree(l, current.id, name))}
      />
      {menu && (
        <TreeMenu
          list={list}
          onOpen={open}
          onCreate={create}
          onRename={(id, name) => update((l) => T.renameTree(l, id, name))}
          onMove={(id, dir) => update((l) => T.moveTree(l, id, dir))}
          onDelete={remove}
          countFor={async (id) => T.countItems(await lib.adapter(id).load())}
          onClose={closeMenu}
        />
      )}
      {deleted && (
        <div className="toast tree-toast" role="status" key={deleted.key}>
          <span>Deleted tree “{deleted.removed.entry.name}”</span>
          <button onClick={undoDelete}>Undo</button>
        </div>
      )}
    </>
  );
}
