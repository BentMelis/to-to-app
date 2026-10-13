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
- Backup download / restore (.json), self-hosted fonts (works fully offline, nothing sent to Google).

## Project layout

```
src/
  app/                  Next.js routes: layout, page, PWA manifest, global styles
  components/
    TodoTree.tsx        The canvas: state, camera (pan/zoom/focus), keyboard, drag & drop
    TreeNodeView.tsx    A single item + the finished-items stack card
    Toolbar.tsx, TypePicker.tsx, HelpPanel.tsx, icons.tsx, ServiceWorker.tsx
  lib/
    tree/types.ts       Node types and which types may contain which
    tree/model.ts       Pure, immutable tree operations (add, move, moveTo, indent, toggle…) + stats
    tree/layout.ts      Visible tree (incl. done-stacking) and the tidy-tree layout
    tree/useTreeStore.ts  Document + undo/redo + debounced persistence
    storage/index.ts    StorageAdapter interface, localStorage adapter, import/export
public/sw.js            Offline service worker (production only)
```

## Data & storage

Everything is stored in the browser (`localStorage`, key `todo-tree:v1` — the same key the POC used, so existing
trees carry over when served from the same origin). Storage goes through the `StorageAdapter` interface in
`src/lib/storage`, so a server-backed adapter (accounts + sync) can be added later without touching the UI.

## Deploying

Any Node host or Vercel works (`npm run build && npm start`). After changing cached assets, bump `CACHE` in
`public/sw.js` so installed copies refresh.
