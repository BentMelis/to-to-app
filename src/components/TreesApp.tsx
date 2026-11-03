'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { localLibrary, type Library } from '@/lib/storage';
import type { CloudLibrary, Conflict, SyncState } from '@/lib/cloud/library';
import * as T from '@/lib/tree/trees';
import { forgetSession } from '@/lib/tree/useTreeStore';
import TodoTree from './TodoTree';
import { TreeMenu } from './TreeMenu';
import { track } from '@/lib/analytics';

/** How long a deleted tree can be brought back. */
const UNDO_MS = 10_000;

/**
 * The user's trees around the canvas: loads the list (migrating a single old tree into the first one),
 * remembers which tree is open, and handles the switcher, creating, renaming, reordering and deleting.
 * Every tree gets its own canvas (keyed by id), so selection, camera, filters and undo never leak between trees.
 */
interface Props {
  /** Where the trees live: this browser (default) or the signed-in account. */
  library?: Library;
  /** Set when signed in: sync status, conflicts and changes from other devices. */
  cloud?: CloudLibrary;
  /** The "Sign in" / account button for the toolbar. */
  account?: ReactNode;
}

export default function TreesApp({ library = localLibrary, cloud, account }: Props) {
  const lib = library;
  const [list, setList] = useState<T.TreeList | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sync, setSync] = useState<SyncState>(() => cloud?.syncState ?? 'synced');
  const [conflict, setConflict] = useState<(Conflict & { key: number }) | null>(null);
  const [menu, setMenu] = useState(false);
  const [deleted, setDeleted] = useState<{ removed: T.RemovedTree; key: number } | null>(null);
  const finalizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T.RemovedTree | null>(null);

  useEffect(() => {
    lib.loadList().then(setList, () => setLoadError(true));
  }, [lib]);

  // Signed in: the list as other devices change it, the sync status, and "changed on another device too".
  useEffect(() => {
    if (!cloud) return;
    const offs = [
      cloud.onList((l) => setList((prev) => (prev ? { ...l, lastOpenedId: l.trees.some((t) => t.id === prev.lastOpenedId) ? prev.lastOpenedId : l.lastOpenedId } : l))),
      cloud.onState(setSync),
      cloud.onConflict((c) => {
        setConflict({ ...c, key: Date.now() });
        track('sync_conflict');
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [cloud]);

  /** Change the list based on its latest state (two quick changes in a row must not overwrite each other). */
  const update = useCallback((change: (l: T.TreeList) => T.TreeList) => {
    setList((prev) => {
      if (!prev) return prev;
      const next = change(prev);
      if (next !== prev) lib.saveList(next);
      return next;
    });
  }, [lib]);

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
  }, [lib]);
  useEffect(() => {
    // Leaving the page during the undo window: the list no longer has the tree, so it's swept on next start.
    return () => {
      if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
    };
  }, []);

  // "Move to tree…": read and write other trees. Writing drops that tree's in-memory session, so it reloads fresh.
  const loadTree = useCallback((id: string) => lib.adapter(id).load(), [lib]);
  const saveTree = useCallback(
    async (id: string, doc: T.TreeDoc) => {
      await lib.adapter(id).save(doc);
      forgetSession(id);
    },
    [lib],
  );
  const otherTrees = useMemo(() => (list ? list.trees.filter((t) => t.id !== list.lastOpenedId) : []), [list]);
  /** After "Open" in the move toast: which item to select once the other tree is open. */
  const [selectOnOpen, setSelectOnOpen] = useState<{ treeId: string; itemId: string } | null>(null);

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(false);
    if (refocus) requestAnimationFrame(() => document.getElementById('vp')?.focus({ preventScroll: true }));
  }, []);

  if (loadError)
    return (
      <div className="empty boot-error" role="alert">
        <h2>Can’t reach your account</h2>
        <p>Check your internet connection and try again.</p>
        <button className="tb primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  if (!list) return <div className="boot" aria-busy="true" />;
  const current = T.currentTree(list);

  const open = (id: string) => {
    setSelectOnOpen(null);
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
        otherTrees={otherTrees}
        loadTree={loadTree}
        saveTree={saveTree}
        onOpenTree={(id, itemId) => {
          setSelectOnOpen(itemId ? { treeId: id, itemId } : null);
          track('tree_switched');
          update((l) => T.openTree(l, id));
        }}
        selectOnOpen={selectOnOpen?.treeId === current.id ? selectOnOpen.itemId : null}
        account={account}
        sync={cloud ? sync : undefined}
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
      {conflict && !deleted && (
        <div className="toast tree-toast" role="status" key={conflict.key}>
          <span>“{conflict.treeName}” was also changed on another device. Yours was kept.</span>
          <button
            onClick={() => {
              cloud?.adapter(conflict.treeId).applyRemote(conflict.theirs);
              setConflict(null);
            }}
          >
            Use the other version
          </button>
          <button aria-label="Close" onClick={() => setConflict(null)}>
            ×
          </button>
        </div>
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
