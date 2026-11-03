/**
 * Trees saved to the signed-in account (KAN-43). Implements the same `Library` / `StorageAdapter` interfaces
 * as browser storage, so the canvas doesn't know the difference.
 *
 * - Every save goes to the account (the canvas already debounces). A save carries the rev it's based on.
 * - Someone else saved first (409, another device): last write wins. Ours is saved, and theirs is offered
 *   ("Use that version") so nothing is lost silently.
 * - Offline: the last synced trees and unsynced changes are kept in this browser (a cache, not the source of
 *   truth) and sent when the connection is back. Signing out clears it.
 * - Changes from other devices are picked up when the window regains focus, and every 30 seconds while visible.
 */
import type { Library, StorageAdapter } from '@/lib/storage';
import { forgetSession } from '@/lib/tree/useTreeStore';
import { parseDoc } from '@/lib/tree/model';
import { cleanName, type TreeList } from '@/lib/tree/trees';
import type { TreeDoc } from '@/lib/tree/types';
import type { TreeMeta, TreeRecord } from './types';
import { api, ApiError, OfflineError } from './api';

export type SyncState = 'synced' | 'saving' | 'offline' | 'error';

export interface Conflict {
  treeId: string;
  treeName: string;
  /** The version from the other device that ours replaced. */
  theirs: TreeDoc;
}

type DocListener = (doc: TreeDoc, opts: { persist: boolean }) => void;

interface Entry {
  doc: TreeDoc;
  /** The server rev this doc is based on (0: not on the server yet). */
  rev: number;
  /** Changed here and not saved to the account yet. */
  dirty: boolean;
}

type ListOp = { t: 'rename'; id: string; name: string } | { t: 'order'; ids: string[] } | { t: 'delete'; id: string } | { t: 'restore'; id: string };

const POLL_MS = 30_000;
const RETRY_MS = 15_000;

/* ---------- Cache in this browser (per account) ---------- */

const base = (uid: string) => `todo-tree:cloud:${uid}:`;
function readJSON<T>(k: string): T | null {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJSON(k: string, v: unknown) {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* full or private mode: the account still has everything */
  }
}
function removeKey(k: string) {
  try {
    window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Remove everything cached for an account in this browser (on sign-out and account deletion). */
export function clearCache(uid: string) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i) ?? '';
      if (k.startsWith(base(uid))) keys.push(k);
    }
    keys.forEach(removeKey);
  } catch {
    /* ignore */
  }
}

/* ---------- The library ---------- */

export class CloudLibrary implements Library {
  readonly uid: string;
  private meta = new Map<string, TreeMeta>();
  private entries = new Map<string, Entry>();
  private list: TreeList | null = null;
  private ops: ListOp[];
  private removed = new Set<string>();
  private inflight = new Set<string>();
  private again = new Set<string>();
  private flushing = false;
  private adapters = new Map<string, StorageAdapter>();
  private docListeners = new Map<string, Set<DocListener>>();
  private listListeners = new Set<(l: TreeList) => void>();
  private stateListeners = new Set<(s: SyncState) => void>();
  private conflictListeners = new Set<(c: Conflict) => void>();
  private state: SyncState = 'synced';
  private failure: 'offline' | 'error' | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private detach: (() => void) | null = null;

  constructor(uid: string) {
    this.uid = uid;
    this.ops = readJSON<ListOp[]>(this.key('ops')) ?? [];
    // Trees cached in this browser (incl. unsynced changes from an earlier session).
    const ids = readJSON<string[]>(this.key('docs')) ?? [];
    for (const id of ids) {
      const e = readJSON<Entry>(this.key(`doc:${id}`));
      const doc = e && parseDoc(e.doc);
      if (doc) this.entries.set(id, { doc, rev: e.rev, dirty: !!e.dirty });
    }
  }

  private key(k: string) {
    return base(this.uid) + k;
  }
  private storeEntry(id: string, e: Entry | null) {
    if (e) this.entries.set(id, e);
    else this.entries.delete(id);
    if (e) writeJSON(this.key(`doc:${id}`), e);
    else removeKey(this.key(`doc:${id}`));
    writeJSON(this.key('docs'), [...this.entries.keys()]);
  }
  private saveOps() {
    writeJSON(this.key('ops'), this.ops);
  }

