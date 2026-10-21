'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planMove, type MovePlan } from '@/lib/tree/moveTree';
import type { TreeEntry } from '@/lib/tree/trees';
import type { TreeDoc, TreeNode } from '@/lib/tree/types';

interface Props {
  node: TreeNode;
  /** The tree the item is in now. */
  doc: TreeDoc;
  /** Every other tree, in the user's order. */
  trees: TreeEntry[];
  loadTree: (id: string) => Promise<TreeDoc | null>;
  getAnchor: () => HTMLElement | null;
  getTop: () => number;
  onMove: (treeId: string) => void;
  onClose: (refocus: boolean) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Move to tree…": pick the tree; if meeting flags would be lost on the way, say which and ask first.
 * Keys: 1–9 pick a tree, ↑↓ move, Enter confirms, Esc goes back / closes.
 */
export function MoveMenu({ node, doc, trees, loadTree, getAnchor, getTop, onMove, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [plans, setPlans] = useState<Record<string, MovePlan | null>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const name = node.title || 'Untitled';

  // Work out per tree what would happen to the meeting flags.
  useEffect(() => {
    let alive = true;
    Promise.all(trees.map(async (t) => [t.id, await loadTree(t.id)] as const)).then((docs) => {
      if (!alive) return;
      const out: Record<string, MovePlan | null> = {};
      for (const [id, d] of docs) out[id] = d ? planMove(doc, node.id, d) : null;
      setPlans(out);
    });
    return () => {
      alive = false;
    };
  }, [trees, loadTree, doc, node.id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = getAnchor()?.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let x = r ? r.right + 40 : (W - pw) / 2;
    let y = r ? r.top + r.height / 2 - ph / 2 : H / 3;
    if (r && x + pw > W - 12) x = Math.max(12, r.left - pw - 12);
    if (W < 520) x = (W - pw) / 2;
    y = Math.min(Math.max(y, getTop() + 6), H - ph - 12);
    el.style.left = `${Math.max(12, x)}px`;
    el.style.top = `${y}px`;
    // Position once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(confirm ? '.move-confirm .primary' : '.move-opt')?.focus({ preventScroll: true });
  }, [confirm]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const choose = (id: string) => {
    const p = plans[id];
    if (p && p.dropped > 0) setConfirm(id);
    else onMove(id);
  };
  const target = confirm ? trees.find((t) => t.id === confirm) : null;
  const plan = confirm ? plans[confirm] : null;

  return (
    <div
      className="picker move-menu"
      ref={ref}
      role="dialog"
      aria-label={`Move “${name}” to another tree`}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          return confirm ? setConfirm(null) : onClose(true);
        }
        if (confirm) return;
        if (/^[1-9]$/.test(e.key) && trees[Number(e.key) - 1]) {
          e.preventDefault();
          return choose(trees[Number(e.key) - 1].id);
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.move-opt') ?? [])];
          const i = rows.indexOf(document.activeElement as HTMLButtonElement);
          rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
        }
      }}
    >
      {!confirm ? (
        <>
          <div className="picker-head">Move “{name}” to…</div>
          {trees.map((t, i) => {
            const p = plans[t.id];
            return (
              <button key={t.id} className="pick move-opt" onClick={() => choose(t.id)}>
                <span className="move-tree-icon" aria-hidden="true" />
                <span>
                  <b>{t.name}</b>
                  <small>
                    {p === undefined
                      ? '…'
                      : p === null
                        ? 'Goes to the top level'
                        : p.dropped
                          ? `${plural(p.dropped, 'meeting flag')} won’t come along`
                          : `Goes to the top level${p.items > 1 ? `, with ${plural(p.items - 1, 'item')} inside` : ''}`}
                  </small>
                </span>
                {i < 9 ? <kbd>{i + 1}</kbd> : <span />}
              </button>
            );
          })}
        </>
      ) : (
        <div className="move-confirm">
          <p>
            <b>{target?.name}</b> has no {plan && plan.droppedMeetings.length === 1 ? 'meeting' : 'meetings'} called{' '}
            {plan?.droppedMeetings.map((m, i) => (
              <span key={m}>
                {i > 0 && (i === plan.droppedMeetings.length - 1 ? ' or ' : ', ')}
                <b>{m}</b>
              </span>
            ))}
            , so {plan && plural(plan.dropped, 'flag')} for {plan && plan.droppedMeetings.length === 1 ? 'it' : 'them'} will be removed.
          </p>
          <div className="due-actions">
            <button className="tb" onClick={() => setConfirm(null)}>
              Back
            </button>
            <div className="spacer" />
            <button className="tb primary" onClick={() => onMove(confirm)}>
              Move anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
