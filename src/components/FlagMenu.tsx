'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FlagKind, Meeting, TreeNode } from '@/lib/tree/types';
import { IconMention } from './FlagBadge';

interface Props {
  node: TreeNode;
  meetings: Meeting[];
  getAnchor: () => HTMLElement | null;
  getTop: () => number;
  onSet: (meetingId: string, kind: FlagKind | null) => void;
  onManage: () => void;
  onClose: (refocus: boolean) => void;
}

/**
 * "Bring this up at…": per meeting (or person), ask a question or just mention it.
 * Keys: 1–9 pick a row, A = ask, M = mention, Backspace = clear, Esc = close.
 */
export function FlagMenu({ node, meetings, getAnchor, getTop, onSet, onManage, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const name = node.title || 'Untitled';

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
    el.querySelector<HTMLButtonElement>('.flag-opt button')?.focus({ preventScroll: true });
    // Position once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const rowOfFocus = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.flag-opt')?.dataset.meeting;

  return (
    <div
      className="picker flag-menu"
      ref={ref}
      role="dialog"
      aria-label={`Bring up “${name}” at a meeting`}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        const k = e.key.toLowerCase();
        if (e.key === 'Escape') {
          e.preventDefault();
          return onClose(true);
        }
        if (/^[1-9]$/.test(k)) {
          e.preventDefault();
          ref.current?.querySelectorAll<HTMLElement>('.flag-opt')[Number(k) - 1]?.querySelector('button')?.focus();
          return;
        }
        const mid = rowOfFocus();
        if (!mid) return;
        if (k === 'a' || k === 'm') {
          e.preventDefault();
          const kind: FlagKind = k === 'a' ? 'ask' : 'mention';
          onSet(mid, node.flags?.[mid] === kind ? null : kind);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          onSet(mid, null);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const rows = [...(ref.current?.querySelectorAll<HTMLElement>('.flag-opt') ?? [])];
          const i = rows.findIndex((r) => r.dataset.meeting === mid);
          rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.querySelector('button')?.focus();
        }
      }}
    >
      <div className="picker-head">Bring up “{name}” at…</div>
      {meetings.length === 0 && <p className="filter-note">No meetings or people yet.</p>}
      {meetings.map((m, i) => {
        const cur = node.flags?.[m.id];
        return (
          <div key={m.id} className="flag-opt" data-meeting={m.id}>
            <span className={`m-dot m-${m.color}`} aria-hidden="true" />
            <span className="flag-name">
              {m.name}
              {i < 9 && <kbd>{i + 1}</kbd>}
            </span>
            <div className="seg" role="group" aria-label={m.name}>
              <button className={cur === 'ask' ? 'on' : ''} aria-pressed={cur === 'ask'} onClick={() => onSet(m.id, cur === 'ask' ? null : 'ask')} title="Ask a question (A)">
                ? Ask
              </button>
              <button
                className={cur === 'mention' ? 'on' : ''}
                aria-pressed={cur === 'mention'}
                onClick={() => onSet(m.id, cur === 'mention' ? null : 'mention')}
                title="Just mention it, e.g. “this is done” (M)"
              >
                <IconMention /> Mention
              </button>
            </div>
          </div>
        );
      })}
      <div className="due-actions">
        <button className="tb" onClick={onManage}>
          Meetings &amp; people…
        </button>
        <div className="spacer" />
        <button className="tb primary" onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
