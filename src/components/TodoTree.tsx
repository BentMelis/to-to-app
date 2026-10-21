'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { exportDoc, importDoc, prefs, type StorageAdapter } from '@/lib/storage';
import { track } from '@/lib/analytics';
import * as M from '@/lib/tree/model';
import { applyFilters, matchesFilters, NO_FILTERS, type Filters } from '@/lib/tree/layout';
import { idleItems, lastActivity } from '@/lib/tree/activity';
import { FilterMenu } from './FilterMenu';
import { NotesPanel } from './NotesPanel';
import { branchBounds, isFolded, isStackId, layout, stackId, visibleTree, VGAP, type Box, type VisItem } from '@/lib/tree/layout';
import { TYPES, type ChildType, type TreeDoc, type TreeNode } from '@/lib/tree/types';
import { useTreeStore } from '@/lib/tree/useTreeStore';
import { StackView, TreeNodeView, type EditEnd } from './TreeNodeView';
import { TypePicker, type PickerState } from './TypePicker';
import { Toolbar } from './Toolbar';
import { HelpPanel } from './HelpPanel';
import { MeetingsPanel } from './MeetingsPanel';
import { FlagMenu } from './FlagMenu';
import { DuePicker } from './DuePicker';
import { describeDue, formatDue, todayISO } from '@/lib/tree/dates';
import { canHaveNotes, canSchedule } from '@/lib/tree/types';

const MINK = 0.3;
const MAXK = 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type DropZone = 'before' | 'after' | 'inside';
interface DropTarget {
  id: string;
  zone: DropZone;
}

/** The tree that's open, and how it connects to the tree list around it (see TreesApp). */
export interface TreeProps {
  treeId: string;
  treeName: string;
  adapter: StorageAdapter;
  treeMenuOpen: boolean;
  /** Open the tree switcher, anchored on its toolbar button. */
  onTreeMenu: () => void;
  /** Renaming the top of the tree renames the tree. */
  onRenameTree: (name: string) => void;
}

export default function TodoTree(props: TreeProps) {
  const store = useTreeStore(props.adapter, props.treeId);
  if (!store.doc) return <div className="boot" aria-busy="true" />;
  return <TreeCanvas {...props} store={store} doc={store.doc} />;
}

