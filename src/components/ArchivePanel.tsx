'use client';

import { useMemo, useState } from 'react';
import { ARCHIVE_DAYS, lastDoneAt } from '@/lib/tree/archive';
import { countDesc } from '@/lib/tree/model';
import type { ArchivedItem, TreeNode } from '@/lib/tree/types';
import { IconLock } from './icons';

interface Props {
  archive: ArchivedItem[];
  /** "Hide sensitive" is on: sensitive entries show no title, path or content. */
  hideSensitive: boolean;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const day = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/** Finished work that left the tree (KAN-28): find it, bring it back, or delete it for good. */
export function ArchivePanel({ archive, hideSensitive, onRestore, onDelete, onClose }: Props) {
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const query = q.trim().toLowerCase();
  const hidden = (e: ArchivedItem) => hideSensitive && !!e.sensitive;

  const groups = useMemo(() => {
    const top = archive.filter((e) => !e.within);
    const matches = (n: TreeNode): boolean => (n.title || '').toLowerCase().includes(query) || n.children.some(matches);
    const shown = top
      .filter((e) => !query || (!hidden(e) && (matches(e.node) || archive.some((x) => x.within === e.node.id && matches(x.node)))))
      .sort((a, b) => b.archivedAt - a.archivedAt);
    const by = new Map<string, ArchivedItem[]>();
    for (const e of shown) {
      const key = hidden(e) ? 'Sensitive' : e.path[0] ?? 'Top level';
      by.set(key, [...(by.get(key) ?? []), e]);
    }
    return [...by.entries()];
    // `hidden` only depends on hideSensitive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive, query, hideSensitive]);

  const itemsOf = (e: ArchivedItem) =>
    1 + countDesc(e.node) + archive.filter((x) => x.within === e.node.id).reduce((a, x) => a + 1 + countDesc(x.node), 0);

  return (
    <section className="panel archive-panel" aria-labelledby="archive-title">
      <div className="panel-head">
        <h2 id="archive-title">Archive</h2>
        {archive.length > 0 && <span className="m-count plain">{archive.filter((e) => !e.within).length}</span>}
        <div className="spacer" />
        <button className="tb icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {archive.length === 0 ? (
        <p className="panel-empty">
          Nothing here yet. Finished todos move to the archive {ARCHIVE_DAYS} days after you tick them, so your tree stays about what’s ahead. You can also
          archive a finished todo or a complete project yourself: <kbd>Shift</kbd>+<kbd>A</kbd>.
        </p>
      ) : (
        <>
          <input className="archive-search" type="search" placeholder="Search the archive" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the archive" />
          {groups.length === 0 && <p className="panel-empty">Nothing in the archive matches “{q}”.</p>}
          {groups.map(([name, list]) => (
            <div className="q-group" key={name}>
              <h3>{name}</h3>
              <ol className="q-list archive-list">
                {list.map((e) => {
                  const n = e.node;
                  const items = itemsOf(e);
                  const inner = archive.filter((x) => x.within === n.id);
                  const secret = hidden(e);
                  return (
                    <li key={n.id}>
                      <div className="archive-entry">
                        {secret ? (
                          <span className="q-title archive-sealed">
                            <IconLock /> Sensitive item
                          </span>
                        ) : (
                          <>
                            {e.path.length > 1 && <small>{e.path.slice(1).join(' › ')}</small>}
                            <span className="q-title">
                              {n.title || 'Untitled'}
                              {n.type === 'project' && <span className="archive-kind">Project</span>}
                            </span>
                          </>
                        )}
                        <small>
                          Finished {day(lastDoneAt(n))} · archived {day(e.archivedAt)}
                          {items > 1 ? ` · ${items} items` : ''}
                        </small>
                        {!secret && (n.children.length > 0 || inner.length > 0) && (
                          <details className="archive-inside">
                            <summary>What’s inside</summary>
                            <Inside nodes={[...n.children, ...inner.map((x) => x.node)]} />
                          </details>
                        )}
                        {confirm === n.id && (
                          <div className="archive-confirm" role="alert">
                            <span>
                              Delete {items === 1 ? 'it' : `these ${items} items`} for good?
                            </span>
                            <button
                              className="tb danger"
                              onClick={() => {
                                setConfirm(null);
                                onDelete(n.id);
                              }}
                            >
                              Delete
                            </button>
                            <button className="tb" onClick={() => setConfirm(null)}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                      {confirm !== n.id && (
                        <div className="archive-actions">
                          <button className="tb q-done" onClick={() => onRestore(n.id)} aria-label={`Restore ${secret ? 'sensitive item' : n.title || 'Untitled'}`}>
                            Restore
                          </button>
                          <button className="tb icon archive-delete" onClick={() => setConfirm(n.id)} aria-label="Delete for good" title="Delete for good">
                            ×
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function Inside({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul>
      {nodes.map((c) => (
        <li key={c.id} className={c.type === 'note' ? 'is-note' : c.done ? 'is-done' : undefined}>
          {c.title || 'Untitled'}
          {c.children.length > 0 && <Inside nodes={c.children} />}
        </li>
      ))}
    </ul>
  );
}
