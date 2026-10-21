'use client';

import { useState } from 'react';
import type { FlaggedItem } from '@/lib/tree/model';
import { MAX_MEETINGS, MEETING_COLORS, type FlagKind, type Meeting, type MeetingColor } from '@/lib/tree/types';
import { FlagBadge } from './FlagBadge';
import { track } from '@/lib/analytics';

interface Props {
  meetings: Meeting[];
  itemsFor: (meetingId: string) => FlaggedItem[];
  active: string | null;
  onActive: (meetingId: string) => void;
  selectedId: string | null;
  manage: boolean;
  onManage: (on: boolean) => void;
  onGo: (id: string) => void;
  onRaised: (id: string, meetingId: string) => void;
  onCopy: (meetingId: string) => void;
  onAdd: (name: string) => void;
  onUpdate: (meetingId: string, patch: { name?: string; color?: MeetingColor }) => void;
  onRemove: (meetingId: string) => void;
  onClose: () => void;
}

/** Per meeting (or person): what to ask and what to mention, ready to walk through. */
export function MeetingsPanel(p: Props) {
  const current = p.meetings.find((m) => m.id === p.active) ?? p.meetings[0] ?? null;
  const items = current ? p.itemsFor(current.id) : [];
  const asks = items.filter((i) => i.kind === 'ask');
  const mentions = items.filter((i) => i.kind === 'mention');

  return (
    <section className="panel meetings-panel" aria-labelledby="meetings-title">
      <div className="panel-head">
        <h2 id="meetings-title">{p.manage ? 'Meetings & people' : 'To bring up'}</h2>
        <div className="spacer" />
        <button className="tb" aria-pressed={p.manage} onClick={() => p.onManage(!p.manage)}>
          {p.manage ? 'Back to lists' : 'Edit'}
        </button>
        <button className="tb icon" aria-label="Close" onClick={p.onClose}>
          ×
        </button>
      </div>

      {p.manage ? (
        <ManageMeetings {...p} />
      ) : !current ? (
        <p className="panel-empty">
          Add a meeting or a person (a standup, a weekly sync, a stakeholder) under <b>Edit</b>, then flag items for them.
        </p>
      ) : (
        <>
          <div className="m-tabs" role="tablist" aria-label="Meetings and people">
            {p.meetings.map((m) => {
              const n = p.itemsFor(m.id).length;
              return (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={m.id === current.id}
                  className={`m-tab m-${m.color}` + (m.id === current.id ? ' on' : '')}
                  onClick={() => p.onActive(m.id)}
                >
                  <span className={`m-dot m-${m.color}`} aria-hidden="true" />
                  {m.name}
                  {n > 0 && <span className="m-count">{n}</span>}
                </button>
              );
            })}
          </div>

          {items.length === 0 ? (
            <p className="panel-empty">
              Nothing for {current.name} yet. Select an item and press <kbd>Q</kbd> (or <b>Bring up</b>) to add a question or something to mention.
            </p>
          ) : (
            <>
              <Group title="To ask" kind="ask" list={asks} meeting={current} {...p} />
              <Group title="To mention" kind="mention" list={mentions} meeting={current} {...p} />
              <div className="panel-foot">
                <button
                  className="tb primary"
                  onClick={() => {
                    p.onCopy(current.id);
                    track('meeting_list_copied');
                  }}
                >
                  Copy list
                </button>
                <span>Paste it into the chat or your notes.</span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Group({ title, kind, list, meeting, selectedId, onGo, onRaised }: Props & { title: string; kind: FlagKind; list: FlaggedItem[]; meeting: Meeting }) {
  if (!list.length) return null;
  return (
    <div className="q-group">
      <h3>
        <FlagBadge kind={kind} meeting={meeting} small /> {title} <span className="m-count plain">{list.length}</span>
      </h3>
      <ol className="q-list">
        {list.map((q) => (
          <li key={q.id} className={q.id === selectedId ? 'current' : undefined}>
            <button className="q-go" onClick={() => onGo(q.id)} title="Show it in the tree">
              {q.path.length > 0 && <small>{q.path.join(' › ')}</small>}
              <span className="q-title">
                {q.title || 'Untitled'}
                {q.done && <span className="q-done-tag">Done ✓</span>}
              </span>
            </button>
            <button className="tb q-done" onClick={() => onRaised(q.id, meeting.id)} aria-label={`Raised: ${q.title || 'Untitled'}`}>
              {kind === 'ask' ? 'Answered' : 'Mentioned'}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ManageMeetings({ meetings, itemsFor, onAdd, onUpdate, onRemove }: Props) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    onAdd(name);
    setName('');
  };
  return (
    <div className="m-manage">
      <p className="filter-note">Meetings or people you want to bring things up with: a standup, a weekly sync, a stakeholder.</p>
      <ul>
        {meetings.map((m) => (
          <li key={m.id}>
            <input
              className="m-name"
              defaultValue={m.name}
              aria-label="Name"
              maxLength={40}
              onBlur={(e) => onUpdate(m.id, { name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <div className="swatches" role="radiogroup" aria-label={`Colour for ${m.name}`}>
              {MEETING_COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={m.color === c}
                  aria-label={c}
                  className={`swatch m-${c}` + (m.color === c ? ' on' : '')}
                  onClick={() => onUpdate(m.id, { color: c })}
                />
              ))}
            </div>
            <button
              className="tb danger icon"
              aria-label={`Remove ${m.name}`}
              title={itemsFor(m.id).length ? `Remove (and its ${itemsFor(m.id).length} flag${itemsFor(m.id).length === 1 ? '' : 's'})` : 'Remove'}
              onClick={() => onRemove(m.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {meetings.length < MAX_MEETINGS ? (
        <form
          className="m-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly sync, Anna (stakeholder)" aria-label="New meeting or person" maxLength={40} />
          <button className="tb primary" disabled={!name.trim()}>
            Add
          </button>
        </form>
      ) : (
        <p className="filter-note">That’s the maximum of {MAX_MEETINGS}.</p>
      )}
    </div>
  );
}
