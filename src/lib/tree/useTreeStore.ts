'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageAdapter } from '@/lib/storage';
import { starter } from './model';
import type { TreeDoc } from './types';

const HISTORY = 100;

interface History {
  doc: TreeDoc;
  past: TreeDoc[];
  future: TreeDoc[];
}

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error';

/** Tree document + undo/redo history + persistence through a storage adapter. */
export function useTreeStore(adapter: StorageAdapter) {
  const [h, setH] = useState<History | null>(null);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    adapter.load().then((doc) => {
      if (!alive) return;
      loaded.current = true;
      setH({ doc: doc ?? starter(), past: [], future: [] });
      setStatus('saved');
    });
    return () => {
      alive = false;
    };
  }, [adapter]);

  // Debounced save whenever the document changes.
  const doc = h?.doc;
  useEffect(() => {
    if (!doc || !loaded.current) return;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      adapter.save(doc).then(
        () => setStatus('saved'),
        () => setStatus('error'),
      );
    }, 300);
  }, [doc, adapter]);

  /** Apply a change as a new undo step. */
  const commit = useCallback((next: TreeDoc) => {
    setH((s) => (s ? { doc: next, past: [...s.past.slice(-HISTORY + 1), s.doc], future: [] } : s));
  }, []);
  /** Replace the current doc without a new undo step (e.g. naming an item that was just added). */
  const replace = useCallback((next: TreeDoc) => {
    setH((s) => (s ? { ...s, doc: next } : s));
  }, []);
  /** Throw away the latest step entirely (e.g. a new item that was left empty). */
  const revert = useCallback(() => {
    setH((s) => (s && s.past.length ? { doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: s.future } : s));
  }, []);
  const undo = useCallback(() => {
    setH((s) => (s && s.past.length ? { doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future] } : s));
  }, []);
  const redo = useCallback(() => {
    setH((s) => (s && s.future.length ? { doc: s.future[0], past: [...s.past, s.doc], future: s.future.slice(1) } : s));
  }, []);

  return {
    doc: h?.doc ?? null,
    canUndo: !!h?.past.length,
    canRedo: !!h?.future.length,
    status,
    commit,
    replace,
    revert,
    undo,
    redo,
  };
}
