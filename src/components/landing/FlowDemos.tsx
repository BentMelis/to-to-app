'use client';

import { useRef } from 'react';
import { useInView, useReducedMotion, useSequence } from './hooks';
import { Ring } from './HeroTree';

/**
 * Small live pieces of the app for the "how it works" steps. Each plays once when scrolled into view
 * (and shows its end state straight away for people who prefer less motion).
 */

function usePlay(steps: number, ms: number | readonly number[]) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const seen = useInView(ref, 0.5, true);
  const i = useSequence(seen && !reduced, steps, ms as number | number[]);
  return { ref, step: reduced ? steps - 1 : seen ? i : -1 };
}

const BREAK_MS = [500, 450, 450, 450];
/** 1. A todo that's too big gets broken into steps. */
export function BreakDown() {
  const { ref, step } = usePlay(5, BREAK_MS);
  const kids = ['Pick the venue', 'Send the invites', 'Order the food'];
  return (
    <div className="demo demo-break" ref={ref} aria-hidden="true">
      <svg className="lp-links" viewBox="0 0 360 190" preserveAspectRatio="xMinYMin meet">
        {kids.map((k, i) =>
          step > i ? <path key={k} className="lp-link" pathLength={1} d={`M150 95C185 95,185 ${30 + i * 65},215 ${30 + i * 65}`} /> : null,
        )}
      </svg>
      <div className="lp-node lp-todo parent" style={{ transform: 'translate(0px, 75px)' }}>
        <span className="lp-check mixed" />
        <span className="lp-title">Team offsite</span>
      </div>
      {kids.map((k, i) => (
        <div key={k} className={'lp-node lp-todo small' + (step > i ? '' : ' gone')} style={{ transform: `translate(215px, ${10 + i * 65}px)` }}>
          <span className="lp-check" />
          <span className="lp-title">{k}</span>
        </div>
      ))}
      <span className={'demo-key' + (step >= 0 && step < 4 ? ' on' : '')}>
        <kbd>Tab</kbd> <kbd>Enter</kbd> <kbd>Enter</kbd>
      </span>
    </div>
  );
}

const FINISH_MS = [700, 900, 700];
/** 2. Ticking off: it greys, sinks below the open work and joins the stack. */
export function FinishIt() {
  const { ref, step } = usePlay(4, FINISH_MS);
  const ticked = step >= 1;
  const sunk = step >= 2;
  const y = (row: number) => `translate(0px, ${row * 52}px)`;
  return (
    <div className="demo demo-finish" ref={ref} aria-hidden="true">
      <div className={'lp-node lp-todo' + (ticked ? ' done' : '') + (sunk ? ' gone' : '')} style={{ transform: y(sunk ? 2 : 0) }}>
        <span className={'lp-check' + (ticked ? ' on' : '')}>
          <svg viewBox="0 0 16 16">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
        <span className="lp-title">Send the invoice</span>
      </div>
      <div className="lp-node lp-todo" style={{ transform: y(sunk ? 0 : 1) }}>
        <span className="lp-check" />
        <span className="lp-title">Prepare the demo</span>
      </div>
      <div className={'lp-node done ' + (sunk ? 'lp-stack' : 'lp-todo')} style={{ transform: y(sunk ? 1 : 2) }}>
        {sunk && (
          <>
            <span className="lp-layer l2" />
            <span className="lp-layer l1" />
          </>
        )}
        <span className="lp-check on">
          <svg viewBox="0 0 16 16">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
        <span className="lp-title">
          Book the room
          {sunk && <small>+1 more done</small>}
        </span>
        {sunk && <span className="lp-count">2</span>}
      </div>
    </div>
  );
}

const DUE_MS = [1100, 1100, 1100];
/** 3. A deadline coming closer. */
export function DueSoon() {
  const { ref, step } = usePlay(4, DUE_MS);
  const states = [
    { label: 'Fri 31 Oct', cls: 'later', left: '9 days left' },
    { label: 'Mon 27 Oct', cls: 'later', left: '5 days left' },
    { label: 'Thursday', cls: 'soon', left: '2 days left' },
    { label: 'Tomorrow', cls: 'urgent', left: '1 day left' },
  ];
  const s = states[Math.max(0, step)];
  return (
    <div className="demo demo-due" ref={ref} aria-hidden="true">
      <div className={'lp-node lp-project wide ' + (s.cls === 'later' ? '' : s.cls)}>
        <Ring value={0.6} />
        <span className="lp-title">
          Quarterly report
          <small>3 of 5 done</small>
        </span>
        <span className={'lp-chip ' + s.cls}>{s.label}</span>
      </div>
      <ol className="due-scale">
        {states.map((x, i) => (
          <li key={x.left} className={(i <= Math.max(0, step) ? 'past ' : '') + 'lvl-' + x.cls}>
            {x.left}
          </li>
        ))}
      </ol>
    </div>
  );
}

const PREP_MS = [700, 800, 900, 900];
/** 4. Flag things for a meeting, then copy the agenda. */
export function Prepared() {
  const { ref, step } = usePlay(5, PREP_MS);
  return (
    <div className="demo demo-prep" ref={ref} aria-hidden="true">
      <div className="lp-node lp-todo">
        <span className="lp-check" />
        <span className="lp-title">Budget for the new site</span>
        {step >= 1 && <span className="lp-flag">? Standup</span>}
      </div>
      <div className="lp-node lp-todo done">
        <span className="lp-check on">
          <svg viewBox="0 0 16 16">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
        <span className="lp-title">Delete the legacy app</span>
        {step >= 2 && <span className="lp-flag mention">Standup</span>}
      </div>
      <div className={'agenda' + (step >= 3 ? ' in' : '')}>
        <div className="agenda-head">
          <b>Standup</b>
          <span className={'copied' + (step >= 4 ? ' on' : '')}>{step >= 4 ? 'Copied' : 'Copy list'}</span>
        </div>
        <p className="agenda-sec">Questions</p>
        <p>· Budget for the new site?</p>
        <p className="agenda-sec">Updates</p>
        <p>· Delete the legacy app (done)</p>
      </div>
    </div>
  );
}
