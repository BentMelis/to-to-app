'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageAdapter } from '@/lib/storage';
import { starter } from './model';
import { stampChanges } from './activity';
import type { TreeDoc } from './types';

const HISTORY = 100;

interface History {
  doc: TreeDoc;
  past: TreeDoc[];
  future: TreeDoc[];
}

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error';

/**
 * Undo/redo history per tree for this session, so switching to another tree and back keeps it.
 * Never shared between trees: undo only ever changes the tree you're looking at.
 */
const sessions = new Map<string, History>();
export const forgetSession = (key: string) => sessions.delete(key);
/** Signing in or out: tree ids can repeat between the browser and an account, so start clean. */
export const forgetAllSessions = () => sessions.clear();

/** Tree document + undo/redo history + persistence through a storage adapter. */
export function useTreeStore(adapter: StorageAdapter, key = 'default') {
  const [h, setH] = useState<History | null>(() => sessions.get(key) ?? null);
  const [status, setStatus] = useState<SaveStatus>(() => (sessions.has(key) ? 'saved' : 'loading'));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(sessions.has(key));
  /** The last version saved (or loaded as-is): changes are compared against it, so nothing is saved twice. */
  const savedDoc = useRef<TreeDoc | null>(sessions.get(key)?.doc ?? null);

  useEffect(() => {
    if (loaded.current) return;
    let alive = true;
    adapter.load().then(
      (doc) => {
        if (!alive) return;
        loaded.current = true;
        const d = doc ?? starter();
        // A tree from the account is already stored in the current format: opening it must not save it again
        // (that would make a new version on every open, and false "changed on another device" conflicts).
        // A tree in this browser is saved once on open, so an older format gets upgraded in storage.
        if (doc && adapter.kind === 'remote') savedDoc.current = d;
        setH({ doc: d, past: [], future: [] });
        setStatus('saved');
      },
      () => alive && setStatus('error'),
    );
    return () => {
      alive = false;
    };
  }, [adapter]);

  // Keep this tree's history for when the user comes back to it.
  useEffect(() => {
    if (h) sessions.set(key, h);
  }, [h, key]);

  // Debounced save whenever the document changes.
  const doc = h?.doc;
  useEffect(() => {
    if (!doc || !loaded.current || doc === savedDoc.current) return;
    savedDoc.current = doc;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      adapter.save(doc).then(
        () => setStatus('saved'),
        () => setStatus('error'),
      );
    }, 300);
  }, [doc, adapter]);

  // Another version from the account (another device, or "Use that version"): a new undo step, so undo brings
  // back what was on screen. Synced versions aren't saved back (the account already has them).
  useEffect(() => {
    if (!adapter.subscribe) return;
    return adapter.subscribe((remote, { persist }) => {
      if (!loaded.current) return;
      if (!persist) savedDoc.current = remote;
      setH((s) => (s ? { doc: remote, past: [...s.past.slice(-HISTORY + 1), s.doc], future: [] } : s));
    });
  }, [adapter]);

  /** Apply a change as a new undo step. */
  // Every change stamps the items it touched, which drives the idle heads-up (see activity.ts).
  // `quiet`: not activity (e.g. archiving, KAN-28), so nothing is stamped.
  const commit = useCallback((next: TreeDoc, opts?: { quiet?: boolean }) => {
    setH((s) => (s ? { doc: opts?.quiet ? next : stampChanges(s.doc, next), past: [...s.past.slice(-HISTORY + 1), s.doc], future: [] } : s));
  }, []);
  /** Replace the current doc without a new undo step (e.g. naming an item that was just added). */
  const replace = useCallback((next: TreeDoc, opts?: { quiet?: boolean }) => {
    setH((s) => (s ? { ...s, doc: opts?.quiet ? next : stampChanges(s.doc, next) } : s));
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
