'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HeroTree } from './HeroTree';
import { BreakDown, DueSoon, FinishIt, Prepared } from './FlowDemos';
import { McpDemo } from './McpDemo';
import { track } from '@/lib/analytics';
import { CookieSettings } from '../ConsentBanner';

/** Someone who already has trees in this browser gets "Open your trees"; the installed app skips the landing page. */
function useReturning() {
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    let has = false;
    try {
      has = !!(localStorage.getItem('todo-tree:trees') || localStorage.getItem('todo-tree:v1'));
    } catch {
      /* storage blocked: treat as a new visitor */
    }
    if (has && window.matchMedia('(display-mode: standalone)').matches) {
      router.replace('/app');
      return;
    }
    // Reading browser storage can only happen after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReturning(has);
  }, [router]);
  return returning;
}

function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="10" width="8" height="8" rx="2" />
      <path d="M10 14c4 0 4-7 8-7M10 14c4 0 4 7 8 7" />
      <circle cx="21" cy="7" r="3.2" />
      <circle cx="21" cy="21" r="3.2" />
    </svg>
  );
}

const STEPS = [
  {
    n: 1,
    title: 'Break it down',
    text: 'Start with the project. Tab adds what’s inside it, Enter adds the next one. A todo that’s still too big gets steps of its own, as deep as you like.',
    demo: <BreakDown />,
  },
  {
    n: 2,
    title: 'Finish and forget',
    text: 'Tick something off and it turns grey, sinks below the open work and stacks with everything else that’s done. Still there when you want it, out of the way when you don’t.',
    demo: <FinishIt />,
  },
  {
    n: 3,
    title: 'Dates that speak up',
    text: 'Give a todo or project a deadline. Three days out it turns orange, on the last day red. A folded branch shows the colour too, so nothing urgent hides.',
    demo: <DueSoon />,
  },
  {
    n: 4,
    title: 'Walk in prepared',
    text: 'Flag items to ask or mention at a meeting or with a person: standup, the weekly sync, a stakeholder. Before the meeting, copy the list. That’s your agenda.',
    demo: <Prepared />,
  },
];

const EXTRAS: { title: string; text: string; art: React.ReactNode }[] = [
  {
    title: 'Separate trees',
    text: 'Work, personal, a side project. Each tree has its own meetings and filters, so a screen share only shows what it should.',
    art: (
      <span className="x-switch">
        Work <span aria-hidden="true">▾</span>
      </span>
    ),
  },
  {
    title: 'Notes with structure',
    text: 'Headings, checklists, links and tables in the notes of any project or todo.',
    art: (
      <span className="x-note">
        <b>Kickoff</b>
        <span>☑ Brief Anna</span>
        <span>☐ Book a room</span>
      </span>
    ),
  },
  {
    title: 'A nudge for stalled work',
    text: 'Nothing happened to it for a week? It gets a quiet marker, so you pick it up or park it on purpose.',
    art: <span className="x-idle">9d idle</span>,
  },
  {
    title: 'Filters that keep context',
    text: 'Show only what’s high priority, due soon or idle, with the projects above each match still in view.',
    art: (
      <span className="x-filter">
        High priority <b>3</b>
      </span>
    ),
  },
  {
    title: 'Made for the keyboard',
    text: 'Tab, Enter, Space and Alt + arrows for nearly everything, and undo for every step.',
    art: (
      <span className="x-keys">
        <kbd>Tab</kbd>
        <kbd>Space</kbd>
        <kbd>⌘Z</kbd>
      </span>
    ),
  },
  {
    title: 'Works offline',
    text: 'Install it from your browser as an app. It keeps working on the train.',
    art: <span className="x-saved">Saved in this browser</span>,
  },
];