  /* ----- Status ----- */

  get syncState() {
    return this.state;
  }
  /** Unsynced changes in this browser (shown before signing out). */
  get hasUnsynced() {
    return this.ops.length > 0 || [...this.entries.values()].some((e) => e.dirty);
  }
  private updateState() {
    const busy = this.inflight.size > 0 || this.flushing;
    const pending = this.hasUnsynced;
    const s: SyncState = this.failure === 'offline' && pending ? 'offline' : this.failure === 'error' ? 'error' : busy || pending ? 'saving' : 'synced';
    if (s !== this.state) {
      this.state = s;
      this.stateListeners.forEach((f) => f(s));
    }
  }
  onState(f: (s: SyncState) => void) {
    this.stateListeners.add(f);
    return () => void this.stateListeners.delete(f);
  }
  onConflict(f: (c: Conflict) => void) {
    this.conflictListeners.add(f);
    return () => void this.conflictListeners.delete(f);
  }
  /** The list changed on another device (renamed, reordered, added, deleted). */
  onList(f: (l: TreeList) => void) {
    this.listListeners.add(f);
    return () => void this.listListeners.delete(f);
  }
  private fail(e: unknown) {
    this.failure = e instanceof OfflineError ? 'offline' : 'error';
    this.updateState();
    this.retryLater();
  }
  private retryLater() {
    this.timers.push(setTimeout(() => void this.sync(), RETRY_MS));
  }

  /* ----- Lifecycle: pick up changes from other devices ----- */

