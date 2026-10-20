'use client';

import { useRef } from 'react';
import { useInView, useReducedMotion, useSequence } from './hooks';

const MS = [900, 900, 700, 700, 700, 900, 4000];

/**
 * What MCP support will feel like: you ask your assistant in your own words, it works in your tree.
 * Clearly an example of something that's planned, not a live integration.
 */
export function McpDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const seen = useInView(ref, 0.4);
  const raw = useSequence(seen && !reduced, MS.length, MS, true);
  const step = reduced ? MS.length - 1 : raw;
  const added = ['Send the revised quote', 'Ask Anna for the brand files', 'Plan the launch date'];

  return (
    <div className="mcp-demo" ref={ref} aria-label="Example: asking an AI assistant to update your tree">
      <div className="mcp-chat">
        <div className={'bubble you' + (step >= 0 ? ' in' : '')}>
          Add the action points from today’s call with Anna under <b>Website relaunch</b>, and flag the budget question for Thursday’s standup.
        </div>
        <ul className="tool-calls">
          {added.map((t, i) => (
            <li key={t} className={step >= i + 1 ? 'in' : ''}>
              <code>add_todo</code> {t}
            </li>
          ))}
          <li className={step >= 4 ? 'in' : ''}>
            <code>flag_for_meeting</code> Budget for the new site → Standup
          </li>
        </ul>
        <div className={'bubble them' + (step >= 5 ? ' in' : '')}>Done: three todos added under Website relaunch, and the budget question is on Thursday’s standup list.</div>
      </div>

      <div className="mcp-tree" aria-hidden="true">
        <div className="lp-node lp-project">
          <span className="lp-title">Website relaunch</span>
        </div>
        <ul>
          <li className="lp-node lp-todo in">
            <span className="lp-check" />
            <span className="lp-title">Budget for the new site</span>
            {step >= 4 && <span className="lp-flag">? Standup</span>}
          </li>
          {added.map((t, i) => (
            <li key={t} className={'lp-node lp-todo' + (step >= i + 1 ? ' in fresh' : '')}>
              <span className="lp-check" />
              <span className="lp-title">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
