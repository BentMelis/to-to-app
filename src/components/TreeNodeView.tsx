'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { countDesc, isComplete, isDone, worstDueBelow, type TreeIndex } from '@/lib/tree/model';
import { daysUntil, describeDue, dueLevel, formatDue } from '@/lib/tree/dates';
import { TYPES, canHaveNotes, type TreeNode } from '@/lib/tree/types';
import type { Stats } from '@/lib/tree/types';
import type { Meeting } from '@/lib/tree/types';
import { FlagBadge, flagLabel } from './FlagBadge';
import { IconCalendar, IconCheck, IconIdle, IconLock, IconNotes, IconPlus } from './icons';
import { describeIdle } from '@/lib/tree/activity';

/** The first meeting (in the user's order) that something inside `nodes` is flagged for, if any. */
function firstFlagged(nodes: TreeNode[], meetings: Meeting[], deep: boolean, skip?: ReadonlySet<string>): Meeting | null {
  const ids = new Set<string>();
  const walk = (n: TreeNode) => {
    if (skip?.has(n.id)) return;
    Object.keys(n.flags ?? {}).forEach((k) => ids.add(k));
    if (deep) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return meetings.find((m) => ids.has(m.id)) ?? null;
}

const PLACEHOLDER: Record<string, string> = { project: 'Name this project', todo: 'What needs doing?', note: 'Write a note' };

export type EditEnd = { commit: boolean; value: string; then?: 'next' | 'inside' };

interface Props {
  node: TreeNode;
  depth: number;
  idx: TreeIndex;
  stats: Stats;
  selected: boolean;
  dim: boolean;
  /** Shown only as the path to a filter match. */
  context?: boolean;
  editing: { isNew: boolean } | null;
  /** Children hidden: folded by the user, or finished and not opened. */
  folded: boolean;
  /** Days without activity, when this is the topmost idle item of its branch. */
  idleDays?: number;
  /** Latest activity in this item's branch (ms). */
  idleSince?: number;
  /** Something below this item is idle (shown as a hint while folded). */
  idleInside?: boolean;
  /** Sensitive and hidden: render a locked placeholder, nothing of the content. */
  sealed?: boolean;
  /** All hidden sensitive items, so hints on folded branches don't give them away. */
  sealedSet?: ReadonlySet<string>;
  /** The user's meetings & people, in their order (for flag badges). */
  meetings: Meeting[];
  /** Today's date (YYYY-MM-DD); passed in so deadline colours update when the day changes. */
  today: string;
  register: (id: string, el: HTMLElement | null) => void;
  onEditEnd: (id: string, e: EditEnd) => void;
}

function TreeNodeViewInner(props: Props) {
  if (props.sealed) return <SealedNode {...props} />;
  return <OpenNode {...props} />;
}

/** A hidden sensitive item: same place in the tree, none of its content (not even in the DOM). */
function SealedNode({ node: n, depth, selected, dim, register }: Props) {
  const cls = ['node', n.type, 'sealed', selected && 'selected', dim && 'dim'].filter(Boolean).join(' ');
  return (
    <div
      ref={(el) => register(n.id, el)}
      className={cls}
      data-id={n.id}
      id={`n-${n.id}`}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-label="Sensitive item, hidden"
      title="Sensitive · Shift+H to show"
    >
      <span className="sealed-lock" aria-hidden="true">
        <IconLock />
      </span>
      <div className="body">
        <span className="title sealed-bar" aria-hidden="true" />
      </div>
    </div>
  );
}

function OpenNode({ node: n, depth, idx, stats: s, selected, dim, context, editing, folded, meetings, today, idleDays, idleSince, idleInside, sealedSet, register, onEditEnd }: Props) {
  const type = n.type;
  const isRoot = type === 'root';
  const hasKids = n.children.length > 0;
  const comp = isComplete(idx, n);
  const parent = idx.parentOf.get(n.id);
  const name = n.title || 'Untitled';
  const mixed = type === 'todo' && hasKids && !comp && s.done > 0;
  const showProgress = isRoot ? hasKids : type === 'project' || (type === 'todo' && s.total > 1);
  const showMeta = showProgress || !!n.due || idleDays !== undefined;
  const due = n.due ? { label: formatDue(n.due, today), level: comp ? 'done' : dueLevel(daysUntil(n.due, today)), text: describeDue(n.due, today) } : null;
  const hiddenDue = folded ? worstDueBelow(n, idx, today, sealedSet) : null;
  const hiddenFlag = folded ? firstFlagged(n.children, meetings, true, sealedSet) : null;
  const hiddenAsk = !!hiddenFlag;
  const flags = meetings.filter((m) => n.flags?.[m.id]).map((m) => ({ m, kind: n.flags![m.id] }));
  const pct = s.total ? Math.round((100 * s.done) / s.total) : 0;

  const cls = [
    'node',
    type,
    hasKids && 'has-kids',
    type === 'project' && parent?.type === 'project' && 'nested',
    comp && 'complete',
    // Only done todos step back; a complete project keeps its normal look (KAN-34).
    isDone(idx, n) && 'finished',
    selected && 'selected',
    dim && 'dim',
    context && 'context',
    flags.length > 0 && 'asking',
    n.high && 'high',
    idleDays !== undefined && 'idle',
    n.notes && canHaveNotes(type) && 'has-notes',
    n.sensitive && 'sensitive',
    due && !comp && `due-${due.level}`,
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
      aria-label={
        (isRoot ? '' : TYPES[type].label + ': ') +
        name +
        (n.sensitive ? ', sensitive' : '') +
        (n.high ? ', high priority' : '') +
        (due ? ', ' + due.text : '') +
        (idleDays !== undefined ? `, idle for ${idleDays} days` : '') +
        flags.map((f) => ', ' + flagLabel(f.kind, f.m).toLowerCase()).join('')
      }
      aria-expanded={hasKids ? !folded : undefined}
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
      {n.sensitive && (
        <span className="sensitive-badge" title="Sensitive: hidden when you press Shift+H" aria-hidden="true">
          <IconLock />
        </span>
      )}
      {n.high && (
        <span className="prio-badge" title="High priority" aria-hidden="true">
          !
        </span>
      )}
      {flags.length > 0 && (
        <span className="flag-badges">
          {flags.map((f) => (
            <FlagBadge key={f.m.id} kind={f.kind} meeting={f.m} />
          ))}
        </span>
      )}
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
            {idleDays !== undefined && (
              <span className="idle-chip" title={idleSince ? describeIdle(idleDays, idleSince) : undefined}>
                <IconIdle />
                {idleDays}d idle
              </span>
            )}
            {due && (
              <span className={`due-chip ${due.level}`} title={due.text}>
                <IconCalendar />
                {due.label}
              </span>
            )}
            {showProgress && (
              <>
                <span className="count">
                  {s.total === 0
                    ? hasKids ? 'No todos yet' : 'Empty'
                    : isRoot
                      ? `${s.done} of ${s.total} done`
                      : comp && type === 'project'
                        ? `All done · ${s.done} done`
                        : `${s.done}/${s.total}`}
                </span>
                {s.total > 0 && (
                  <span className="bar">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="handles">
        {hasKids && (
          <button
            className={'fold' + (folded && idleInside && !hiddenFlag ? ' has-idle' : '') + (hiddenFlag ? ` has-ask m-${hiddenFlag.color}` : '') + (hiddenDue && hiddenDue !== 'later' ? ` has-due-${hiddenDue}` : '')}
            tabIndex={-1}
            data-act="fold"
            title={hiddenDue === 'urgent' ? 'A deadline inside is due within a day' : hiddenDue === 'soon' ? 'A deadline inside is due within 3 days' : undefined}
            aria-label={
              (folded ? 'Expand ' : 'Collapse ') +
              name +
              (hiddenAsk ? ' (has things to bring up inside)' : '') +
              (hiddenDue === 'urgent' ? ' (deadline due within a day inside)' : hiddenDue === 'soon' ? ' (deadline due soon inside)' : '')
            }
          >
            {folded ? '+' + countDesc(n) : '−'}
          </button>
        )}
        {canHaveNotes(type) && (
          <button
            className={'notes-btn' + (n.notes ? ' filled' : '')}
            tabIndex={-1}
            data-act="notes"
            aria-label={(n.notes ? 'Read notes: ' : 'Add notes: ') + name}
            // With notes, hovering shows a formatted preview card instead of a tooltip (KAN-25).
            title={n.notes ? undefined : 'Add notes'}
          >
            <IconNotes />
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
  meetings,
  sealed,
  register,
}: {
  id: string;
  items: TreeNode[];
  selected: boolean;
  dim: boolean;
  meetings: Meeting[];
  sealed?: ReadonlySet<string>;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  const isSealed = (i: TreeNode) => !!sealed?.has(i.id);
  const top = items.find((i) => !isSealed(i));
  const titleOf = (i: TreeNode) => (isSealed(i) ? 'sensitive item' : i.title || 'Untitled');
  const label = `${items.length} done`;
  const asks = items.filter((i) => !isSealed(i) && i.flags && Object.keys(i.flags).length > 0).length;
  const flagColor = firstFlagged(items, meetings, false, sealed)?.color;
  return (
    <div
      ref={(el) => register(id, el)}
      className={'node stack' + (selected ? ' selected' : '') + (dim ? ' dim' : '')}
      data-id={id}
      id={`n-${id.replace(':', '-')}`}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={false}
      aria-label={`${label}: ${items.map(titleOf).join(', ')}. Press Enter to show them.`}
      title="Show finished items"
    >
      <span className="stack-layer l2" aria-hidden="true" />
      <span className="stack-layer l1" aria-hidden="true" />
      <span className="check stack-check" aria-hidden="true">
        <IconCheck />
      </span>
      <div className="body">
        {top ? <span className="title">{top.title || 'Untitled'}</span> : <span className="title sealed-bar" aria-hidden="true" />}
        <div className="meta">
          <span className="count">
            +{items.length - 1} more done
          </span>
        </div>
      </div>
      <div className="handles">
        {asks > 0 && (
          <span className={`flag-dot m-${flagColor}`} title={`${asks} item${asks === 1 ? '' : 's'} to bring up in here`} aria-hidden="true" />
        )}
        <span className="stack-badge">{items.length}</span>
      </div>
    </div>
  );
});
