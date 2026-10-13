'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { countDesc, isComplete, type TreeIndex } from '@/lib/tree/model';
import { TYPES, type TreeNode } from '@/lib/tree/types';
import type { Stats } from '@/lib/tree/types';
import { IconCheck, IconPlus } from './icons';

const PLACEHOLDER: Record<string, string> = { project: 'Name this project', todo: 'What needs doing?', note: 'Write a note' };

export type EditEnd = { commit: boolean; value: string; then?: 'next' | 'inside' };

interface Props {
  node: TreeNode;
  depth: number;
  idx: TreeIndex;
  stats: Stats;
  selected: boolean;
  dim: boolean;
  editing: { isNew: boolean } | null;
  register: (id: string, el: HTMLElement | null) => void;
  onEditEnd: (id: string, e: EditEnd) => void;
}

function TreeNodeViewInner({ node: n, depth, idx, stats: s, selected, dim, editing, register, onEditEnd }: Props) {
  const type = n.type;
  const isRoot = type === 'root';
  const hasKids = n.children.length > 0;
  const comp = isComplete(idx, n);
  const parent = idx.parentOf.get(n.id);
  const name = n.title || 'Untitled';
  const mixed = type === 'todo' && hasKids && !comp && s.done > 0;
  const showMeta = isRoot ? hasKids : type === 'project' || (type === 'todo' && s.total > 1);
  const pct = s.total ? Math.round((100 * s.done) / s.total) : 0;

  const cls = [
    'node',
    type,
    hasKids && 'has-kids',
    type === 'project' && parent?.type === 'project' && 'nested',
    comp && 'complete',
    comp && !isRoot && 'finished',
    selected && 'selected',
    dim && 'dim',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={(el) => register(n.id, el)}
      className={cls}
      data-id={n.id}
      id={`n-${n.id}`}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-label={(isRoot ? '' : TYPES[type].label + ': ') + name}
      aria-expanded={hasKids ? !n.collapsed : undefined}
    >
      {type === 'todo' && (
        <button
          className={'check' + (mixed ? ' mixed' : '')}
          tabIndex={-1}
          role="checkbox"
          aria-checked={comp ? true : mixed ? 'mixed' : false}
          aria-label={(comp ? 'Mark not done: ' : 'Mark done: ') + name}
          data-act="check"
        >
          <IconCheck />
        </button>
      )}
      {type === 'project' && <span className="ring" aria-hidden="true" style={{ ['--p' as string]: pct }} />}
      <div className="body">
        {editing ? (
          <TitleInput node={n} isNew={editing.isNew} onEnd={(e) => onEditEnd(n.id, e)} />
        ) : (
          <span className="title" data-ph="Untitled">
            {n.title}
          </span>
        )}
        {showMeta && (
          <div className="meta">
            <span className="count">
              {s.total === 0 ? (hasKids ? 'No todos yet' : 'Empty') : isRoot ? `${s.done} of ${s.total} done` : `${s.done}/${s.total}`}
            </span>
            {s.total > 0 && (
              <span className="bar">
                <i style={{ width: `${pct}%` }} />
              </span>
            )}
          </div>
        )}
      </div>
      <div className="handles">
        {hasKids && (
          <button className="fold" tabIndex={-1} data-act="fold" aria-label={(n.collapsed ? 'Expand ' : 'Collapse ') + name}>
            {n.collapsed ? '+' + countDesc(n) : '−'}
          </button>
        )}
        {TYPES[type].allows.length > 0 && (
          <button className="add" tabIndex={-1} data-act="add" aria-label={'Add inside ' + name}>
            <IconPlus />
          </button>
        )}
      </div>
    </div>
  );
}

function TitleInput({ node, isNew, onEnd }: { node: TreeNode; isNew: boolean; onEnd: (e: EditEnd) => void }) {
  const [value, setValue] = useState(node.title);
  const ref = useRef<HTMLInputElement>(null);
  const ended = useRef(false);
  const end = (e: Omit<EditEnd, 'value'>) => {
    if (ended.current) return;
    ended.current = true;
    onEnd({ ...e, value: value.replace(/\s+/g, ' ').trim() });
  };
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="title-input"
      value={value}
      size={Math.max(10, value.length + 1)}
      placeholder={isNew ? PLACEHOLDER[node.type] || 'Type a name' : 'Untitled'}
      aria-label={`Name of ${TYPES[node.type].label.toLowerCase()}`}
      spellCheck
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          end({ commit: true, then: isNew ? 'next' : undefined });
        } else if (e.key === 'Tab') {
          e.preventDefault();
          end({ commit: true, then: 'inside' });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          end({ commit: isNew ? !!value.trim() : false });
        }
      }}
      onBlur={() => end({ commit: true })}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

export const TreeNodeView = memo(TreeNodeViewInner);

/** Finished siblings shown as a single card with others peeking out behind it. */
export const StackView = memo(function StackView({
  id,
  items,
  selected,
  dim,
  register,
}: {
  id: string;
  items: TreeNode[];
  selected: boolean;
  dim: boolean;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  const top = items[0];
  const label = `${items.length} done`;
  return (
    <div
      ref={(el) => register(id, el)}
      className={'node stack' + (selected ? ' selected' : '') + (dim ? ' dim' : '')}
      data-id={id}
      id={`n-${id.replace(':', '-')}`}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={false}
      aria-label={`${label}: ${items.map((i) => i.title || 'Untitled').join(', ')}. Press Enter to show them.`}
      title="Show finished items"
    >
      <span className="stack-layer l2" aria-hidden="true" />
      <span className="stack-layer l1" aria-hidden="true" />
      <span className="check stack-check" aria-hidden="true">
        <IconCheck />
      </span>
      <div className="body">
        <span className="title">{top.title || 'Untitled'}</span>
        <div className="meta">
          <span className="count">
            +{items.length - 1} more done
          </span>
        </div>
      </div>
      <div className="handles">
        <span className="stack-badge">{items.length}</span>
      </div>
    </div>
  );
});
