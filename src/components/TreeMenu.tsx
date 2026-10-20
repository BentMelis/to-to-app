'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_TREES, pluralItems, type TreeList } from '@/lib/tree/trees';
import { IconArrowDown, IconArrowUp, IconCheck, IconPlus } from './icons';

interface Props {
  list: TreeList;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  /** How many items a tree holds, for the delete confirmation. */
  countFor: (id: string) => Promise<number>;
  onClose: (refocus: boolean) => void;
}

/**
 * The tree switcher: pick a tree (1–9), start a new one, or manage them (rename, reorder, delete).
 */
export function TreeMenu({ list, onOpen, onCreate, onRename, onMove, onDelete, countFor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [manage, setManage] = useState(false);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; count: number | null } | null>(null);
  const full = list.trees.length >= MAX_TREES;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = document.querySelector('[data-tree-button]')?.getBoundingClientRect();
    const W = window.innerWidth;
    el.style.left = `${Math.max(12, Math.min(r?.left ?? 12, W - el.offsetWidth - 12))}px`;
    el.style.top = `${(r?.bottom ?? 56) + 8}px`;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = manage
      ? el.querySelector<HTMLElement>('.tree-row input')
      : el.querySelector<HTMLElement>('.tree-pick.current') ?? el.querySelector<HTMLElement>('.tree-pick');
    target?.focus({ preventScroll: true });
  }, [manage]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-tree-button]')) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const askDelete = (id: string) => {
    setConfirm({ id, count: null });
    countFor(id).then((count) => setConfirm((c) => (c?.id === id ? { id, count } : c)));
  };
  const confirming = confirm ? list.trees.find((t) => t.id === confirm.id) : null;

  return (
    <div
      className="picker tree-menu"
      ref={ref}
      role="dialog"
      aria-label="Trees"
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          if (confirm) return setConfirm(null);
          return onClose(true);
        }
        const inField = (e.target as HTMLElement).closest('input');
        if (!manage && !inField && /^[1-9]$/.test(e.key)) {
          const t = list.trees[Number(e.key) - 1];
          if (t) {
            e.preventDefault();
            onOpen(t.id);
          }
          return;
        }
        if (!manage && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault();
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('.tree-pick, .tree-new input') ?? [])];
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
    >
      <div className="picker-head">{manage ? 'Manage trees' : 'Trees'}</div>

      {!manage ? (
        <>
          {list.trees.map((t, i) => {
            const current = t.id === list.lastOpenedId;
            return (
              <button key={t.id} className={'pick tree-pick' + (current ? ' current' : '')} aria-current={current || undefined} onClick={() => onOpen(t.id)}>
                <span className="tree-check">{current && <IconCheck />}</span>
                <b>{t.name}</b>
                {i < 9 ? <kbd>{i + 1}</kbd> : <span />}
              </button>
            );
          })}
          {full ? (
            <p className="filter-note">That’s the maximum of {MAX_TREES} trees.</p>
          ) : (
            <form
              className="tree-new"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) onCreate(name);
              }}
            >
              <IconPlus w={2} />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tree, e.g. Personal" aria-label="Name of a new tree" maxLength={40} />
              <button className="tb primary" disabled={!name.trim()}>
                Create
              </button>
            </form>
          )}
          <div className="due-actions">
            <button className="tb" onClick={() => setManage(true)}>
              Rename, reorder, delete…
            </button>
          </div>
        </>
      ) : confirming && confirm ? (
        <div className="tree-confirm" role="alertdialog" aria-label={`Delete ${confirming.name}?`}>
          <p>
            Delete <b>{confirming.name}</b>
            {confirm.count === null ? '…' : confirm.count ? <> and its {pluralItems(confirm.count)}?</> : ' (it’s empty)?'}
          </p>
          <p className="filter-note">Its meetings, notes and settings go with it. You can undo this for a few seconds.</p>
          <div className="due-actions">
            <button className="tb" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <div className="spacer" />
            <button
              className="tb danger-solid"
              autoFocus
              onClick={() => {
                onDelete(confirming.id);
                setConfirm(null);
              }}
            >
              Delete tree
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="tree-rows">
            {list.trees.map((t, i) => (
              <li key={t.id} className="tree-row">
                <input
                  defaultValue={t.name}
                  aria-label={`Name of tree ${i + 1}`}
                  maxLength={40}
                  onBlur={(e) => {
                    if (e.target.value.trim()) onRename(t.id, e.target.value);
                    else e.target.value = t.name;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <button className="tb icon" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => onMove(t.id, -1)}>
                  <IconArrowUp />
                </button>
                <button className="tb icon" aria-label={`Move ${t.name} down`} disabled={i === list.trees.length - 1} onClick={() => onMove(t.id, 1)}>
                  <IconArrowDown />
                </button>
                <button
                  className="tb danger icon"
                  aria-label={`Delete ${t.name}`}
                  title={list.trees.length <= 1 ? 'You need at least one tree' : 'Delete this tree'}
                  disabled={list.trees.length <= 1}
                  onClick={() => askDelete(t.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="due-actions">
            <button className="tb" onClick={() => setManage(false)}>
              Back
            </button>
            <div className="spacer" />
            <button className="tb primary" onClick={() => onClose(true)}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
