const SHORTCUTS: [React.ReactNode, string][] = [
  [<kbd key="t">Tab</kbd>, 'Add inside the selected item (then P, T or N)'],
  [<kbd key="e">Enter</kbd>, 'Add the next item of the same kind'],
  [<kbd key="s">Space</kbd>, 'Mark a todo done or not done'],
  [<kbd key="k">K</kbd>, 'Change what kind of item it is'],
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
  [<kbd key="c">C</kbd>, 'Collapse or expand'],
  [<kbd key="f">F</kbd>, 'Fit the tree on screen'],
  [<><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd></>, 'Undo'],
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
      <p>Finished items turn grey and stack up at the bottom of their branch. Click a stack to look through it.</p>
      <p>Deadlines turn <span className="due-chip soon">orange</span> when 3 days or fewer are left and <span className="due-chip urgent">red</span> from the last day on, including overdue. High-priority items get a <span className="prio-badge" aria-hidden="true">!</span>.</p>
      <p>Use <b>Filter</b> to show only high-priority or soon-due items. The projects above them stay visible, faded, so you know where they live.</p>
      <p>Projects and todos have a <b>notes</b> page for longer context: press <kbd>N</kbd> or click the page icon next to the item. Items with notes show a filled icon.</p>
      <p>Press <kbd>Q</kbd> to bring an item up at a meeting or with a person: <b>ask</b> a question, or just <b>mention</b> it (“this is done”). Each meeting has its own colour; set them up under <b>Meetings → Edit</b>. The <b>Meetings</b> list shows per meeting what to ask and what to mention, and copies it as an agenda.</p>
      <p>With Focus on, selecting something fades everything outside its project and centres that project.</p>
      <p>Drag empty space to move around. Pinch, or hold Ctrl/⌘ and scroll, to zoom.</p>
    </section>
  );
}
