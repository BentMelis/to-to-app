'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { allows, blockReason, type TreeIndex } from '@/lib/tree/model';
import { TYPE_KEYS, type ChildType } from '@/lib/tree/types';

export interface PickerState {
  forId: string;
  mode: 'add' | 'change';
  anchor?: DOMRect;
}

const OPTIONS: { type: ChildType; label: string; hint: string; key: string }[] = [
  { type: 'project', label: 'Project', hint: 'A branch that can hold anything, even more projects', key: 'P' },
  { type: 'todo', label: 'Todo', hint: 'Something to tick off', key: 'T' },
  { type: 'note', label: 'Note', hint: 'Info to keep here, no checkbox', key: 'N' },
];

interface Props {
  state: PickerState;
  idx: TreeIndex;
  getAnchor: () => HTMLElement | null;
  getTop: () => number;
  onChoose: (t: ChildType) => void;
  onClose: (refocus: boolean) => void;
}

export function TypePicker({ state, idx, getAnchor, getTop, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const n = idx.byId.get(state.forId);
  const name = !n ? '' : n.id === 'root' ? 'the top level' : `“${n.title || 'Untitled'}”`;

  const opts = OPTIONS.map((o) => {
    if (!n) return { ...o, hidden: true, disabled: true, current: false, why: '' };
    if (state.mode === 'add') return { ...o, hidden: !allows(n, o.type), disabled: false, current: false, why: '' };
    const current = n.type === o.type;
    const why = current ? '' : blockReason(idx, n, o.type) || '';
    return { ...o, hidden: false, disabled: current || !!why, current, why };
  });

  // Place it next to the item (or the button that opened it), kept on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = state.anchor ?? getAnchor()?.getBoundingClientRect();
    const topOffset = getTop();
    const pw = el.offsetWidth, ph = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let x = r ? (state.anchor ? r.left : r.right + 40) : (W - pw) / 2;
    let y = r ? (state.anchor ? r.bottom + 8 : r.top + r.height / 2 - ph / 2) : H / 3;
    if (r && x + pw > W - 12) x = Math.max(12, r.left - pw - 12);
    if (x < 12) x = 12;
    if (W < 520) x = (W - pw) / 2;
    y = Math.min(Math.max(y, topOffset + 6), H - ph - 12);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.querySelector<HTMLButtonElement>('.pick:not(:disabled)')?.focus({ preventScroll: true });
    // Position once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  return (
    <div
      className="picker"
      ref={ref}
      role="menu"
      aria-label={state.mode === 'add' ? `Add inside ${name}` : `Change ${name} to`}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        const t = TYPE_KEYS[e.key.toLowerCase()];
        const o = t && opts.find((x) => x.type === t);
        if (o && !o.hidden && !o.disabled) {
          e.preventDefault();
          return onChoose(t);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          return onClose(true);
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
          e.preventDefault();
          const list = [...ref.current!.querySelectorAll<HTMLButtonElement>('.pick:not(:disabled)')];
          const i = list.indexOf(document.activeElement as HTMLButtonElement);
          const dir = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
          list[(i + dir + list.length) % list.length]?.focus();
        }
      }}
    >
      <div className="picker-head">{state.mode === 'add' ? `Add inside ${name}` : `Change ${name} to`}</div>
      {opts
        .filter((o) => !o.hidden)
        .map((o) => (
          <button
            key={o.type}
            className={'pick' + (o.current ? ' current' : '')}
            role="menuitem"
            disabled={o.disabled}
            title={o.why || undefined}
            onClick={() => onChoose(o.type)}
          >
            <span className={`pi pi-${o.type}`} />
            <span>
              <b>{o.label}</b>
              <small>{o.why || o.hint}</small>
            </span>
            <kbd>{o.key}</kbd>
          </button>
        ))}
    </div>
  );
}
