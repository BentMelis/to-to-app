# TwigList

**[twiglist.app](https://twiglist.app)** · A to-do list shaped like a tree. Projects branch into sub-projects, todos and notes.
Built with Next.js (App Router) and React, installable as a PWA, local-first.

The product was called *Todo Tree* during the proof of concept; that name survives only in internal identifiers
(the `todo-tree:` storage prefix, the `TodoTree` canvas component) so nobody's saved data is lost.

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

## Routes

| Route | What |
| --- | --- |
| `/` | Landing page (`src/components/landing/`). Returning visitors see "Open your trees"; the installed app skips it |
| `/app` | The app itself (`TreesApp`). The PWA starts here |
| `/robots.txt`, `/sitemap.xml` | Generated from `src/app/robots.ts` and `sitemap.ts`. Only `/` is listed; `/app` is disallowed (nothing to index) |

The name, domain and description live in `src/lib/site.ts` (`NEXT_PUBLIC_SITE_URL` overrides the domain for previews);
titles, the install manifest, canonical URLs and social previews read from there.

## What's new compared to the POC

- **Drag & drop** — drag an item onto another to put it inside, or onto its top/bottom edge to place it
  before/after. Type rules are enforced (no projects inside todos, nothing inside notes, no moving an item into itself).
  On touch devices: press and hold, then drag. `Esc` cancels. Keyboard: `Alt` + arrows still works.
- **Project focus** — selecting a project (or anything in it) fades everything outside that project and glides the
  camera to centre it. Toggle with the **Focus** button.
- **Finished items** — turn grey, sink to the bottom of their branch, and two or more stack into a single card.
  Click the stack (or `Enter`) to look through them; they restack when you move away, or press `S`.
- **Archive** (KAN-28) — a finished todo moves out of the tree 7 days after it was ticked (`doneAt`; fixed, no
  setting). A todo with steps goes as a whole; steps never on their own; todos with a meeting flag stay. Projects are
  never archived automatically, but a complete one can be by hand (`Shift+A`, also finished todos). Archived items keep
  counting as done (`arch` on the parent), so 8/10 stays 8/10; a project with only archived work shows
  “All done · N archived”. The *Archive* panel (toolbar) searches, restores (to the old place; if its project is
  archived too, the project comes back with just that item) and deletes for good. The archive is part of the tree
  document (`doc.archive`, doc v5), so it's in backups. Archiving is not activity for the idle heads-up and auto-archive
  is not an undo step. Logic in `src/lib/tree/archive.ts`.
- **Complete projects stay in the tree** (KAN-34) — a project whose todos are all done is *complete*, not *done*:
  it keeps its position, look and fold state, shows a full ring and “All done · N done”, is never stacked and stays
  visible with *Hide done*. Only todos (`isDone` in `model.ts`) step back. Complete still means no deadline warnings,
  no filter matches and no idle heads-up.
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
- **Notes on projects and todos** — press `N`, choose *Notes* in the item menu, or the page icon next to an item to
  open a centred notes dialog for longer context (links, decisions, who to ask). Notes are **rich text** (Tiptap):
  bold/italic/strikethrough, headings, bullet and numbered lists, checklists, quotes, inline code and code blocks, links
  (`Ctrl/⌘+K`; `Ctrl/⌘+click` opens) and tables, from a formatting bar or Markdown-style typing. They're stored as
  Markdown (GFM) in the tree; plain-text notes from before are converted on first load (document v4) and look the same.
  The editor is loaded only when notes are opened. It saves as you type (one undo step
  per editing session); Esc, ⌘/Ctrl+Enter, *Done* or clicking outside closes it. Items with notes show a filled page icon.
- **Notes preview** — hover the filled page icon (or stay on the item with the keyboard) to see the start of the notes
  in a small read-only card, formatted like the editor, without loading it. Long notes fade out; clicking the card opens
  the full notes. Not shown while dragging, editing or with a menu open; on touch, tapping the icon opens the notes.
- **Several trees** — keep work, personal and side projects apart. The tree name in the top-left corner (or `W`, then
  `1`–`9`) switches trees; the same menu creates them and has *Rename, reorder, delete…* (up to 10; the last one can't be
  deleted). Each tree has its own projects, meetings, filters, idle threshold, undo history, camera position and fold
  state, and the app reopens the last tree you used. Renaming the top of a tree renames the tree. Deleting asks for
  confirmation with the number of items and can be undone for 10 seconds. Backups are per tree. Existing data becomes
  the first tree automatically.
- **Move to tree** — `M` or *Move to tree…* moves the selected item with everything inside it to the top level of
  another tree (fresh ids, so no clashes). Meeting flags follow by meeting name; flags for meetings the other tree
  doesn't have are dropped, after a confirmation that names them. The toast offers *Undo* (puts it back in its old
  place and removes it from the other tree) and *Open* (switches there with the item selected). `Ctrl/⌘+Z` alone only
  restores the source tree. Logic in `src/lib/tree/moveTree.ts`.
