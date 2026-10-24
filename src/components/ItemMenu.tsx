'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

export type MenuEntry =
  | {
      /** Stable name for analytics (never user content). */
      key: string;
      label: string;
      run: () => void;
      kbd?: React.ReactNode;
      danger?: boolean;
      /** For on/off actions (high priority, sensitive): shows a tick. */
      checked?: boolean;
    }
  | 'sep';

interface Props {
  /** Shown for screen readers: what the menu is for. */
  label: string;
  entries: MenuEntry[];
  /** Right-click: at the pointer. "⋯" button / keyboard: under this box. */
  at: { x: number; y: number } | DOMRect;
  onClose: (refocus: boolean) => void;
}

const isRect = (a: Props['at']): a is DOMRect => 'width' in a;

/** A context menu for one tree item (KAN-45): grouped actions with their shortcuts, keyboard-navigable. */
export function ItemMenu({ label, entries, at, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Place it at the pointer (or under the button) and flip it back inside the viewport near the edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = window.innerWidth, H = window.innerHeight, m = 8;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x: number, y: number;
    if (isRect(at)) {
      x = at.left;
      y = at.bottom + 6;
      if (y + h > H - m) y = at.top - h - 6;
    } else {
      x = at.x;
      y = at.y;
      if (y + h > H - m) y = at.y - h;
      if (x + w > W - m) x = at.x - w;
    }
    el.style.left = `${Math.max(m, Math.min(x, W - w - m))}px`;
    el.style.top = `${Math.max(m, Math.min(y, H - h - m))}px`;
    el.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // Its own "⋯" button toggles it (handled by the click), so don't close-then-reopen here.
      if (t.closest?.('[data-act="menu"][aria-expanded="true"]')) return;
      if (ref.current && !ref.current.contains(t)) onClose(false);
    };
    const gone = () => onClose(false);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', gone);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', gone);
      window.removeEventListener('resize', gone);
    };
  }, [onClose]);

  const move = (dir: 1 | -1 | 'first' | 'last') => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = dir === 'first' ? 0 : dir === 'last' ? items.length - 1 : (i + dir + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      ref={ref}
      className="item-menu"
      role="menu"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          onClose(true);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          move('first');
        } else if (e.key === 'End') {
          e.preventDefault();
          move('last');
        }
      }}
    >
      {entries.map((it, i) =>
        it === 'sep' ? (
          <div key={`sep-${i}`} className="item-menu-sep" role="separator" />
        ) : (
          <button
            key={it.key}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            className={'item-menu-item' + (it.danger ? ' danger' : '')}
            onClick={() => {
              // Back to the tree first; actions that open a picker or the editor take focus from there.
              onClose(true);
              it.run();
            }}
          >
            <span className="item-menu-check" aria-hidden="true">
              {it.checked ? '✓' : ''}
            </span>
            <span className="item-menu-label">{it.label}</span>
            {it.kbd && <span className="item-menu-kbd">{it.kbd}</span>}
          </button>
        ),
      )}
    </div>
  );
}