  start() {
    if (this.detach) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') void this.sync();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const poll = setInterval(onFocus, POLL_MS);
    this.detach = () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(poll);
    };
    // Unsynced changes from an earlier session go out now.
    if (this.hasUnsynced) void this.sync();
  }
  stop() {
    this.detach?.();
    this.detach = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Send what's waiting, then fetch what changed elsewhere. */
  async sync() {
    await this.flushOps();
    for (const [id, e] of this.entries) if (e.dirty) void this.push(id);
    await this.pull();
  }

  /** Fetch the list and any tree that changed on another device. */
  async pull() {
    let trees: TreeMeta[];
    try {
      trees = (await api<{ trees: TreeMeta[] }>('/api/trees')).trees;
    } catch (e) {
      if (e instanceof OfflineError) this.fail(e);
      return;
    }
    if (this.failure && !this.hasUnsynced) this.failure = null;
    this.updateState();
    this.setMeta(trees);
    for (const t of trees) {
      const e = this.entries.get(t.id);
      if (!e || e.dirty || this.inflight.has(t.id) || t.rev <= e.rev) continue;
      try {
        const rec = await api<TreeRecord>(`/api/trees/${encodeURIComponent(t.id)}`);
        const cur = this.entries.get(t.id);
        if (!cur || cur.dirty || this.inflight.has(t.id)) continue; // edited meanwhile: our next save handles it
        this.storeEntry(t.id, { doc: rec.doc, rev: rec.rev, dirty: false });
        this.emitDoc(t.id, rec.doc, false);
      } catch {
        /* next time */
      }
    }
    // The list as the account has it now, unless list changes of ours are still on their way.
    if (this.list && !this.ops.length) {
      const next = this.toList(trees, this.list.lastOpenedId);
      if (next && !sameList(next, this.list)) {
        this.list = next;
        this.listListeners.forEach((f) => f(next));
      }
    }
  }

  private setMeta(trees: TreeMeta[]) {
    this.meta = new Map(trees.map((t) => [t.id, t]));
  }
  private toList(trees: TreeMeta[], lastOpenedId?: string): TreeList | null {
    if (!trees.length) return null;
    const last = lastOpenedId && trees.some((t) => t.id === lastOpenedId) ? lastOpenedId : trees[0].id;
    return { trees: trees.map((t) => ({ id: t.id, name: t.name })), lastOpenedId: last };
  }

  /* ----- Library ----- */

  async loadList(): Promise<TreeList> {
    const lastOpenedId = readJSON<string>(this.key('open')) ?? undefined;
    try {
      const { trees } = await api<{ trees: TreeMeta[] }>('/api/trees');
      this.setMeta(trees);
      writeJSON(this.key('list'), trees);
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      // Offline: the list as it was last time.
      const cached = readJSON<TreeMeta[]>(this.key('list'));
      if (!cached) throw e;
      this.setMeta(cached);
      this.fail(e);
    }
    const list = this.toList([...this.meta.values()].sort((a, b) => a.order - b.order), lastOpenedId);
    if (!list) throw new ApiError(404, 'no_trees');
    this.list = list;
    return list;
  }

  async saveList(next: TreeList) {
    writeJSON(this.key('open'), next.lastOpenedId);
    const prev = this.list;
    this.list = next;
    if (!prev) return;
    const before = new Map(prev.trees.map((t) => [t.id, t]));
    const after = new Map(next.trees.map((t) => [t.id, t]));
    for (const t of prev.trees) if (!after.has(t.id)) {
      this.removed.add(t.id);
      this.ops.push({ t: 'delete', id: t.id });
    }
    for (const t of next.trees) {
      const was = before.get(t.id);
      if (!was && this.removed.has(t.id)) {
        this.removed.delete(t.id);
        this.ops.push({ t: 'restore', id: t.id });
      } else if (was && was.name !== t.name && (this.meta.has(t.id) || this.entries.get(t.id)?.rev)) {
        this.ops.push({ t: 'rename', id: t.id, name: t.name });
      }
    }
    const common = (l: TreeList, other: Map<string, unknown>) => l.trees.map((t) => t.id).filter((id) => other.has(id));
    if (common(prev, after).join() !== common(next, before).join()) this.ops.push({ t: 'order', ids: next.trees.map((t) => t.id) });
    this.saveOps();
    this.updateState();
    await this.flushOps();
  }

  /** The tree was deleted and its undo window passed. It's already soft-deleted in the account (restorable for 30 days). */
  async remove(treeId: string) {
    this.removed.delete(treeId);
    this.storeEntry(treeId, null);
    this.adapters.delete(treeId);
  }

  private async flushOps() {
    if (this.flushing) return;
    this.flushing = true;
    this.updateState();
    try {
      while (this.ops.length) {
        const op = this.ops[0];
        try {
          if (op.t === 'rename') await api(`/api/trees/${encodeURIComponent(op.id)}`, { method: 'PATCH', body: { name: op.name } });
          else if (op.t === 'order') await api('/api/trees', { method: 'PATCH', body: { order: op.ids } });
          else if (op.t === 'delete') await api(`/api/trees/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
          else await api(`/api/trees/${encodeURIComponent(op.id)}/restore`, { method: 'POST' });
        } catch (e) {
          if (e instanceof OfflineError || (e instanceof ApiError && (e.status === 401 || e.status >= 500 || e.status === 429))) {
            this.fail(e);
            return;
          }
          // 404 / 422 / 400: nothing to do any more (e.g. renaming a tree that was never saved).
        }
        this.ops.shift();
        this.saveOps();
      }
      if (this.failure && !this.hasUnsynced) this.failure = null;
    } finally {
      this.flushing = false;
      this.updateState();
    }
  }

  adapter(treeId: string): StorageAdapter & { subscribe(f: DocListener): () => void; applyRemote(doc: TreeDoc): void } {
    let a = this.adapters.get(treeId) as ReturnType<CloudLibrary['adapter']> | undefined;
    if (!a) {
      a = {
        kind: 'remote',
        load: () => this.load(treeId),
        save: async (doc) => {
          const e = this.entries.get(treeId);
          this.storeEntry(treeId, { doc, rev: e?.rev ?? this.meta.get(treeId)?.rev ?? 0, dirty: true });
          this.updateState();
          void this.push(treeId);
        },
        subscribe: (f) => {
          let s = this.docListeners.get(treeId);
          if (!s) this.docListeners.set(treeId, (s = new Set()));
          s.add(f);
          return () => void s.delete(f);
        },
        /** Put another version in place as a normal change (e.g. "Use that version" after a conflict). */
        applyRemote: (doc) => this.emitDoc(treeId, doc, true),
      };
      this.adapters.set(treeId, a);
    }
    return a;
  }

  private emitDoc(treeId: string, doc: TreeDoc, persist: boolean) {
    const s = this.docListeners.get(treeId);
    if (s?.size) return s.forEach((f) => f(doc, { persist }));
    // Not open right now: drop its in-memory history, so it loads fresh next time.
    forgetSession(treeId);
    if (persist) void this.adapter(treeId).save(doc);
  }

  private async load(treeId: string): Promise<TreeDoc | null> {
    const e = this.entries.get(treeId);
    try {
      const rec = await api<TreeRecord>(`/api/trees/${encodeURIComponent(treeId)}`);
      if (e?.dirty) {
        // Changes made offline in an earlier session: keep them; saving them will sort out the difference.
        void this.push(treeId);
        return e.doc;
      }
      this.storeEntry(treeId, { doc: rec.doc, rev: rec.rev, dirty: false });
      return rec.doc;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        if (e?.dirty && e.rev === 0) return e.doc; // created offline, not on the server yet
        return null;
      }
      if (err instanceof OfflineError && e) {
        this.fail(err);
        return e.doc;
      }
      throw err;
    }
  }

  /** Save a tree to the account. One request per tree at a time; the newest version always goes last. */
  private async push(treeId: string): Promise<void> {
    if (this.inflight.has(treeId)) {
      this.again.add(treeId);
      return;
    }
    this.inflight.add(treeId);
    this.updateState();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        this.again.delete(treeId);
        const e = this.entries.get(treeId);
        if (!e?.dirty) break;
        const sent = e.doc;
        try {
          const name = e.rev === 0 ? (this.list?.trees.find((t) => t.id === treeId)?.name ?? sent.root.title) : undefined;
          const r = await api<TreeMeta>(`/api/trees/${encodeURIComponent(treeId)}`, { method: 'PUT', body: { doc: sent, rev: e.rev, ...(name ? { name: cleanName(name) } : {}) } });
          const now = this.entries.get(treeId);
          if (now) this.storeEntry(treeId, { doc: now.doc, rev: r.rev, dirty: now.doc !== sent });
          this.meta.set(treeId, r);
          if (this.failure && !this.hasUnsynced) this.failure = null;
          if (!this.again.has(treeId) && !this.entries.get(treeId)?.dirty) break;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409 && err.data.current) {
            // Saved on another device in the meantime. Last write wins: save ours on top of theirs,
            // and offer theirs, so the user can switch to it.
            const current = err.data.current as TreeRecord;
            const now = this.entries.get(treeId);
            if (now) this.storeEntry(treeId, { ...now, rev: current.rev });
            const theirs = parseDoc(current.doc);
            if (theirs && JSON.stringify(theirs.root) !== JSON.stringify(sent.root)) {
              const treeName = this.list?.trees.find((t) => t.id === treeId)?.name ?? current.name;
              this.conflictListeners.forEach((f) => f({ treeId, treeName, theirs }));
            }
            continue;
          }
          if (err instanceof ApiError && err.status === 404) {
            // Deleted on another device: nothing to save it to.
            const now = this.entries.get(treeId);
            if (now) this.storeEntry(treeId, { ...now, dirty: false });
            break;
          }
          this.fail(err);
          break;
        }
      }
    } finally {
      this.inflight.delete(treeId);
      this.updateState();
      if (this.again.has(treeId) && this.failure !== 'offline') void this.push(treeId);
    }
  }
}

const sameList = (a: TreeList, b: TreeList) =>
  a.lastOpenedId === b.lastOpenedId && a.trees.length === b.trees.length && a.trees.every((t, i) => t.id === b.trees[i].id && t.name === b.trees[i].name);
