'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { TYPES, type TreeNode } from '@/lib/tree/types';

// The editor is only loaded when notes are opened, so it doesn't slow down starting the app.
const RichNotes = dynamic(() => import('./RichNotes'), { ssr: false, loading: () => <div className="notes-rich notes-loading" aria-busy="true" /> });

interface Props {
  /** The project or todo whose notes are being written. */
  node: TreeNode;
  path: string[];
  /** Called while typing (debounced) and when the dialog closes. */
  onChange: (id: string, notes: string) => void;
  /** Typing has stopped for good: the next change starts a new undo step. */
  onSessionEnd: () => void;
  onClose: () => void;
}

/** Centred dialog with rich notes (stored as Markdown) for a project or todo. Saves as you type. */
export function NotesPanel({ node, path, onChange, onSessionEnd, onClose }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) onChange(node.id, pending.current);
    pending.current = null;
  };
  const close = () => {
    flush();
    onSessionEnd();
    onClose();
  };

  useEffect(() => {
    // Save anything still pending if the dialog is torn down some other way.
    return () => {
      flush();
      onSessionEnd();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="notes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notes-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="panel-head">
          <div className="notes-for">
            {path.length > 0 && <small>{path.join(' › ')}</small>}
            <h2 id="notes-title">
              <span className={`pi pi-${node.type}`} aria-hidden="true" /> {node.title || 'Untitled'}
            </h2>
          </div>
          <div className="spacer" />
          <button className="tb icon" aria-label="Close notes" onClick={close}>
            ×
          </button>
        </div>
        <RichNotes
          value={node.notes ?? ''}
          placeholder={`Notes for this ${TYPES[node.type].label.toLowerCase()}: context, links, decisions, who to ask…`}
          label={`Notes for ${node.title || 'Untitled'}`}
          onChange={(md) => {
            pending.current = md;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, 400);
          }}
        />
        <div className="notes-foot">
          <div className="spacer" />
          <button className="tb primary" onClick={close}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
