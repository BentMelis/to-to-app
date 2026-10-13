import { describe, expect, it } from 'vitest';
import { addDays, daysUntil, dueLevel, formatDue, nextMonday } from '../dates';
import * as M from '../model';
import type { TreeDoc } from '../types';

describe('deadline colours', () => {
  const today = '2026-10-13';
  const level = (due: string) => dueLevel(daysUntil(due, today));
  it('is neutral with more than 3 days left', () => {
    expect(level('2026-10-17')).toBe('later');
  });
  it('turns orange at 3 days or fewer', () => {
    expect(level('2026-10-16')).toBe('soon');
    expect(level('2026-10-15')).toBe('soon');
  });
  it('turns red with one day left, on the day and when overdue', () => {
    expect(level('2026-10-14')).toBe('urgent');
    expect(level('2026-10-13')).toBe('urgent');
    expect(level('2026-10-01')).toBe('urgent');
  });
  it('counts calendar days across a DST change', () => {
    expect(daysUntil('2026-10-26', '2026-10-24')).toBe(2); // EU clocks go back on 25 Oct
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
  it('formats relative labels', () => {
    expect(formatDue('2026-10-13', today)).toBe('Today');
    expect(formatDue('2026-10-14', today)).toBe('Tomorrow');
    expect(formatDue('2026-10-10', today)).toBe('3 days overdue');
  });
  it('next Monday is always in the future', () => {
    expect(nextMonday('2026-10-13')).toBe('2026-10-19'); // Tue
    expect(nextMonday('2026-10-19')).toBe('2026-10-26'); // Mon
  });
});

const doc = (): TreeDoc => ({
  v: 3,
  meetings: [],
  root: { id: 'root', type: 'root', title: 'R', done: false, collapsed: false, children: [
    { id: 'p', type: 'project', title: 'P', done: false, collapsed: true, children: [
      { id: 't', type: 'todo', title: 't', done: false, collapsed: false, children: [] },
      { id: 'n', type: 'note', title: 'n', done: false, collapsed: false, children: [] },
    ] },
  ] },
});

describe('priority & deadline ops', () => {
  it('sets and clears a deadline, rejects notes and bad dates', () => {
    const d = M.setDue(doc(), 't', '2026-10-20')!.doc;
    expect(d.root.children[0].children[0].due).toBe('2026-10-20');
    expect(M.setDue(doc(), 'n', '2026-10-20')).toBeNull();
    expect(M.setDue(doc(), 't', '20/10/2026')).toBeNull();
    expect(M.setDue(d, 't', null)!.doc.root.children[0].children[0].due).toBeUndefined();
  });
  it('toggles high priority', () => {
    const d = M.toggleHigh(doc(), 't')!.doc;
    expect(d.root.children[0].children[0].high).toBe(true);
    expect(M.toggleHigh(d, 't')!.doc.root.children[0].children[0].high).toBeUndefined();
    expect(M.toggleHigh(doc(), 'n')).toBeNull();
  });
  it('drops them when an item becomes a note', () => {
    let d = M.setDue(doc(), 't', '2026-10-20')!.doc;
    d = M.toggleHigh(d, 't')!.doc;
    const t = M.changeType(d, 't', 'note')!.doc.root.children[0].children[0];
    expect(t.due).toBeUndefined();
    expect(t.high).toBeUndefined();
  });
  it('reports the worst deadline hidden in a branch', () => {
    const d = M.setDue(doc(), 't', '2026-10-14')!.doc;
    expect(M.worstDueBelow(d.root.children[0], M.buildIndex(d.root), '2026-10-13')).toBe('urgent');
  });
  it('round-trips through save/load', () => {
    const d = M.toggleHigh(M.setDue(doc(), 't', '2026-10-20')!.doc, 't')!.doc;
    const t = M.parseDoc(JSON.stringify(d))!.root.children[0].children[0];
    expect([t.due, t.high]).toEqual(['2026-10-20', true]);
  });
});
