'use client';

import { forwardRef } from 'react';
import type { SaveStatus } from '@/lib/tree/useTreeStore';
import { anyFilter, type Filters } from '@/lib/tree/layout';
import { IconDownload, IconFilter, IconFocus, IconMeetings, IconMinus, IconPlus, IconRedo, IconUndo, IconUpload } from './icons';

const STATUS: Record<SaveStatus, string> = {
  loading: '',
  saving: 'Saving…',
  saved: 'Saved in this browser',
  error: 'Couldn’t save. Export a backup to be safe.',
};

interface Props {
  hideDone: boolean;
  focusMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  helpOpen: boolean;
  meetingsOpen: boolean;
  flaggedCount: number;
  /** Meetings/people that have something flagged, in their own colours. */
  meetingDots: { id: string; name: string; color: string; count: number }[];
  onMeetings: () => void;
  filters: Filters;
  filterMatches: number;
  filterOpen: boolean;
  onFilter: (anchor: DOMRect) => void;
  onAdd: (anchor: DOMRect) => void;
  onHideDone: () => void;
  onFocusMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onZoom: (f: number) => void;
  onHelp: () => void;
  onExport: () => void;
  onImport: () => void;
}

// Toolbar buttons shouldn't steal keyboard focus from the canvas on mouse click.
const keepFocus = (e: React.PointerEvent) => {
  if (e.pointerType === 'mouse') e.preventDefault();
};

export const Toolbar = forwardRef<HTMLElement, Props>(function Toolbar(p, ref) {
  return (
    <header className="topbar" ref={ref} onPointerDown={keepFocus}>
      <div className="group">
        <button className="tb primary" title="Add something to the top level" onClick={(e) => p.onAdd(e.currentTarget.getBoundingClientRect())}>
          <IconPlus w={2} />
          Add
        </button>
        <button className="tb" aria-pressed={p.hideDone} title="Hide finished items" onClick={p.onHideDone}>
          Hide done
        </button>
        <button className="tb" aria-pressed={p.focusMode} title="Focus on the selected project: fade the rest and centre it" onClick={p.onFocusMode}>
          <IconFocus />
          Focus
        </button>
        <button
          className={'tb' + (anyFilter(p.filters) ? ' filtering' : '')}
          data-filter-button
          aria-pressed={anyFilter(p.filters)}
          aria-expanded={p.filterOpen}
          title="Show only high-priority or soon-due items"
          onClick={(e) => p.onFilter(e.currentTarget.getBoundingClientRect())}
        >
          <IconFilter />
          {!anyFilter(p.filters) ? 'Filter' : p.filters.high && p.filters.dueSoon ? 'Priority + due soon' : p.filters.high ? 'High priority' : 'Due soon'}
          {anyFilter(p.filters) && <span className="filter-count">{p.filterMatches}</span>}
        </button>
      </div>
      <div className="group">
        <button
          className="tb"
          aria-pressed={p.meetingsOpen}
          title="Things to ask or mention, per meeting or person"
          aria-label={`To bring up: ${p.flaggedCount} item${p.flaggedCount === 1 ? '' : 's'}`}
          onClick={p.onMeetings}
        >
          <IconMeetings />
          Meetings
          {p.meetingDots.length > 0 && (
            <span className="m-dots" aria-hidden="true">
              {p.meetingDots.map((m) => (
                <span key={m.id} className={`m-count m-${m.color}`} title={`${m.name}: ${m.count}`}>
                  {m.count}
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
      <span className="status" aria-live="polite">
        {STATUS[p.status]}
      </span>
      <div className="spacer" />
      <div className="group">
        <button className="tb icon" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          <IconUndo />
        </button>
        <button className="tb icon" aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
          <IconRedo />
        </button>
      </div>
      <div className="group">
        <button className="tb icon" aria-label="Zoom out" onClick={() => p.onZoom(0.8)}>
          <IconMinus />
        </button>
        <button className="tb" title="Fit the whole tree on screen (F)" onClick={p.onFit}>
          Fit
        </button>
        <button className="tb icon" aria-label="Zoom in" onClick={() => p.onZoom(1.25)}>
          <IconPlus w={2} />
        </button>
      </div>
      <div className="group">
        <button className="tb icon" aria-label="Download a backup" title="Download a backup (.json)" onClick={p.onExport}>
          <IconDownload />
        </button>
        <button className="tb icon" aria-label="Restore from a backup" title="Restore from a backup" onClick={p.onImport}>
          <IconUpload />
        </button>
        <button className="tb icon" aria-label="How it works and shortcuts" aria-expanded={p.helpOpen} onClick={p.onHelp}>
          ?
        </button>
      </div>
    </header>
  );
});