function TreeCanvas({ store, doc, treeId, treeName, treeMenuOpen, onTreeMenu, onRenameTree }: TreeProps & { store: ReturnType<typeof useTreeStore>; doc: TreeDoc }) {
  const [sel, setSelRaw] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [focusMode, setFocusMode] = useState(true);
  const [openStacks, setOpenStacks] = useState<Set<string>>(() => new Set());
  // Finished items start folded; these are the ones the user opened to look inside.
  const [openDone, setOpenDone] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [duePicker, setDuePicker] = useState<string | null>(null);
  // Deadline colours depend on the date, so re-check it now and then (and when the tab comes back).
  const [today, setToday] = useState(todayISO);
  // Coarse clock (updated every minute) for idle checks.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      setToday(todayISO());
      setClock(Date.now());
    };
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const [toast, setToast] = useState<{ msg: string; undo: boolean; key: number } | null>(null);
  const [panel, setPanel] = useState<'help' | 'meetings' | null>(null);
  // The item whose notes are open in the centred notes dialog.
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [flagMenu, setFlagMenu] = useState<string | null>(null);
  const [manageMeetings, setManageMeetings] = useState(false);
  // Last meeting tab looked at (a viewing preference, remembered per browser).
  const [activeMeeting, setActiveMeetingRaw] = useState<string | null>(() => prefs.get<string>('meeting', treeId));
  const setActiveMeeting = (id: string) => {
    setActiveMeetingRaw(id);
    prefs.set('meeting', treeId, id);
  };
  const help = panel === 'help';
  const [, setTick] = useState(0);

  const idx = useMemo(() => M.buildIndex(doc.root), [doc]);
  const flaggedCount = useMemo(() => M.countFlagged(doc.root), [doc]);
  // Filters are remembered per tree, per browser (a viewing preference, not part of the tree).
  const [filters, setFiltersRaw] = useState<Filters>(() => ({ ...NO_FILTERS, ...prefs.get<Filters>('filters', treeId) }));
  const [filterMenu, setFilterMenu] = useState<DOMRect | null>(null);
  // Idle heads-up: re-evaluated whenever the tree changes, and every minute via `today`/`clock`.
  const idleDays = M.idleDaysOf(doc);
  const idle = useMemo(() => idleItems(doc.root, idx, idleDays, clock), [doc, idx, idleDays, clock]);
  const activity = useMemo(() => lastActivity(doc.root), [doc]);
  /** Items with an idle item somewhere below them (hint on folded branches). */
  const idleAbove = useMemo(() => {
    const out = new Set<string>();
    for (const id of idle.keys()) for (let p = idx.parentOf.get(id); p; p = idx.parentOf.get(p.id) ?? null) out.add(p.id);
    return out;
  }, [idle, idx]);
  const filter = useMemo(() => applyFilters(doc.root, idx, filters, today, idle), [doc, idx, filters, today, idle]);
  const filterCounts = useMemo(() => {
    const c = { high: 0, dueSoon: 0, idle: idle.size };
    for (const n of idx.byId.values()) {
      if (matchesFilters(n, idx, { high: true, dueSoon: false }, today)) c.high++;
      if (matchesFilters(n, idx, { high: false, dueSoon: true }, today)) c.dueSoon++;
    }
    return c;
  }, [idx, today, idle]);
  const vis = useMemo(
    () => visibleTree(doc.root, idx, { hideDone, openStacks, openDone, filter }),
    [doc, idx, hideDone, openStacks, openDone, filter],
  );

  // A selection that disappeared (deleted, hidden, folded away) falls back to its nearest visible ancestor.
  const visIds = useMemo(() => new Set(vis.items.map((i) => i.id)), [vis]);
  let selId = sel;
  if (selId && !visIds.has(selId)) {
    if (isStackId(selId)) selId = idx.byId.has(selId.slice(6)) ? selId.slice(6) : null;
    let p = selId ? idx.byId.get(selId) ?? null : null;
    while (p && !visIds.has(p.id)) {
      const parent: TreeNode | null = idx.parentOf.get(p.id) ?? null;
      // A hidden node inside a stack resolves to the stack itself.
      if (parent && visIds.has(stackId(parent.id))) {
        p = null;
        selId = stackId(parent.id);
        break;
      }
      p = parent;
    }
    if (p) selId = p.id;
  }

  /* ---------- Focus: the project the selection lives in ---------- */
  const focusId = focusMode && selId ? M.focusProjectOf(idx, isStackId(selId) ? selId.slice(6) : selId) : null;
  const isDim = useCallback(
    (it: VisItem) => {
      if (!focusId) return false;
      const id = it.kind === 'stack' ? it.parentId : it.id;
      if (id === focusId || M.isAncestor(idx, focusId, id)) return false;
      return it.kind === 'stack' || !M.isAncestor(idx, id, focusId);
    },
    [focusId, idx],
  );

  /* ---------- DOM refs & camera ---------- */
  const vpRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<SVGSVGElement>(null);
  const dropLineRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const pos = useRef<Record<string, Box>>({});
  const view = useRef({ x: 24, y: 80, k: 1 });
  const visRef = useRef(vis);
  const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  const applyView = useCallback((glide?: boolean) => {
    const vp = vpRef.current, canvas = canvasRef.current;
    if (!vp || !canvas) return;
    const v = view.current;
    if (glide && !reduceMotion()) {
      vp.classList.add('glide');
      if (glideTimer.current) clearTimeout(glideTimer.current);
      glideTimer.current = setTimeout(() => vp.classList.remove('glide'), 380);
    }
    canvas.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
    vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
    vp.style.backgroundSize = `${24 * v.k}px ${24 * v.k}px`;
  }, []);

  const safeArea = useCallback(() => {
    const r = vpRef.current!.getBoundingClientRect();
    const top = (topbarRef.current?.getBoundingClientRect().bottom ?? 60) + 12;
    // On wide screens, keep framed content clear of an open side panel.
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    const w = panel && r.width > 900 ? panel.left - 12 : r.width;
    return { w, h: r.height, top, bottom: r.height - 84 };
  }, []);

  const frame = useCallback(
    (b: { minX: number; minY: number; maxX: number; maxY: number }, maxK: number, glide: boolean) => {
      if (!isFinite(b.minX)) return;
      const a = safeArea();
      const availW = a.w - 48, availH = a.bottom - a.top;
      const W = b.maxX - b.minX, H = b.maxY - b.minY;
      const k = clamp(Math.min(maxK, availW / W, availH / H), MINK, maxK);
      const v = view.current;
      v.k = k;
      v.x = W * k <= availW ? (a.w - W * k) / 2 - b.minX * k : 24 - b.minX * k;
      v.y = H * k <= availH ? a.top + (availH - H * k) / 2 - b.minY * k : a.top - b.minY * k;
      applyView(glide);
    },
    [safeArea, applyView],
  );

  const fit = useCallback(
    (glide = true) => {
      const ids = Object.keys(pos.current);
      if (!ids.length) return;
      frame(branchBounds(visRef.current, pos.current, 'root'), 1, glide);
    },
    [frame],
  );

  const ensureVisible = useCallback(
    (id: string) => {
      const p = pos.current[id];
      if (!p || !vpRef.current) return;
      const a = safeArea(), m = 24, v = view.current;
      const sx = v.x + p.x * v.k, sy = v.y + p.y * v.k, w = (p.w + 44) * v.k, h = p.h * v.k;
      let dx = 0, dy = 0;
      if (sx < m) dx = m - sx;
      else if (sx + w > a.w - m) dx = Math.max(m - sx, a.w - m - (sx + w));
      if (sy < a.top) dy = a.top - sy;
      else if (sy + h > a.bottom) dy = a.bottom - (sy + h);
      if (dx || dy) {
        v.x += dx;
        v.y += dy;
        applyView(true);
      }
    },
    [safeArea, applyView],
  );

  const zoomAt = useCallback(
    (cx: number, cy: number, f: number, glide?: boolean) => {
      const v = view.current;
      const k2 = clamp(v.k * f, MINK, MAXK);
      v.x = cx - (cx - v.x) * (k2 / v.k);
      v.y = cy - (cy - v.y) * (k2 / v.k);
      v.k = k2;
      applyView(glide);
    },
    [applyView],
  );

  /* ---------- Layout: measure, place, draw branches (every render, before paint) ---------- */
  useLayoutEffect(() => {
    visRef.current = vis;
    const size = (id: string) => {
      const el = els.current.get(id);
      return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
    };
    const p = layout(vis, size);
    pos.current = p;
    for (const it of vis.items) {
      const el = els.current.get(it.id);
      if (!el) continue;
      el.style.transform = `translate(${p[it.id].x}px,${p[it.id].y}px)`;
      if (!el.dataset.placed) requestAnimationFrame(() => (el.dataset.placed = '1'));
    }
    let paths = '';
    for (const it of vis.items) {
      const a = p[it.id];
      for (const c of vis.kids.get(it.id) || []) {
        const q = p[c.id];
        const sx = a.x + a.w, sy = a.y + a.h / 2, ex = q.x, ey = q.y + q.h / 2, mx = (sx + ex) / 2;
        let cls = '', w = '1.5';
        if (c.kind === 'stack') cls = 'done';
        else if (c.node.type === 'note') cls = 'to-note';
        else {
          const weight = Math.max(1, idx.stats.get(c.id)!.total);
          w = (1.4 + Math.min(3.6, Math.log2(weight) * 1.1)).toFixed(2);
          if (M.isComplete(idx, c.node)) cls = 'done';
        }
        if (isDim(c)) cls += ' dim';
        paths += `<path class="${cls}" stroke-width="${w}" d="M${sx} ${sy}C${mx} ${sy},${mx} ${ey},${ex} ${ey}"/>`;
      }
    }
    if (linksRef.current) linksRef.current.innerHTML = paths;
  });

  /* ---------- Camera follows selection & focus ---------- */
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (focusId && focusId !== lastFocus.current) {
      frame(branchBounds(vis, pos.current, focusId), 1, true);
    } else if (selId) {
      ensureVisible(selId);
    }
    lastFocus.current = focusId;
    // Only react to selection/focus changes, not every layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, focusId]);

  /** Select something. Finished items that were unstacked go back into their stack once you leave them. */
  const setSel = useCallback(
    (id: string | null) => {
      setSelRaw(id);
      setOpenStacks((prev) => {
        if (!prev.size) return prev;
        if (id && !isStackId(id) && !idx.byId.has(id)) return prev; // just created; not indexed yet
        // Keep stacks along the path to the selection (and the selection's own); restack the rest.
        const target = id && isStackId(id) ? id.slice(6) : id;
        const keep = new Set([...prev].filter((p) => !!target && (p === target || M.isAncestor(idx, p, target))));
        return keep.size === prev.size ? prev : keep;
      });
    },
    [idx],
  );

  // Each tree remembers where you were looking. A tree opened for the first time is fitted on screen.
  useEffect(() => {
    const saved = prefs.get<{ x: number; y: number; k: number }>('view', treeId);
    const restore = () => {
      if (saved && [saved.x, saved.y, saved.k].every(Number.isFinite)) {
        view.current = { x: saved.x, y: saved.y, k: clamp(saved.k, MINK, MAXK) };
        applyView();
      } else fit(false);
    };
    restore();
    vpRef.current?.focus({ preventScroll: true });
    document.fonts?.ready.then(() => {
      setTick((t) => t + 1);
      if (!saved) requestAnimationFrame(() => fit(false));
    });
    const remember = () => {
      const { x, y, k } = view.current;
      prefs.set('view', treeId, { x: Math.round(x), y: Math.round(y), k: Math.round(k * 1000) / 1000 });
    };
    window.addEventListener('pagehide', remember);
    return () => {
      window.removeEventListener('pagehide', remember);
      remember();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilters = (f: Filters) => {
    setFiltersRaw(f);
    prefs.set('filters', treeId, f);
    track('filter_used', { high: !!f.high, due_soon: !!f.dueSoon, idle: !!f.idle });
    requestAnimationFrame(() => fit(true));
  };

  // A side panel opening can cover the selection: re-frame around it.
  useEffect(() => {
    if (!panel || !selId) return;
    const f = focusId;
    requestAnimationFrame(() => {
      if (f) frame(branchBounds(visRef.current, pos.current, f), 1, true);
      else ensureVisible(selId);
    });
    // Only when a panel opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  /* ---------- Toast ---------- */
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, undo = false) => {
    setToast({ msg, undo, key: Date.now() });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3500);
  }, []);

  /* ---------- Actions ---------- */
  const focusCanvas = () => vpRef.current?.focus({ preventScroll: true });

  function apply(r: { doc?: TreeDoc; error?: string } | null, nextSel?: string | null) {
    if (!r) return false;
    if (r.error) {
      showToast(r.error);
      return false;
    }
    if (r.doc) store.commit(r.doc);
    if (nextSel !== undefined) setSel(nextSel);
    return true;
  }

  function addChild(pid: string, type?: ChildType, anchor?: DOMRect) {
    if (!type) return setPicker({ forId: pid, mode: 'add', anchor });
    const r = M.addChild(doc, pid, type);
    if (!r) return;
    store.commit(r.doc);
    setSel(r.id);
    setEditing({ id: r.id, isNew: true });
  }

  function addSibling(id: string, base: TreeDoc = doc) {
    const n = idx.byId.get(id);
    if (!n || n.type === 'root') return setPicker({ forId: 'root', mode: 'add' });
    const r = M.addSibling(base, id);
    if (!r) return;
    store.commit(r.doc);
    setSel(r.id);
    setEditing({ id: r.id, isNew: true });
  }

  const onEditEnd = (id: string, e: EditEnd) => {
    const isNew = editing?.isNew ?? false;
    setEditing(null);
    const n = idx.byId.get(id);
    if (!n) return;
    let base = doc;
    if (id === 'root') {
      if (e.commit && e.value && e.value !== treeName) onRenameTree(e.value);
      return focusCanvas();
    }
    if (e.commit && e.value) {
      if (e.value !== n.title) {
        base = M.rename(doc, id, e.value)!.doc;
        if (isNew) store.replace(base);
        else store.commit(base);
      }
    } else if (isNew) {
      store.revert();
      setSel(idx.parentOf.get(id)?.id ?? 'root');
      focusCanvas();
      return;
    }
    focusCanvas();
    if (e.then === 'next') addSibling(id, base);
    else if (e.then === 'inside' && TYPES[n.type].allows.length) setPicker({ forId: id, mode: 'add' });
  };

  function deleteNode(id: string) {
    if (id === 'root' || isStackId(id)) return;
    const r = M.removeNode(doc, id);
    if (!r) return;
    store.commit(r.doc);
    setSel(r.nextId);
    showToast(`Deleted “${r.title || 'Untitled'}”` + (r.below ? ` and ${r.below} item${r.below === 1 ? '' : 's'} inside it` : ''), true);
  }

  function toggleDone(id: string) {
    const r = M.toggleDone(doc, id);
    if (!r) return;
    store.commit(r.doc);
    setSel(id);
    // Safety net: say so (with undo) when this tick finished a whole branch.
    if (r.done) {
      const after = M.buildIndex(r.doc.root);
      let top: string | null = null;
      for (let p = idx.parentOf.get(id); p && p.type !== 'root'; p = idx.parentOf.get(p.id) ?? null) {
        if (!M.isComplete(idx, p) && M.isComplete(after, after.byId.get(p.id)!)) top = p.title || 'Untitled';
      }
      if (top) showToast(`“${top}” is all done`, true);
    }
  }

  /** Open or close an item's branch. Finished items open in the view only; others fold in the saved tree. */
  function fold(id: string, open?: boolean) {
    const n = idx.byId.get(id);
    if (!n || !n.children.length) return;
    const folded = isFolded(n, idx, { openDone });
    const wantOpen = open ?? folded;
    if (wantOpen === folded) {
      const finished = n.id !== 'root' && M.isComplete(idx, n);
      if (wantOpen) {
        if (finished) setOpenDone((s) => new Set(s).add(id));
        if (n.collapsed) apply(M.toggleFold(doc, id, false));
      } else if (finished && !n.collapsed) {
        setOpenDone((s) => {
          const x = new Set(s);
          x.delete(id);
          return x;
        });
      } else apply(M.toggleFold(doc, id, true));
    }
    setSel(id);
  }

  function openNotes(id: string) {
    const n = idx.byId.get(id);
    if (!n || !canHaveNotes(n.type)) return;
    setSel(id);
    setNotesFor(id);
    track('notes_opened');
  }

  function setFlag(id: string, meetingId: string, kind: 'ask' | 'mention' | null) {
    const r = M.setFlag(doc, id, meetingId, kind);
    if (!r) return;
    store.commit(r.doc);
    setSel(id);
  }

  function openFlagMenu(id: string) {
    const n = idx.byId.get(id);
    if (!n || n.type === 'root') return;
    setSel(id);
    setFlagMenu(id);
  }

  /** Make an item visible (unfold, unstack, unhide) and select it. */
  function reveal(id: string) {
    const n = idx.byId.get(id);
    if (!n) return;
    const r = M.unfoldTo(doc, id);
    if (r) store.commit(r.doc);
    // Open any finished ancestors and the stacks they sit in.
    const stacks: string[] = [];
    const done: string[] = [];
    for (let c: TreeNode | null = n; c && c.type !== 'root'; c = idx.parentOf.get(c.id) ?? null) {
      if (!M.isComplete(idx, c)) continue;
      if (c !== n) done.push(c.id);
      const p = idx.parentOf.get(c.id);
      if (p) stacks.push(p.id);
    }
    if (stacks.length && hideDone) setHideDone(false);
    if (done.length) setOpenDone((s) => new Set([...s, ...done]));
    if (stacks.length) setOpenStacks((s) => new Set([...s, ...stacks]));
    setSel(id);
  }

  function toggleHigh(id: string) {
    const r = M.toggleHigh(doc, id);
    if (!r) return;
    store.commit(r.doc);
    setSel(id);
  }

  function setDue(id: string, due: string | null) {
    setDuePicker(null);
    focusCanvas();
    const r = M.setDue(doc, id, due);
    if (!r) return;
    store.commit(r.doc);
    setSel(id);
    showToast(due ? describeDue(due, today) : 'Deadline removed', true);
  }

  /**
   * Typing in the notes panel: the first change of a session is one undo step, the rest of the
   * session updates it in place. Uses the latest doc, since the panel saves on a timer.
   */
  const notesSession = useRef<string | null>(null);
  function editNotes(id: string, text: string) {
    const cur = latest.current.doc;
    const r = M.setNotes(cur, id, text);
    if (!r) return;
    if (notesSession.current === id) store.replace(r.doc);
    else {
      store.commit(r.doc);
      notesSession.current = id;
    }
  }

  async function copyMeeting(meetingId: string) {
    const m = doc.meetings.find((x) => x.id === meetingId);
    if (!m) return;
    const items = M.collectFlags(doc.root, idx, meetingId);
    try {
      await navigator.clipboard.writeText(M.meetingAsText(m, items));
      showToast(`Copied ${items.length} item${items.length === 1 ? '' : 's'} for ${m.name}`);
    } catch {
      showToast('Couldn’t copy. Your browser blocked the clipboard.');
    }
  }

  const openStack = (parentId: string) => {
    const p = idx.byId.get(parentId);
    setOpenStacks((s) => new Set(s).add(parentId));
    const first = p?.children.find((c) => M.isComplete(idx, c));
    if (first) setSel(first.id);
  };
  const closeStack = (parentId: string) => {
    setOpenStacks((s) => {
      const n = new Set(s);
      n.delete(parentId);
      return n;
    });
    setSel(stackId(parentId));
  };

  function choose(type: ChildType) {
    if (!picker) return;
    const { forId, mode } = picker;
    setPicker(null);
    if (mode === 'add') addChild(forId, type);
    else {
      apply(M.changeType(doc, forId, type));
      focusCanvas();
    }
  }

  /* ---------- Pointer: pan, pinch, wheel zoom, drag & drop ---------- */
  const latest = useRef({ doc, idx, vis, editing, store, showToast, setSel });
  useLayoutEffect(() => {
    latest.current = { doc, idx, vis, editing, store, showToast, setSel };
  });
  const suppressClick = useRef(false);

  useEffect(() => {
    const vp = vpRef.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let panStart: { x: number; y: number; vx: number; vy: number } | null = null;
    let moved = false;
    let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;
    let cand: { id: string; x: number; y: number; pointerId: number; mouse: boolean; armed: boolean } | null = null;
    let longPress: ReturnType<typeof setTimeout> | null = null;
    let drag: { id: string; ghost: HTMLElement; target: DropTarget | null; x: number; y: number; raf: number } | null = null;
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    const clearDropMarks = () => {
      vp.querySelectorAll('.drop-inside').forEach((el) => el.classList.remove('drop-inside'));
      if (dropLineRef.current) dropLineRef.current.hidden = true;
    };

    function hitTest(clientX: number, clientY: number): DropTarget | null {
      const { idx, vis } = latest.current;
      const r = vp.getBoundingClientRect(), v = view.current;
      const cx = (clientX - r.left - v.x) / v.k, cy = (clientY - r.top - v.y) / v.k;
      const dragId = drag!.id;
      for (const it of vis.items) {
        if (it.kind !== 'node' || it.id === dragId || M.isAncestor(idx, dragId, it.id)) continue;
        const p = pos.current[it.id];
        if (!p || cx < p.x - 8 || cx > p.x + p.w + 36 || cy < p.y - VGAP / 2 || cy > p.y + p.h + VGAP / 2) continue;
        const rel = (cy - p.y) / p.h;
        const parent = idx.parentOf.get(it.id);
        const canInside = !M.dropBlockReason(idx, dragId, it.id);
        const canSibling = !!parent && !M.dropBlockReason(idx, dragId, parent.id);
        let zone: DropZone | null = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'inside';
        if (zone === 'inside' && !canInside) zone = canSibling ? (rel < 0.5 ? 'before' : 'after') : null;
        else if (zone !== 'inside' && !canSibling) zone = canInside ? 'inside' : null;
        return zone ? { id: it.id, zone } : null;
      }
      return null;
    }

    function paintTarget(t: DropTarget | null) {
      clearDropMarks();
      vp.classList.toggle('no-drop', !t);
      if (!t) return;
      if (t.zone === 'inside') {
        els.current.get(t.id)?.classList.add('drop-inside');
        return;
      }
      const p = pos.current[t.id], line = dropLineRef.current;
      if (!p || !line) return;
      line.hidden = false;
      line.style.transform = `translate(${p.x}px,${(t.zone === 'before' ? p.y - VGAP / 2 : p.y + p.h + VGAP / 2) - 1.5}px)`;
      line.style.width = `${p.w}px`;
    }

    function beginDrag(x: number, y: number) {
      if (!cand) return;
      const n = latest.current.idx.byId.get(cand.id);
      if (!n) return;
      pts.clear();
      panStart = null;
      pinch = null;
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost ' + n.type;
      ghost.textContent = n.title || 'Untitled';
      document.body.appendChild(ghost);
      drag = { id: cand.id, ghost, target: null, x, y, raf: 0 };
      els.current.get(cand.id)?.classList.add('dragging');
      vp.classList.add('is-dragging');
      cand = null;
      moveDrag(x, y);
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function moveDrag(x: number, y: number) {
      if (!drag) return;
      drag.x = x;
      drag.y = y;
      drag.ghost.style.transform = `translate(${x + 14}px,${y + 10}px)`;
      drag.target = hitTest(x, y);
      paintTarget(drag.target);
    }

    // Nudge the canvas when dragging close to the edge, so you can drop on things off screen.
    function autoScroll() {
      if (!drag) return;
      const r = vp.getBoundingClientRect(), e = 48, sp = 12;
      const dx = drag.x < r.left + e ? sp : drag.x > r.right - e ? -sp : 0;
      const dy = drag.y < r.top + e + 50 ? sp : drag.y > r.bottom - e ? -sp : 0;
      if (dx || dy) {
        view.current.x += dx;
        view.current.y += dy;
        applyView();
        moveDrag(drag.x, drag.y);
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag(drop: boolean) {
      if (!drag) return;
      const { id, target, ghost, raf } = drag;
      cancelAnimationFrame(raf);
      ghost.remove();
      els.current.get(id)?.classList.remove('dragging');
      vp.classList.remove('is-dragging', 'no-drop');
      clearDropMarks();
      drag = null;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (!drop || !target) return;
      const { doc, idx, store, showToast, setSel } = latest.current;
      let parentId: string, beforeId: string | null;
      if (target.zone === 'inside') {
        parentId = target.id;
        beforeId = null;
      } else {
        const parent = idx.parentOf.get(target.id)!;
        parentId = parent.id;
        if (target.zone === 'before') beforeId = target.id;
        else {
          const sibs = parent.children.filter((c) => c.id !== id);
          beforeId = sibs[sibs.findIndex((c) => c.id === target.id) + 1]?.id ?? null;
        }
      }
      const r = M.moveTo(doc, id, parentId, beforeId);
      if (!r) return;
      if (r.error) return showToast(r.error);
      store.commit(r.doc!);
      setSel(id);
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('button,input')) return;
      const nodeEl = t.closest<HTMLElement>('.node');
      const id = nodeEl?.dataset.id;
      if (id && id !== 'root' && !isStackId(id) && !latest.current.editing) {
        cand = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, mouse: e.pointerType === 'mouse', armed: false };
        if (cand.mouse) return;
        longPress = setTimeout(() => {
          if (cand && pts.size <= 1) {
            cand.armed = true;
            navigator.vibrate?.(12);
            beginDrag(cand.x, cand.y);
          }
        }, 380);
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        panStart = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
        moved = false;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: dist(a, b) || 1, k: view.current.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.current.x, vy: view.current.y };
        moved = true;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (drag) {
        e.preventDefault();
        moveDrag(e.clientX, e.clientY);
        return;
      }
      if (cand && cand.pointerId === e.pointerId && Math.hypot(e.clientX - cand.x, e.clientY - cand.y) > 6) {
        if (cand.mouse) {
          beginDrag(e.clientX, e.clientY);
          return;
        }
        if (longPress) clearTimeout(longPress);
        cand = null; // touch moved before the long-press: it's a pan
      }
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = view.current;
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const k = clamp((pinch.k * dist(a, b)) / pinch.d, MINK, MAXK);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        v.x = cx - (pinch.cx - pinch.vx) * (k / pinch.k);
        v.y = cy - (pinch.cy - pinch.vy) * (k / pinch.k);
        v.k = k;
        applyView();
        return;
      }
      if (panStart) {
        const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        vp.classList.add('panning');
        v.x = panStart.vx + dx;
        v.y = panStart.vy + dy;
        applyView();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (longPress) clearTimeout(longPress);
      if (drag) {
        endDrag(e.type === 'pointerup');
        pts.clear();
        return;
      }
      if (cand?.pointerId === e.pointerId) cand = null;
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        panStart = null;
        vp.classList.remove('panning');
        if (moved) {
          suppressClick.current = true;
          setTimeout(() => (suppressClick.current = false), 0);
        }
      } else if (pts.size === 1) {
        const [p] = [...pts.values()];
        panStart = { x: p.x, y: p.y, vx: view.current.x, vy: view.current.y };
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 33 : 1;
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * scale * 0.0025));
      else {
        view.current.x -= e.deltaX * scale;
        view.current.y -= e.deltaY * scale;
        applyView();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (drag && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        endDrag(false);
      }
    };

    vp.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    vp.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, true);
    return () => {
      vp.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      vp.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey, true);
      if (drag) endDrag(false);
    };
  }, [applyView, zoomAt]);

  /* ---------- Clicks on the canvas ---------- */
  const onCanvasClick = (e: React.MouseEvent) => {
    if (suppressClick.current) return;
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>('.node');
    if (!el) {
      if (selId && !editing) setSel(null);
      return;
    }
    const id = el.dataset.id!;
    if (editing?.id === id) return;
    if (isStackId(id)) {
      openStack(id.slice(6));
      return focusCanvas();
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'check') toggleDone(id);
    else if (act === 'fold') fold(id);
    else if (act === 'notes') {
      openNotes(id);
      return;
    } else if (act === 'add') {
      setSel(id);
      setPicker({ forId: id, mode: 'add' });
      return;
    } else if (sel === id && t.closest('.title') && e.detail === 1) {
      // Only an item the user explicitly selected goes into rename on a second click, not one the selection fell back to.
      setEditing({ id, isNew: false });
      return;
    } else setSel(id);
    if (!editing) focusCanvas();
  };

  /* ---------- Keyboard ---------- */
  function navVertical(dir: -1 | 1) {
    const p = selId ? pos.current[selId] : null;
    if (!p) return;
    const same = Object.entries(pos.current)
      .filter(([, q]) => q.d === p.d)
      .sort((a, b) => a[1].y - b[1].y);
    const i = same.findIndex(([id]) => id === selId);
    const nx = same[i + dir];
    if (nx) setSel(nx[0]);
  }
  function navRight() {
    if (!selId) return;
    if (isStackId(selId)) return openStack(selId.slice(6));
    const n = idx.byId.get(selId);
    if (!n || !n.children.length) return;
    if (isFolded(n, idx, { openDone })) return fold(n.id, true);
    const kids = vis.kids.get(selId) || [];
    if (!kids.length) return;
    const p = pos.current[selId], cy = p.y + p.h / 2;
    let best = kids[0], bd = Infinity;
    kids.forEach((k) => {
      const q = pos.current[k.id];
      const d = Math.abs(q.y + q.h / 2 - cy);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    setSel(best.id);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing || picker || duePicker || flagMenu || notesFor) return;
    const t = e.target as HTMLElement;
    if (t.closest?.('input,textarea,[contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key;
    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod) return;
    if (key === 'Escape' && panel) return setPanel(null);
    if (!(t === vpRef.current || t === document.body)) return;
    if (!selId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      e.preventDefault();
      return setSel('root');
    }
    const id = selId;
    // A stack only opens, or is navigated past.
    if (id && isStackId(id)) {
      if (['Enter', ' ', 'ArrowRight', 's', 'S'].includes(key)) {
        e.preventDefault();
        return openStack(id.slice(6));
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'Escape', 'f', 'F', 'w', 'W', '?'].includes(key)) return;
    }
    switch (key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey && id) apply(M.moveSibling(doc, id, -1));
        else navVertical(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (e.altKey && id) apply(M.moveSibling(doc, id, 1));
        else navVertical(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (!id) break;
        if (e.altKey) apply(M.outdent(doc, id));
        else {
          const p = isStackId(id) ? id.slice(6) : idx.parentOf.get(id)?.id;
          if (p) setSel(p);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.altKey && id) apply(M.indent(doc, id));
        else navRight();
        break;
      case 'Tab':
        e.preventDefault();
        setPicker({ forId: id || 'root', mode: 'add' });
        break;
      case 'Enter':
        e.preventDefault();
        if (id) addSibling(id);
        break;
      case 'F2':
      case 'e':
      case 'E':
        if (id) {
          e.preventDefault();
          setEditing({ id, isNew: false });
        }
        break;
      case ' ':
      case 'x':
        e.preventDefault();
        if (id) toggleDone(id);
        break;
      case 'n':
      case 'N': {
        if (id) {
          e.preventDefault();
          openNotes(id);
        }
        break;
      }
      case 'q':
      case 'Q':
        if (id && id !== 'root') {
          e.preventDefault();
          openFlagMenu(id);
        }
        break;
      case 'h':
      case 'H':
        if (id) toggleHigh(id);
        break;
      case 'd':
      case 'D': {
        const n = id ? idx.byId.get(id) : null;
        if (n && canSchedule(n.type)) {
          e.preventDefault();
          setDuePicker(n.id);
        }
        break;
      }
      case 'k':
      case 'K':
        if (id && id !== 'root') {
          e.preventDefault();
          setPicker({ forId: id, mode: 'change' });
        }
        break;
      case 's':
      case 'S': {
        const p = id ? idx.parentOf.get(id) : null;
        if (p && openStacks.has(p.id)) closeStack(p.id);
        break;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (id) deleteNode(id);
        break;
      case 'c':
      case 'C':
        if (id) fold(id);
        break;
      case 'f':
      case 'F':
        fit(true);
        break;
      case '?':
        setPanel((p) => (p === 'help' ? null : 'help'));
        break;
      case 'w':
      case 'W':
        e.preventDefault();
        onTreeMenu();
        break;
      case 'Escape':
        if (selId) setSel(null);
        break;
    }
  };
  const keyRef = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyRef.current = onKeyDown;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  /* ---------- Import ---------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const onImport = async (f: File | undefined) => {
    if (!f) return;
    const d = await importDoc(f);
    if (!d) return showToast('That file isn’t a Todo tree backup');
    store.commit(d);
    setSel(null);
    showToast(`Restored “${f.name}” into ${treeName}`, true);
    track('backup_restored');
    requestAnimationFrame(() => fit(true));
  };

  /* ---------- Render ---------- */
  const selNode = selId && !isStackId(selId) ? idx.byId.get(selId) : null;
  const selParent = selNode ? idx.parentOf.get(selNode.id) : null;
  const rootOpenKids = vis.kids.get('root') || [];
  // The top of the tree always shows the tree's name; renaming it renames the tree.
  const rootNode = doc.root.title === treeName ? doc.root : { ...doc.root, title: treeName };
  // With an empty state on screen the lone root would sit right behind its message, so it's hidden.
  const emptyState = !doc.root.children.length ? 'new' : filter && filter.matches === 0 ? 'filter' : !rootOpenKids.length && !doc.root.collapsed ? 'done' : null;

  return (
    <>
      <div id="vp" ref={vpRef} className={emptyState ? 'is-empty' : undefined} tabIndex={0} role="tree" aria-label="Todo tree" aria-activedescendant={selId ? `n-${selId.replace(':', '-')}` : undefined} onClick={onCanvasClick} onDoubleClick={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('.node');
        const id = el?.dataset.id;
        if (id && !isStackId(id) && !(e.target as HTMLElement).closest('button')) setEditing({ id, isNew: false });
      }}>
        <div id="canvas" ref={canvasRef}>
          <svg id="links" ref={linksRef} aria-hidden="true" />
          <div className="drop-line" ref={dropLineRef} hidden />
          {vis.items.map((it) =>
            it.kind === 'stack' ? (
              <StackView key={it.id} id={it.id} items={it.items} selected={selId === it.id} dim={isDim(it)} meetings={doc.meetings} register={register} />
            ) : (
              <TreeNodeView
                key={it.id}
                node={it.id === 'root' ? rootNode : it.node}
                depth={it.depth}
                idx={idx}
                stats={idx.stats.get(it.id)!}
                selected={selId === it.id}
                dim={isDim(it)}
                context={!!filter && filter.context.has(it.id) && !matchesFilters(it.node, idx, filters, today, idle)}
                idleDays={idle.get(it.id)}
                idleSince={activity.get(it.id)}
                idleInside={idleAbove.has(it.id)}
                editing={editing?.id === it.id ? editing : null}
                meetings={doc.meetings}
                folded={!filter?.context.has(it.id) && isFolded(it.node, idx, { openDone })}
                today={today}
                register={register}
                onEditEnd={onEditEnd}
              />
            ),
          )}
        </div>
      </div>

      <Toolbar
        ref={topbarRef}
        treeName={treeName}
        treeMenuOpen={treeMenuOpen}
        onTreeMenu={onTreeMenu}
        hideDone={hideDone}
        focusMode={focusMode}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        status={store.status}
        helpOpen={help}
        meetingsOpen={panel === 'meetings'}
        flaggedCount={flaggedCount}
        meetingDots={doc.meetings.map((m) => ({ id: m.id, name: m.name, color: m.color, count: M.collectFlags(doc.root, idx, m.id).length })).filter((m) => m.count > 0)}
        onMeetings={() => setPanel((p) => (p === 'meetings' ? null : 'meetings'))}
        onAdd={(anchor) => setPicker({ forId: 'root', mode: 'add', anchor })}
        onHideDone={() => setHideDone((v) => !v)}
        onFocusMode={() => setFocusMode((v) => !v)}
        filters={filters}
        filterMatches={filter?.matches ?? 0}
        filterOpen={!!filterMenu}
        onFilter={(r) => setFilterMenu((m) => (m ? null : r))}
        onUndo={store.undo}
        onRedo={store.redo}
        onFit={() => fit(true)}
        onZoom={(f) => {
          const a = safeArea();
          zoomAt(a.w / 2, (a.top + a.bottom) / 2, f, true);
        }}
        onHelp={() => setPanel((p) => (p === 'help' ? null : 'help'))}
        onExport={() => {
          exportDoc(doc, treeName);
          track('backup_downloaded');
        }}
        onImport={() => fileRef.current?.click()}
      />
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = ''; }} />

      {help && <HelpPanel />}
      {filterMenu && (
        <FilterMenu
          filters={filters}
          counts={filterCounts}
          idleDays={idleDays}
          onIdleDays={(d) => apply(M.setIdleDays(doc, d))}
          anchor={filterMenu}
          onChange={setFilters}
          onClose={(refocus) => {
            setFilterMenu(null);
            if (refocus) focusCanvas();
          }}
        />
      )}
      {notesFor && idx.byId.get(notesFor) && (
        <NotesPanel
          node={idx.byId.get(notesFor)!}
          path={M.pathTo(idx, notesFor)}
          onChange={editNotes}
          onSessionEnd={() => (notesSession.current = null)}
          onClose={() => {
            setNotesFor(null);
            focusCanvas();
          }}
        />
      )}
      {panel === 'meetings' && (
        <MeetingsPanel
          meetings={doc.meetings}
          itemsFor={(mid) => M.collectFlags(doc.root, idx, mid)}
          active={activeMeeting}
          onActive={setActiveMeeting}
          selectedId={selId}
          manage={manageMeetings}
          onManage={setManageMeetings}
          onGo={(id) => {
            reveal(id);
            focusCanvas();
          }}
          onRaised={(id, mid) => {
            const r = M.setFlag(doc, id, mid, null);
            if (!r) return;
            store.commit(r.doc);
            showToast('Done, taken off the list', true);
          }}
          onCopy={copyMeeting}
          onAdd={(name) => {
            const r = M.addMeeting(doc, name);
            if (!r) return;
            store.commit(r.doc);
            setActiveMeeting(r.id);
          }}
          onUpdate={(mid, patch) => apply(M.updateMeeting(doc, mid, patch))}
          onRemove={(mid) => {
            const m = doc.meetings.find((x) => x.id === mid);
            const r = M.removeMeeting(doc, mid);
            if (!r || !m) return;
            store.commit(r.doc);
            showToast(`Removed “${m.name}”`, true);
          }}
          onClose={() => {
            setPanel(null);
            setManageMeetings(false);
            focusCanvas();
          }}
        />
      )}

      {flagMenu && idx.byId.get(flagMenu) && (
        <FlagMenu
          node={idx.byId.get(flagMenu)!}
          meetings={doc.meetings}
          getAnchor={() => els.current.get(flagMenu) ?? null}
          getTop={() => topbarRef.current?.getBoundingClientRect().bottom ?? 60}
          onSet={(mid, kind) => setFlag(flagMenu, mid, kind)}
          onManage={() => {
            setFlagMenu(null);
            setManageMeetings(true);
            setPanel('meetings');
          }}
          onClose={(refocus) => {
            setFlagMenu(null);
            if (refocus) focusCanvas();
          }}
        />
      )}

      {duePicker && idx.byId.get(duePicker) && (
        <DuePicker
          node={idx.byId.get(duePicker)!}
          today={today}
          getAnchor={() => els.current.get(duePicker) ?? null}
          getTop={() => topbarRef.current?.getBoundingClientRect().bottom ?? 60}
          onSet={(due) => setDue(duePicker, due)}
          onClose={(refocus) => {
            setDuePicker(null);
            if (refocus) focusCanvas();
          }}
        />
      )}

      {picker && (
        <TypePicker
          state={picker}
          idx={idx}
          getAnchor={() => (picker.anchor ? null : els.current.get(picker.forId) ?? null)}
          getTop={() => topbarRef.current?.getBoundingClientRect().bottom ?? 60}
          onChoose={choose}
          onClose={(refocus) => {
            setPicker(null);
            if (refocus) focusCanvas();
          }}
        />
      )}

      {selId && !editing && !picker && !duePicker && !flagMenu && !notesFor && (
        <nav className="group actions" aria-label="Selected item">
          {isStackId(selId) ? (
            <button className="tb" onClick={() => openStack(selId.slice(6))}>
              Show done <kbd>Enter</kbd>
            </button>
          ) : selNode ? (
            <>
              {TYPES[selNode.type].allows.length > 0 && (
                <button className="tb" onClick={() => setPicker({ forId: selNode.id, mode: 'add' })}>
                  Add inside <kbd>Tab</kbd>
                </button>
              )}
              {selNode.type !== 'root' && (
                <button className="tb" onClick={() => addSibling(selNode.id)}>
                  Add next <kbd>Enter</kbd>
                </button>
              )}
              {selNode.type === 'todo' && (
                <button className="tb" onClick={() => toggleDone(selNode.id)}>
                  {M.isComplete(idx, selNode) ? 'Not done' : 'Done'} <kbd>Space</kbd>
                </button>
              )}
              {selParent && openStacks.has(selParent.id) && M.isComplete(idx, selNode) && (
                <button className="tb" onClick={() => closeStack(selParent.id)}>
                  Stack done <kbd>S</kbd>
                </button>
              )}
              {canHaveNotes(selNode.type) && (
                <button className="tb" onClick={() => openNotes(selNode.id)}>
                  {selNode.notes ? 'Notes ✎' : 'Notes'} <kbd>N</kbd>
                </button>
              )}
              {canSchedule(selNode.type) && (
                <button className="tb" aria-pressed={!!selNode.high} onClick={() => toggleHigh(selNode.id)}>
                  High priority <kbd>H</kbd>
                </button>
              )}
              {canSchedule(selNode.type) && (
                <button className="tb" onClick={() => setDuePicker(selNode.id)}>
                  {selNode.due ? `Due ${formatDue(selNode.due, today)}` : 'Deadline'} <kbd>D</kbd>
                </button>
              )}
              {selNode.type !== 'root' && (
                <button className={'tb' + (selNode.flags ? ' asked' : '')} onClick={() => openFlagMenu(selNode.id)}>
                  {selNode.flags ? `Bring up (${Object.keys(selNode.flags).length})` : 'Bring up…'} <kbd>Q</kbd>
                </button>
              )}
              {selNode.type !== 'root' && (
                <button className="tb" onClick={() => setPicker({ forId: selNode.id, mode: 'change' })}>
                  Change kind <kbd>K</kbd>
                </button>
              )}
              <button className="tb" onClick={() => setEditing({ id: selNode.id, isNew: false })}>
                Rename <kbd>F2</kbd>
              </button>
              {selNode.type !== 'root' && (
                <button className="tb danger" onClick={() => deleteNode(selNode.id)}>
                  Delete <kbd>Del</kbd>
                </button>
              )}
            </>
          ) : null}
        </nav>
      )}

      {toast && (
        <div className="toast" role="status" key={toast.key}>
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              onClick={() => {
                store.undo();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {emptyState === 'new' ? (
        <div className="empty">
          <h2>{treeName}</h2>
          <p>Nothing here yet. Start with a project, then fill it with todos, notes, or more projects.</p>
          <button className="tb primary" onClick={() => addChild('root', 'project')}>
            Add a project
          </button>
        </div>
      ) : emptyState === 'filter' ? (
        <div className="empty">
          <h2>{treeName}</h2>
          <p>Nothing matches this filter right now.</p>
          <button className="tb primary" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        </div>
      ) : emptyState === 'done' ? (
        <div className="empty">
          <h2>{treeName}</h2>
          <p>Every item is done and hidden.</p>
          <button className="tb primary" onClick={() => setHideDone(false)}>
            Show done items
          </button>
        </div>
      ) : null}
    </>
  );
}
