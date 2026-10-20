'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion, useStageScale } from './hooks';

/**
 * The hero: a small tree that builds itself and then gets used, the way you'd use the real app.
 * Every state is drawn with the app's own shapes (project boxes, todo pills, branch curves).
 */

const W = 700;
const H = 320;

/** Chapters of the story, each starting at a step. */
const CHAPTERS = [
  { step: 0, title: 'Branch it out', text: 'Projects branch into todos, and todos into smaller steps.' },
  { step: 3, title: 'Tick it off', text: 'Finished work turns grey and stacks itself out of the way.' },
  { step: 5, title: 'See what’s due', text: 'Deadlines turn orange three days out and red on the last day.' },
  { step: 6, title: 'Bring it up', text: 'Flag a question for standup. It’s waiting on your agenda.' },
  { step: 7, title: 'Focus', text: 'Pick a project and everything else fades back.' },
];
/** How long each step stays on screen (ms). */
const DURATIONS = [1000, 1100, 1700, 1300, 1900, 2200, 2200, 3200];

type Kind = 'root' | 'project' | 'todo' | 'stack';
interface Item {
  id: string;
  kind: Kind;
  title: string;
  x: number;
  y: number;
  done?: boolean;
  dim?: boolean;
  chip?: 'later' | 'urgent';
  flag?: boolean;
  count?: number;
  /** Not drawn (but kept mounted so it can animate out). */
  gone?: boolean;
  parent?: string;
  progress?: number;
}

const ROW = 50;
const X = { root: 6, project: 168, todo: 420 };

function scene(step: number): Item[] {
  const kids1 = step >= 2;
  const ticked = step >= 3;
  const sunk = step >= 4;
  const focus = step >= 7;
  // Todos under "Website relaunch": open ones first, finished ones sink to the bottom.
  const open = sunk ? ['t2', 't3'] : ['t1', 't2', 't3'];
  const rows: string[] = kids1 ? [...open, 'stack'] : [];
  const top = 34;
  const yOf = (id: string) => top + rows.indexOf(id) * ROW;
  const p1y = kids1 ? top + ((rows.length - 1) * ROW) / 2 : 120;
  const p2kidY = kids1 ? top + rows.length * ROW + 26 : 0;
  const p2y = kids1 ? p2kidY : 220;
  const ry = (p1y + p2y) / 2;
  const items: Item[] = [
    { id: 'r', kind: 'root', title: 'Work', x: X.root, y: ry, dim: focus },
    { id: 'p1', kind: 'project', title: 'Website relaunch', x: X.project, y: p1y, gone: step < 1, parent: 'r', progress: ticked ? 2 / 5 : 1 / 5 },
    { id: 'p2', kind: 'project', title: 'Q4 report', x: X.project, y: p2y, gone: step < 1, parent: 'r', dim: focus, progress: 0 },
  ];
  if (kids1) {
    items.push(
      { id: 't1', kind: 'todo', title: 'Write the copy', x: X.todo, y: sunk ? yOf('stack') : yOf('t1'), done: ticked, parent: 'p1', gone: sunk },
      { id: 't2', kind: 'todo', title: 'Review designs', x: X.todo, y: yOf('t2'), parent: 'p1', flag: step >= 6 },
      { id: 't3', kind: 'todo', title: 'Launch checklist', x: X.todo, y: yOf('t3'), parent: 'p1', chip: step >= 5 ? 'urgent' : 'later' },
      { id: 'stack', kind: sunk ? 'stack' : 'todo', title: 'Pick a domain', x: X.todo, y: yOf('stack'), done: true, count: sunk ? 2 : 1, parent: 'p1' },
      { id: 't4', kind: 'todo', title: 'Collect numbers', x: X.todo, y: p2kidY, parent: 'p2', dim: focus },
    );
  }
  return items;
}

/** Where the pointer is, per step: it does what a person would do. */
function pointer(step: number, items: Item[]): { x: number; y: number; press: boolean } | null {
  const at = (id: string, dx: number) => {
    const it = items.find((i) => i.id === id);
    return it ? { x: it.x + dx, y: it.y + 18 } : null;
  };
  if (step === 3) return { ...at('t1', 22)!, press: true };
  if (step === 4) return { ...at('t2', 120)!, press: false };
  if (step === 6) return { ...at('t2', 150)!, press: true };
  if (step === 7) return { ...at('p1', 70)!, press: true };
  return null;
}

