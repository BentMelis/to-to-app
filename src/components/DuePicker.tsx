'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addDays, DUE_RE, describeDue, nextMonday } from '@/lib/tree/dates';
import type { TreeNode } from '@/lib/tree/types';

interface Props {
  node: TreeNode;
  today: string;
  getAnchor: () => HTMLElement | null;
  getTop: () => number;
  onSet: (due: string | null) => void;
  onClose: (refocus: boolean) => void;
}

/** Small popover to set, change or clear a deadline. */
export function DuePicker({ node, today, getAnchor, getTop, onSet, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(node.due ?? addDays(today, 1));
  const valid = DUE_RE.test(value);

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
    el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
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

  const quick: [string, string][] = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['Next Monday', nextMonday(today)],
    ['In a week', addDays(today, 7)],
  ];

  return (
    <div
      className="picker due-picker"
      ref={ref}
      role="dialog"
      aria-label={`Deadline for ${node.title || 'Untitled'}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose(true);
        } else if (e.key === 'Enter' && valid && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          onSet(value);
        }
      }}
    >
      <div className="picker-head">Deadline for “{node.title || 'Untitled'}”</div>
      <div className="due-quick">
        {quick.map(([label, iso]) => (
          <button key={label} className={'tb' + (node.due === iso ? ' on' : '')} onClick={() => onSet(iso)}>
            {label}
          </button>
        ))}
      </div>
      <label className="due-field">
        <span>Or pick a date</span>
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {valid && <p className="due-preview">{describeDue(value, today)}</p>}
      <div className="due-actions">
        {node.due && (
          <button className="tb danger" onClick={() => onSet(null)}>
            Remove deadline
          </button>
        )}
        <div className="spacer" />
        <button className="tb primary" disabled={!valid} onClick={() => onSet(value)}>
          Set deadline
        </button>
      </div>
    </div>
  );
}