export default function Landing() {
  const returning = useReturning();
  const cta = returning ? 'Open your trees' : 'Open TwigList';

  return (
    <div className="landing">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="lp-nav">
        <Link href="/" className="brand" aria-label="TwigList home">
          <Logo />
          <span>TwigList</span>
        </Link>
        <Link href="/app" className="btn small" onClick={() => track('open_app', { from: 'nav' })}>
          {cta}
        </Link>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Plan in branches,
              <br />
              not in lists.
            </h1>
            <p className="lede">
              TwigList lays all your projects out as one tree you can take in at a glance. Break work down as far as you need, tick it off, and
              walk into every meeting knowing what to ask.
            </p>
            <div className="hero-cta">
              <Link href="/app" className="btn" onClick={() => track('open_app', { from: 'hero' })}>
                {cta}
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </Link>
              <a href="#how" className="text-link">
                See how it works
              </a>
            </div>
            <p className="fine">Free, in your browser. No account, and your trees stay on your device.</p>
          </div>
          <HeroTree />
        </section>

        <section className="how" id="how" aria-labelledby="how-title">
          <h2 id="how-title">
            A week of work, <em>branch by branch</em>
          </h2>
          <ol className="trunk">
            {STEPS.map((s) => (
              <li key={s.n} className="branch">
                <div className="branch-copy">
                  <span className="branch-n" aria-hidden="true">
                    {s.n}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
                {s.demo}
              </li>
            ))}
          </ol>
        </section>

        <section className="extras" aria-labelledby="extras-title">
          <h2 id="extras-title">And the small things that keep it useful</h2>
          <dl>
            {EXTRAS.map((x) => (
              <div key={x.title} className="extra">
                <div className="extra-art" aria-hidden="true">
                  {x.art}
                </div>
                <dt>{x.title}</dt>
                <dd>{x.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mcp" id="mcp" aria-labelledby="mcp-title">
          <div className="mcp-copy">
            <p className="soon">Coming soon</p>
            <h2 id="mcp-title">Your AI assistant, working in your tree</h2>
            <p>
              We’re adding support for <b>MCP</b>, the Model Context Protocol: the open standard AI assistants use to work with other tools. Once it’s
              there, you can ask Claude or another MCP-compatible assistant to read your trees and add, tick off or flag items for you, in plain
              language.
            </p>
            <ul className="mcp-uses">
              <li>Turn the notes from a call into todos under the right project</li>
              <li>Ask what’s due this week, across all your trees</li>
              <li>Have tomorrow’s standup list ready before you’ve had coffee</li>
            </ul>
            <p className="fine">Not available yet. The conversation shown here is an example of what we’re building.</p>
          </div>
          <McpDemo />
        </section>

        <section className="privacy" aria-label="Your data">
          <p>
            Your trees live <em>in your browser</em>. No account, nothing you write leaves your device, and it works offline. Sync between your
            devices is next on the roadmap.
          </p>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div className="closing-tree" aria-hidden="true">
            <span className="seed" />
            <svg viewBox="0 0 240 120">
              <path pathLength={1} d="M20 60C70 60,70 22,120 22" />
              <path pathLength={1} d="M20 60C70 60,70 98,120 98" />
              <path pathLength={1} d="M120 22C165 22,165 6,210 6" />
              <path pathLength={1} d="M120 22C165 22,165 38,210 38" />
              <circle cx="210" cy="6" r="6" />
              <circle cx="210" cy="38" r="6" />
              <circle cx="120" cy="98" r="6" />
            </svg>
          </div>
          <h2 id="closing-title">Start with one project.</h2>
          <p>It takes about ten seconds, and the rest grows from there.</p>
          <Link href="/app" className="btn" onClick={() => track('open_app', { from: 'closing' })}>
            {cta}
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand small">
          <Logo />
          TwigList
        </span>
        <span>A SideQuest project</span>
        <CookieSettings />
        <Link href="/app" onClick={() => track('open_app', { from: 'footer' })}>
          Open the app
        </Link>
      </footer>
    </div>
  );
}
