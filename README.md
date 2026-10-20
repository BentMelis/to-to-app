# Todo tree

A todo list shaped like a tree. Projects branch into sub-projects, todos and notes.
Built with Next.js (App Router) and React, installable as a PWA, local-first.

The original single-file proof of concept lives in [`poc/`](./poc) for reference.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` / `npm start` | Production build / serve it |
| `npm test` | Unit tests for the tree model (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## What's new compared to the POC

- **Drag & drop** — drag an item onto another to put it inside, or onto its top/bottom edge to place it
  before/after. Type rules are enforced (no projects inside todos, nothing inside notes, no moving an item into itself).
  On touch devices: press and hold, then drag. `Esc` cancels. Keyboard: `Alt` + arrows still works.
- **Project focus** — selecting a project (or anything in it) fades everything outside that project and glides the
  camera to centre it. Toggle with the **Focus** button.
- **Finished items** — turn grey, sink to the bottom of their branch, and two or more stack into a single card.
  Click the stack (or `Enter`) to look through them; they restack when you move away, or press `S`.
- **Meetings & people** — press `Q` (or *Bring up…*) to flag an item for a meeting or a person: **ask** a question
  (solid `?` tag) or just **mention** it, e.g. "this is done" (outlined megaphone tag). Each meeting/person has its own
  colour; manage them under **Meetings → Edit** (up to 9: standup, weekly sync, a stakeholder…). The **Meetings** panel
  shows per meeting *To ask* and *To mention* (finished items marked *Done ✓*), jumps to items, clears them once raised,
  and copies a ready-to-paste agenda. Old "open question for standup" flags are migrated automatically.
- **Priority & deadlines** — `H` marks a todo or project as high priority (purple `!`). `D` sets a deadline
  (quick picks: today, tomorrow, next Monday, in a week, or any date). The item turns **orange** when 3 days or fewer
  are left and **red** from the last day on (due tomorrow, today or overdue). A collapsed branch hiding such an item
  shows the colour on its fold button. Finished items never warn. Colours update by themselves when the day changes.
- **Filters** — the **Filter** menu shows only open *high-priority* items and/or items *due soon* (orange/red),
  plus the path above them (faded) and everything inside them. Filters combine as "any of", open folded branches
  that hide a match, and are remembered per browser.
- **Idle heads-up** — every item remembers when it last changed (title, done, kind, flags, priority, deadline, notes,
  what's inside it, or where it lives; folding doesn't count). An open todo or project with no activity anywhere in its
  branch for N days (default 7; 3/7/14/30 or off, set in the **Filter** menu, stored in the document) gets a dashed
  border and a quiet `Nd idle` tag. Only the topmost idle item of a branch is tagged, a collapsed branch hiding one gets a
  dashed fold button, and **Filter → Idle** shows just those. Trees from before this feature start fresh from the day they're opened.
- **Notes on projects and todos** — press `N`, click *Notes* in the action bar, or the page icon next to an item to
  open a centred notes dialog for longer context (links, decisions, who to ask). Notes are **rich text** (Tiptap):
  bold/italic/strikethrough, headings, bullet and numbered lists, checklists, quotes, inline code and code blocks, links
  (`Ctrl/⌘+K`; `Ctrl/⌘+click` opens) and tables, from a formatting bar or Markdown-style typing. They're stored as
  Markdown (GFM) in the tree; plain-text notes from before are converted on first load (document v4) and look the same.
  The editor is loaded only when notes are opened. It saves as you type (one undo step
  per editing session); Esc, ⌘/Ctrl+Enter, *Done* or clicking outside closes it. Items with notes show a filled page icon.
- **Several trees** — keep work, personal and side projects apart. The tree name in the top-left corner (or `W`, then
  `1`–`9`) switches trees; the same menu creates them and has *Rename, reorder, delete…* (up to 10; the last one can't be
  deleted). Each tree has its own projects, meetings, filters, idle threshold, undo history, camera position and fold
  state, and the app reopens the last tree you used. Renaming the top of a tree renames the tree. Deleting asks for
  confirmation with the number of items and can be undone for 10 seconds. Backups are per tree. Existing data becomes
  the first tree automatically.
- Backup download / restore (.json) of the open tree, self-hosted fonts (works fully offline, nothing sent to Google).

## Project layout

```
src/
  app/                  Next.js routes: layout, page, PWA manifest, global styles
  components/
    TreesApp.tsx        The list of trees around the canvas: switching, creating, deleting (+ undo)
    TreeMenu.tsx        Tree switcher menu and "Rename, reorder, delete…"
    TodoTree.tsx        The canvas for one tree: state, camera (pan/zoom/focus), keyboard, drag & drop
    TreeNodeView.tsx    A single item + the finished-items stack card
    MeetingsPanel.tsx   Per meeting/person: to ask, to mention; manage meetings
    FlagMenu.tsx        "Bring up … at" menu (ask / mention per meeting)
    DuePicker.tsx       Set / change / remove a deadline
    FilterMenu.tsx      High priority / due soon / idle filters + idle threshold
    NotesPanel.tsx      Centred notes dialog for a project or todo
    RichNotes.tsx       The rich text editor inside it (Tiptap, Markdown in/out, formatting bar)
    Toolbar.tsx, TypePicker.tsx, HelpPanel.tsx, icons.tsx, ServiceWorker.tsx
  lib/
    tree/types.ts       Node types and which types may contain which
    tree/trees.ts       The list of trees: add, rename, reorder, remove/restore (pure)
    tree/model.ts       Pure, immutable tree operations (add, move, moveTo, indent, toggle…) + stats
    tree/notesText.ts   Notes as Markdown: migrating plain text, escaping, plain-text previews
    tree/activity.ts    Activity stamps (diffed centrally in the store) and idle detection
    tree/dates.ts       Deadline maths: days left, orange/red thresholds, labels
    tree/layout.ts      Visible tree (incl. done-stacking) and the tidy-tree layout
    tree/useTreeStore.ts  Document + undo/redo + debounced persistence
    storage/index.ts    Library (list + one document per tree), StorageAdapter, per-tree preferences, import/export
public/sw.js            Offline service worker (production only)
```

## Data & storage

Everything is stored in the browser (`localStorage`):

| Key | What |
| --- | --- |
| `todo-tree:trees` | The list of trees (id, name, order) and which one was open last |
| `todo-tree:tree:<id>` | One tree: its root, meetings and settings (`TreeDoc`) |
| `todo-tree:view:<id>`, `todo-tree:filters:<id>`, `todo-tree:meeting:<id>` | Per-tree viewing preferences (camera, filters, last meeting tab) |
| `todo-tree:v1` | The single tree from before multiple trees (and the POC). Migrated into the first tree on first start and left untouched as a safety copy |

Storage goes through the `Library` and `StorageAdapter` interfaces in `src/lib/storage`, so a server-backed version
(accounts + sync, KAN-11) can be added later without touching the UI. It should keep the same shape: one document per
tree, plus the small list.

## Deploying

Any Node host or Vercel works (`npm run build && npm start`). After changing cached assets, bump `CACHE` in
`public/sw.js` so installed copies refresh.
