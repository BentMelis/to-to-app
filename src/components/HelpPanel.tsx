import { CookieSettings, InternalTrafficNote } from './ConsentBanner';

const SHORTCUTS: [React.ReactNode, string][] = [
  [<kbd key="t">Tab</kbd>, 'Add inside the selected item (then P, T or N)'],
  [<kbd key="e">Enter</kbd>, 'Add the next item of the same kind'],
  [<kbd key="s">Space</kbd>, 'Mark a todo done or not done'],
  [<kbd key="k">K</kbd>, 'Change type…'],
  [<kbd key="h">H</kbd>, 'Mark a todo or project as high priority (again to remove)'],
  [<kbd key="dl">D</kbd>, 'Set or change a deadline'],
  [<kbd key="n">N</kbd>, 'Write notes for the selected project or todo'],
  [<kbd key="q">Q</kbd>, 'Bring up at a meeting or with a person: ask (A) or mention (M)'],
  [<><kbd>F2</kbd> or <kbd>E</kbd></>, 'Rename'],
  [<kbd key="d">Delete</kbd>, 'Delete the item and everything inside it'],
  ['Arrow keys', 'Move between items'],
  [<><kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></>, 'Move the item up or down'],
  [<><kbd>Alt</kbd> + <kbd>→</kbd> <kbd>←</kbd></>, 'Tuck under the item above, or move out a level'],
  [<kbd key="st">S</kbd>, 'Stack finished items again'],
  [<><kbd>Shift</kbd> + <kbd>A</kbd></>, 'Archive a finished todo or complete project'],
  [<kbd key="c">C</kbd>, 'Collapse or expand'],
  [<kbd key="f">F</kbd>, 'Fit the tree on screen'],
  [<><kbd>W</kbd> then <kbd>1</kbd>–<kbd>9</kbd></>, 'Switch to another tree'],
  [<kbd key="m">M</kbd>, 'Move the selected item (and everything inside it) to another tree'],
  [<kbd key="l">L</kbd>, 'Mark as sensitive (again to unmark)'],
  [<><kbd>Shift</kbd> + <kbd>H</kbd></>, 'Hide or show sensitive items, e.g. while sharing your screen'],
  [<><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd></>, 'Undo'],
  [<><kbd>Shift</kbd> + <kbd>F10</kbd></>, 'Open the actions menu for the selected item'],
];

export function HelpPanel() {
  return (
    <section className="panel help" aria-label="How it works">
      <h2>Three kinds of things</h2>
      <table>
        <tbody>
          <tr><td><b>Project</b></td><td>A branch. It can hold anything, including other projects. Its ring fills as the todos inside get done.</td></tr>
          <tr><td><b>Todo</b></td><td>Something to tick off. Give it todos of its own to break it into steps.</td></tr>
          <tr><td><b>Note</b></td><td>Info to keep next to your work. No checkbox, doesn’t count toward progress.</td></tr>
        </tbody>
      </table>
      <h2 style={{ marginTop: 16 }}>Several trees</h2>
      <p className="lead">Keep areas of your life apart: work, personal, a side project. Each tree has its own projects, meetings, filters and settings. Switch with the tree name in the top-left corner, or press <kbd>W</kbd> and a number. Rename the top of a tree to rename the tree.</p>
      <h2 style={{ marginTop: 16 }}>Doing things with an item</h2>
      <p className="lead">Right-click an item, or click its <b>⋯</b> button, for everything you can do with it. Each action shows its shortcut, so you can skip the menu next time.</p>
      <h2 style={{ marginTop: 16 }}>Moving things</h2>
      <p className="lead">Drag an item onto another to put it inside, or onto its top or bottom edge to place it before or after. On a touchscreen, press and hold first.</p>
      <h2 style={{ marginTop: 16 }}>Shortcuts</h2>
      <table>
        <tbody>
          {SHORTCUTS.map(([k, v], i) => (
            <tr key={i}><td>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      <p>Finished todos turn grey and stack up at the bottom of their branch. Click a stack to look through it. A week after you tick them they move to the <b>Archive</b> (toolbar), where you can find, restore or delete them; anything you still have to bring up at a meeting stays. Archive something yourself with <kbd>Shift</kbd>+<kbd>A</kbd>. A project whose todos are all done keeps its place and shows <b>All done</b>, so you can add the next todo right away.</p>
      <p>Deadlines turn <span className="due-chip soon">orange</span> when 3 days or fewer are left and <span className="due-chip urgent">red</span> from the last day on, including overdue. High-priority items get a <span className="prio-badge" aria-hidden="true">!</span>.</p>
      <p>Projects and todos that nothing has happened to for a while (7 days by default) get a quiet <span className="idle-chip">idle</span> tag and a dashed border. Any change to the item or anything inside it counts as activity; folding doesn’t. Change the number of days, or turn it off, under <b>Filter</b>.</p>
      <p>Use <b>Filter</b> to show only high-priority, soon-due or idle items. The projects above them stay visible, faded, so you know where they live.</p>
      <p>Projects and todos have <b>notes</b> for longer context: press <kbd>N</kbd> or click the page icon next to the item. Notes can have headings, lists, checklists, quotes, code, links and tables: use the bar at the top, or type <kbd>#</kbd>, <kbd>-</kbd>, <kbd>[ ]</kbd> or <kbd>&gt;</kbd> at the start of a line. Items with notes show a filled icon.</p>
      <p>Press <kbd>Q</kbd> to bring an item up at a meeting or with a person: <b>ask</b> a question, or just <b>mention</b> it (“this is done”). Each meeting has its own colour; set them up under <b>Meetings → Edit</b>. The <b>Meetings</b> list shows per meeting what to ask and what to mention, and copies it as an agenda.</p>
      <p>With Focus on, selecting something fades everything outside its project and centres that project.</p>
      <p>Mark anything private as <b>sensitive</b> (<kbd>L</kbd>): money, people matters, personal things. Before you share your screen, press <kbd>Shift</kbd>+<kbd>H</kbd> or the eye button: those items, and everything inside them, turn into locked placeholders and are left out of meeting lists, filters and counts. It stays on until you turn it off. They also hide by themselves whenever you switch to another window or tab, e.g. to start sharing in Zoom or Teams.</p>
      <p>Drag empty space to move around. Pinch, or hold Ctrl/⌘ and scroll, to zoom.</p>
      <p>
        Everything you write stays in this browser. If you allowed it, we count visits and actions (like creating a tree) with Google Analytics,
        never what you write. <CookieSettings /> <InternalTrafficNote />
      </p>
    </section>
  );
}
