'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { AGAIN_CHOICES, type AutoHide } from '@/lib/tree/sensitive';
import { IconEyeOff } from './icons';

interface Props {
  auto: AutoHide;
  anchor: DOMRect;
  /** Whether the tree has anything marked sensitive (otherwise there's nothing to hide yet). */
  hasSensitive: boolean;
  onChange: (a: AutoHide) => void;
  onClose: (refocus: boolean) => void;
}

/** Settings for hiding sensitive items automatically (KAN-38). */
export function SensitiveMenu({ auto, anchor, hasSensitive, onChange, onClose }: Props) {
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
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-sensitive-button]')) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  return (
    <div
      className="picker filter-menu sensitive-menu"
      ref={ref}
      role="dialog"
      aria-label="Hide sensitive items automatically"
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose(true);
        }
      }}
    >
      <div className="picker-head">Hide sensitive items automatically…</div>
      <label className="filter-opt">
        <input type="checkbox" checked={auto.leave} onChange={(e) => onChange({ ...auto, leave: e.target.checked })} />
        <span />
        <span>
          <b>When I leave TwigList</b>
          <small>Switching to another window, tab or app, e.g. to start sharing in Zoom or Teams</small>
        </span>
      </label>
      <label className="filter-opt">
        <input type="checkbox" checked={auto.start} onChange={(e) => onChange({ ...auto, start: e.target.checked })} />
        <span />
        <span>
          <b>When TwigList opens</b>
          <small>Every visit starts with them hidden</small>
        </span>
      </label>
      <label className="idle-setting">
        <IconEyeOff />
        <span>Hide again after showing them</span>
        <select value={auto.again} onChange={(e) => onChange({ ...auto, again: Number(e.target.value) })}>
          {(AGAIN_CHOICES as readonly number[]).includes(auto.again) || !auto.again ? null : <option value={auto.again}>{auto.again} min</option>}
          {AGAIN_CHOICES.map((m) => (
            <option key={m} value={m}>{m} min</option>
          ))}
          <option value={0}>Never</option>
        </select>
      </label>
      <p className="filter-note">
        {hasSensitive
          ? 'Your browser can’t tell when your screen is being shared, so TwigList hides them at the moments sharing usually starts. Shift+H shows them again.'
          : 'Nothing in this tree is marked sensitive yet. Select an item and press L.'}
      </p>
      <div className="due-actions">
        <div className="spacer" />
        <button className="tb primary" onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
