'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { anyFilter, type Filters } from '@/lib/tree/layout';

interface Props {
  filters: Filters;
  /** How many open items each filter would show on its own. */
  counts: Record<keyof Filters, number>;
  anchor: DOMRect;
  onChange: (f: Filters) => void;
  onClose: (refocus: boolean) => void;
}

const OPTIONS: { key: keyof Filters; label: string; hint: string; mark: React.ReactNode }[] = [
  { key: 'high', label: 'High priority', hint: 'Open items marked high priority', mark: <span className="prio-badge">!</span> },
  { key: 'dueSoon', label: 'Due soon', hint: '3 days or fewer left, or overdue', mark: <span className="due-dot" /> },
];

export function FilterMenu({ filters, counts, anchor, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = window.innerWidth;
    el.style.left = `${Math.max(12, Math.min(anchor.left, W - el.offsetWidth - 12))}px`;
    el.style.top = `${anchor.bottom + 8}px`;
    el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-filter-button]')) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  return (
    <div
      className="picker filter-menu"
      ref={ref}
      role="dialog"
      aria-label="Filter the tree"
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose(true);
        }
      }}
    >
      <div className="picker-head">Show only…</div>
      {OPTIONS.map((o) => (
        <label key={o.key} className="filter-opt">
          <input type="checkbox" checked={filters[o.key]} onChange={(e) => onChange({ ...filters, [o.key]: e.target.checked })} />
          {o.mark}
          <span>
            <b>{o.label}</b>
            <small>{o.hint}</small>
          </span>
          <span className="filter-count">{counts[o.key]}</span>
        </label>
      ))}
      <p className="filter-note">The projects above each match stay visible for context.</p>
      <div className="due-actions">
        <button className="tb" disabled={!anyFilter(filters)} onClick={() => onChange({ high: false, dueSoon: false })}>
          Clear filters
        </button>
        <div className="spacer" />
        <button className="tb primary" onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