export function HeroTree() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const inView = useInView(wrap, 0.2);
  const scale = useStageScale(wrap, W);

  // Play the story while it's on screen; loop at the end.
  const playing = inView && !reduced;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % DURATIONS.length), DURATIONS[step]);
    return () => clearTimeout(t);
  }, [step, playing]);

  const shown = reduced ? 6 : step;
  const items = scene(shown);
  const byId = new Map(items.map((i) => [i.id, i]));
  const chapter = CHAPTERS.reduce((c, ch, i) => (shown >= ch.step ? i : c), 0);
  const ptr = reduced ? null : pointer(shown, items);

  return (
    <figure className="hero-figure" aria-label="An animated example of a tree in Todo Tree">
      <div
        className="hero-stage-wrap"
        ref={wrap}
        style={{ height: H * scale }}
      >
        <div className="hero-stage" style={{ width: W, height: H, transform: `scale(${scale})` }} aria-hidden="true">
          <svg className="lp-links" width={W} height={H}>
            {items
              .filter((i) => i.parent && !(i.gone && i.id !== 't1'))
              .map((i) => {
                const p = byId.get(i.parent!)!;
                const pw = p.kind === 'root' ? 100 : 196;
                const sx = p.x + pw, sy = p.y + 20, ex = i.x, ey = i.y + 20, mx = (sx + ex) / 2;
                const cls = ['lp-link', i.done ? 'done' : '', i.dim ? 'dim' : '', i.gone ? 'gone' : ''].join(' ');
                return <path key={`${i.id}-${p.id}`} className={cls} pathLength={1} d={`M${sx} ${sy}C${mx} ${sy},${mx} ${ey},${ex} ${ey}`} />;
              })}
          </svg>
          {items.map((i) => (
            <Node key={i.id} item={i} />
          ))}
          {ptr && (
            <span className={'lp-pointer' + (ptr.press ? ' press' : '')} style={{ transform: `translate(${ptr.x}px, ${ptr.y}px)` }}>
              <svg viewBox="0 0 20 20">
                <path d="M3 2l13 7.2-5.6 1.4L8 16.5z" />
              </svg>
            </span>
          )}
        </div>
      </div>
      <figcaption className="hero-caption">
        <ol className="chapters">
          {CHAPTERS.map((c, i) => (
            <li key={c.title}>
              <button
                type="button"
                className={i === chapter ? 'on' : ''}
                aria-current={i === chapter ? 'step' : undefined}
                onClick={() => setStep(c.step)}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ol>
        <p className="chapter-text" aria-live="polite">
          {CHAPTERS[chapter].text}
        </p>
      </figcaption>
    </figure>
  );
}

function Node({ item: i }: { item: Item }) {
  const cls = ['lp-node', `lp-${i.kind}`, i.done ? 'done' : '', i.dim ? 'dim' : '', i.gone ? 'gone' : '', i.chip === 'urgent' ? 'urgent' : ''].join(' ');
  return (
    <div className={cls} style={{ transform: `translate(${i.x}px, ${i.y}px)` }}>
      {i.kind === 'stack' && (
        <>
          <span className="lp-layer l2" />
          <span className="lp-layer l1" />
        </>
      )}
      {i.kind === 'project' && <Ring value={i.progress ?? 0} />}
      {(i.kind === 'todo' || i.kind === 'stack') && (
        <span className={'lp-check' + (i.done ? ' on' : '')}>
          <svg viewBox="0 0 16 16">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
      )}
      <span className="lp-title">
        {i.title}
        {i.kind === 'stack' && <small>+1 more done</small>}
      </span>
      {i.chip && <span className={'lp-chip ' + i.chip}>{i.chip === 'urgent' ? 'Tomorrow' : 'Fri 31 Oct'}</span>}
      {i.flag && <span className="lp-flag">? Standup</span>}
      {i.kind === 'stack' && <span className="lp-count">{i.count}</span>}
    </div>
  );
}

export function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 8;
  return (
    <svg className="lp-ring" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="8" />
      <circle cx="11" cy="11" r="8" className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
    </svg>
  );
}