- **Sensitive items** (KAN-20) — `L` (or *Sensitive* in the item menu) marks an item; `Shift+H` or the eye button hides
  every sensitive item and everything inside it, e.g. while sharing your screen. Hidden items render as a locked,
  blurred placeholder with none of their content in the DOM, can't be opened, edited or dragged, and are left out of
  meeting lists, the copied agenda, filters, idle markers and the hints on folded branches. The toggle is remembered per
  browser, for all trees (`hideSensitive` in `todo-tree:user-prefs`). Logic in `src/lib/tree/sensitive.ts`.
- **Item menu** (KAN-45) — right-click an item (or its hover `⋯` button, or `Shift+F10` / the Menu key) for every
  action on it, grouped, with its shortcut next to it; Delete last, in red. Right-click selects first; the browser's own
  menu stays on the empty canvas. Left-click only selects (the old bottom action bar is gone). Closes on `Esc`, outside
  click or after an action; arrow keys move through it; it flips to stay on screen. All shortcuts are unchanged.
  `src/components/ItemMenu.tsx`. **Revert:** build with `NEXT_PUBLIC_ITEM_ACTIONS=toolbar` to bring the action bar back
  and switch the menu off (`src/lib/flags.ts`).
- Backup download / restore (.json) of the open tree, self-hosted fonts (works fully offline, nothing sent to Google).

## Project layout

```
src/
  app/                  Next.js routes: layout, page, PWA manifest, global styles
  components/
    landing/            The landing page: animated hero tree, how-it-works demos, MCP preview (coming soon)
    TreesApp.tsx        The list of trees around the canvas: switching, creating, deleting (+ undo)
    TreeMenu.tsx        Tree switcher menu and "Rename, reorder, delete…"
    TodoTree.tsx        The canvas for one tree: state, camera (pan/zoom/focus), keyboard, drag & drop
    TreeNodeView.tsx    A single item + the finished-items stack card
    ItemMenu.tsx        Right-click / "⋯" menu with every action on an item (KAN-45)
    AppRoot.tsx         Local or signed in: sign-in, moving local trees, sign-out, account deletion
    Account.tsx         Sign-in panel, account button + menu, "Move your trees?" dialog
    MeetingsPanel.tsx   Per meeting/person: to ask, to mention; manage meetings
    FlagMenu.tsx        "Bring up … at" menu (ask / mention per meeting)
    DuePicker.tsx       Set / change / remove a deadline
    FilterMenu.tsx      High priority / due soon / idle filters + idle threshold
    NotesPanel.tsx      Centred notes dialog for a project or todo
    RichNotes.tsx       The rich text editor inside it (Tiptap, Markdown in/out, formatting bar)
    NotesPreviewCard.tsx Hover/keyboard preview card of an item's notes
    Toolbar.tsx, TypePicker.tsx, HelpPanel.tsx, icons.tsx, ServiceWorker.tsx
  lib/
    tree/types.ts       Node types and which types may contain which
    tree/trees.ts       The list of trees: add, rename, reorder, remove/restore (pure)
    tree/model.ts       Pure, immutable tree operations (add, move, moveTo, indent, toggle…) + stats
    tree/notesText.ts   Notes as Markdown: migrating plain text, escaping, plain-text previews
    tree/notesBlocks.ts The start of a note as simple blocks for the preview card (no editor needed)
    tree/activity.ts    Activity stamps (diffed centrally in the store) and idle detection
    tree/dates.ts       Deadline maths: days left, orange/red thresholds, labels
    tree/layout.ts      Visible tree (incl. done-stacking) and the tidy-tree layout
    tree/useTreeStore.ts  Document + undo/redo + debounced persistence
    cloud/              Signed in: Firebase Auth (client), API calls, CloudLibrary (sync, offline, conflicts), migration
    server/             API side: config, MongoDB client, token check, data access (store.ts)
    storage/index.ts    Library (list + one document per tree), StorageAdapter, per-tree preferences, import/export
public/sw.js            Offline service worker (production only)
```

