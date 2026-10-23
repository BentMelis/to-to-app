'use client';

import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { notesPreviewBlocks, type PreviewBlock, type Span } from '@/lib/tree/notesBlocks';

interface Props {
  /** Markdown. */
  notes: string;
  /** The notes button the card belongs to. */
  anchor: HTMLElement;
  /** Opened by keyboard: hint at the shortcut instead of the mouse. */
  viaKeyboard: boolean;
  onOpen: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function Inline({ spans }: { spans: Span[] }) {
  return spans.map((s, i) => {
    let el: ReactNode = s.text;
    if (s.code) el = <code>{el}</code>;
    if (s.s) el = <s>{el}</s>;
    if (s.i) el = <em>{el}</em>;
    if (s.b) el = <strong>{el}</strong>;
    if (s.href)
      el = (
        <a href={s.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {el}
        </a>
      );
    return <Fragment key={i}>{el}</Fragment>;
  });
}

/** Consecutive list items of the same kind become one list, so numbers and bullets line up. */
function group(blocks: PreviewBlock[]) {
  const out: (PreviewBlock | Extract<PreviewBlock, { kind: 'li' }>[])[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.kind === 'li' && Array.isArray(last) && last[0].list === b.list) last.push(b);
    else out.push(b.kind === 'li' ? [b] : b);
  }
  return out;
}

function Block({ b }: { b: PreviewBlock }) {
  switch (b.kind) {
    case 'h': {
      const H = `h${b.level}` as const;
      return (
        <H>
          <Inline spans={b.spans} />
        </H>
      );
    }
    case 'p':
      return (
        <p>
          <Inline spans={b.spans} />
        </p>
      );
    case 'quote':
      return (
        <blockquote>
          <Inline spans={b.spans} />
        </blockquote>
      );
    case 'code':
      return (
        <pre>
          <code>{b.text}</code>
        </pre>
      );
    case 'hr':
      return <hr />;
    case 'table':
      return (
        <table>
          <tbody>
            {b.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  const Cell = r === 0 ? 'th' : 'td';
                  return (
                    <Cell key={c}>
                      <Inline spans={cell} />
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'li':
      return null; // rendered by its list
  }
}

const GAP = 10;

/**
 * Read-only look at the start of an item's notes, next to its notes button (KAN-25).
 * Placed to the right of the button so it never covers the item itself; below or above when there's no room.
 */
export function NotesPreviewCard({ notes, anchor, viaKeyboard, onOpen, onPointerEnter, onPointerLeave }: Props) {
  const { blocks, more } = useMemo(() => notesPreviewBlocks(notes), [notes]);
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    // Clear of the item's other buttons too (fold, add), so they stay clickable.
    const a = (anchor.closest('.handles') ?? anchor).getBoundingClientRect();
    const w = card.offsetWidth, h = card.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const clampX = (x: number) => Math.max(8, Math.min(x, vw - w - 8));
    const clampY = (y: number) => Math.max(8, Math.min(y, vh - h - 8));
    if (a.right + GAP + w <= vw - 8) setAt({ left: a.right + GAP, top: clampY(a.top + a.height / 2 - 24) });
    else if (a.bottom + GAP + h <= vh - 8) setAt({ left: clampX(a.right - w), top: a.bottom + GAP });
    else setAt({ left: clampX(a.right - w), top: clampY(a.top - GAP - h) });
  }, [anchor, notes]);

  return (
    <div
      ref={ref}
      id="notes-preview"
      className={'notes-preview' + (more ? ' more' : '')}
      role="tooltip"
      style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}
      onClick={onOpen}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="notes-preview-body">
        {group(blocks).map((g, i) =>
          Array.isArray(g) ? (
            g[0].list === 'ol' ? (
              <ol key={i} start={g[0].n}>
                {g.map((li, j) => (
                  <li key={j} className={`d${li.depth}`}>
                    <Inline spans={li.spans} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className={g[0].list === 'task' ? 'tasks' : undefined}>
                {g.map((li, j) => (
                  <li key={j} className={`d${li.depth}` + (li.checked ? ' checked' : '')}>
                    {li.list === 'task' && <span className="box" role="img" aria-label={li.checked ? 'Done' : 'To do'} />}
                    <span>
                      <Inline spans={li.spans} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Block key={i} b={g} />
          ),
        )}
      </div>
      <div className="notes-preview-foot">
        Open notes
        {viaKeyboard && <kbd>N</kbd>}
      </div>
    </div>
  );
}