## Accounts & sync (KAN-11, KAN-39 – KAN-43)

TwigList is free and works without an account: trees are kept in this browser (below). **Signing in** (Google or
Microsoft) keeps them in the account instead, synced across devices. Firebase is used **only for sign-in**; the trees are
stored in **MongoDB** through our own API, so the browser never talks to the database.

**Setup.** Copy `.env.example` to `.env.local` and fill it in (and add the same names in Vercel). Without these values the
app is exactly the local-only app: no *Sign in* button, and `/api/*` answers 503.

| Variable | What | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`, `…_APP_ID` | Firebase web app config (read at build time) | no |
| `MONGODB_URI`, `MONGODB_DB` | MongoDB Atlas connection string and database name (default `twiglist`) | **yes** |

In Firebase: *Authentication → Sign-in method*: enable **Google** and **Microsoft** (Microsoft needs an app registration in
Microsoft Entra ID with the redirect URI Firebase shows). *Authentication → Settings → Authorized domains*: add
`twiglist.app` and the Vercel preview domain. Use separate Firebase projects and MongoDB databases for dev and prod.

**How it works**

- `src/lib/cloud/auth.ts`: Firebase Auth, loaded only when someone signs in (or was signed in before in this browser), so
  local-only users never download it. Popup sign-in, redirect when popups are blocked.
- `src/app/api/…`: Next.js route handlers. Every request carries the Firebase ID token, verified with `firebase-admin`
  (`src/lib/server/auth.ts`); every query is scoped to that user (`src/lib/server/store.ts`). No service account key:
  verifying a token only needs the project id (Google's public keys). *Delete my account* deletes the data on the
  server, then the browser deletes the Firebase account (`deleteAccount` in `src/lib/cloud/auth.ts`); if the sign-in
  isn't recent, Firebase asks to confirm it first, before anything is deleted.

  | Method | Path | What |
  | --- | --- | --- |
  | GET / PATCH | `/api/trees` | The list (no documents) / reorder `{ order }` |
  | GET / PUT / PATCH / DELETE | `/api/trees/:id` | Read / save `{ doc, rev }` (rev 0 creates; stale rev → 409 with `current`) / rename / soft delete |
  | POST | `/api/trees/:id/restore` | Undo a delete |
  | GET / DELETE | `/api/me` | Profile (created on first sign-in) / delete all the account's data (the browser then deletes the sign-in) |
  | GET | `/api/me/export` | All data as JSON |
  | GET | `/api/status` | Whether accounts & sync are configured (no data) |

- `src/lib/cloud/library.ts`: the `CloudLibrary` implements the same `Library`/`StorageAdapter` interfaces as browser
  storage. Saves send the `rev` they're based on. **Conflicts**: last write wins, and the other version is offered
  (*Use the other version*), so nothing is lost silently. **Other devices**: changes are picked up on focus and every
  30 s; they arrive as an undo step. **Offline**: the account's trees and unsynced changes are cached in this browser
  (`todo-tree:cloud:<uid>:…`) and sent when back online. Signing out clears the cache.
- **First sign-in**: trees in this browser (except the untouched sample) can be moved into the account
  (`src/lib/cloud/migrate.ts`); a taken name gets “(this browser)”, max 10 trees. Later also from the account menu.
- Data model: `users` (`_id` = Firebase UID) and `trees` (one document per tree: `ownerId`, `treeId`, `name`, `order`,
  `doc`, `rev`, `deletedAt`…), unique index `{ ownerId, treeId }`. Deleted trees are kept 30 days, then purged. See
  Confluence *TwigList – Cloud data model*.
- The service worker never caches `/api/*`.

**Tests**: `npm test` runs everything; the MongoDB tests (`src/lib/server/__tests__`) run when `MONGODB_TEST_URI` points
at a MongoDB (e.g. `docker run -p 27017:27017 mongo:8`, then `MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test`).
Locally you can sign in without Google/Microsoft through the Firebase Auth emulator
(`npx firebase-tools emulators:start --only auth`, see the emulator lines in `.env.example`).

## Data & storage

Everything is stored in the browser (`localStorage`). The keys keep the old `todo-tree:` prefix on purpose:
renaming them would strand the data people already have.

| Key | What |
| --- | --- |
| `todo-tree:trees` | The list of trees (id, name, order) and which one was open last |
| `todo-tree:tree:<id>` | One tree: its root, meetings and settings (`TreeDoc`) |
| `todo-tree:view:<id>`, `todo-tree:filters:<id>`, `todo-tree:meeting:<id>` | Per-tree viewing preferences (camera, filters, last meeting tab) |
| `todo-tree:user-prefs` | View preferences for all trees (KAN-44): `focus`, `hideDone`, `hideSensitive`. Defaults: focus on, everything shown. `src/lib/storage/userPrefs.ts`; replaces the old `todo-tree:hide-sensitive` key. Moves to the account with KAN-43 |
| `todo-tree:account` | Signed in: who (uid, name, email, photo), so the app knows to load Firebase at start. Not a credential |
| `todo-tree:cloud:<uid>:…` | Signed in: cache of the account's trees and unsynced changes (offline). Cleared on sign-out |
| `todo-tree:v1` | The single tree from before multiple trees (and the POC). Migrated into the first tree on first start and left untouched as a safety copy |

Storage goes through the `Library` and `StorageAdapter` interfaces in `src/lib/storage`, so a server-backed version
(accounts + sync, KAN-11) can be added later without touching the UI. It should keep the same shape: one document per
tree, plus the small list.

## Analytics

Google Analytics 4 (`G-NE8N3PVBMS`, override with `NEXT_PUBLIC_GA_ID`), see `src/lib/analytics.ts`:

- **Consent first.** A small banner asks on the first visit. Google's script only loads after *Accept*; with *Decline*
  (or the browser's Global Privacy Control) nothing is sent. The choice is stored in this browser (`todo-tree:consent`) and can
  be changed under *Cookie settings* (landing page footer, and the `?` help panel in the app). Withdrawing removes the `_ga` cookies.
- **Internal traffic.** Open any page with `?internal=1` to mark this browser as ours (`todo-tree:internal`); GA then
  gets `traffic_type: 'internal'` and the *Internal traffic* data filter leaves it out. `?internal=0` undoes it; the
  help panel shows an *Internal traffic* chip while it's on.
- **No content, ever.** Events only say what happened: `open_app` (from nav/hero/closing/footer), `todo_completed` (steps), `tree_created`,
  `tree_switched`, `tree_deleted`, `notes_opened`, `filter_used` (which filters), `meeting_list_copied`, `backup_downloaded`,
  `backup_restored`, `item_moved_to_tree` (kind, items, flags kept/dropped), `sensitive_marked` (on), `sensitive_view_toggled` (hidden), `items_archived` (how, items, kind), `archive_opened`, `archive_restored`, `archive_deleted` (items), `item_menu_opened` (via: right_click / button / keyboard), `item_menu_action` (action key, e.g. `rename`, `delete`), `signed_in` (method), `signed_out`, `account_deleted`, `sync_conflict`, `local_trees_moved` (trees, left). Never titles, notes, tree or meeting names. Google signals and ad personalisation are off.
- To add an event: add its name to `AppEvent`, call `track('name')`, and add it to the Confluence page
  [TwigList – Analytics events](https://eanv.atlassian.net/wiki/spaces/SideQuest/pages/22183938/Todo+Tree+Analytics+events)
  (what fires when, parameters, file:line).

## Deploying

Any Node host or Vercel works (`npm run build && npm start`). After changing cached assets, bump `CACHE` in
`public/sw.js` so installed copies refresh.
