/**
 * The TwigList MCP server: tools for AI assistants to read a user's trees and add or change projects and
 * todos. One server per request (stateless), scoped to the signed-in user behind the OAuth token.
 *
 * Changes are saved like any other device's: with the tree's `rev`. If the app saved in between (409), the tree is
 * read again and the change applied again, so nothing anyone did is lost. Open apps pick the change up on focus or
 * within 30 seconds. Nothing can be deleted through MCP; sensitive items stay hidden (see ops.ts).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Db } from 'mongodb';
import { emptyTree, MAX_TREES } from '@/lib/tree/trees';
import { DUE_RE } from '@/lib/tree/dates';
import type { ChildType } from '@/lib/tree/types';
import { getTree, listTrees, saveTree, StoreError } from '@/lib/server/store';
import * as Ops from './ops';

const INSTRUCTIONS = `TwigList is a to-do app shaped like a tree. A user has up to ${MAX_TREES} trees (e.g. Work, Personal).
In a tree: projects hold projects, todos and notes; todos hold smaller todos (steps) and notes; notes hold nothing.
Finished todos stay in the tree for a week, then move to an archive.
Start with list_trees or get_tree to see what exists; items have ids you can pass to the other tools.
Items can also be named by their exact title. Without a tree, the first tree is used.
Sensitive items are hidden from you on purpose; don't ask the user to reveal them.
You can add and change items but not delete them: tell the user to delete things in the app.
Deadlines are dates (YYYY-MM-DD). Keep titles short, like the user's own; put details in notes (Markdown).`;

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string): Text => ({ content: [{ type: 'text', text: t }] });
const fail = (t: string): Text => ({ content: [{ type: 'text', text: t }], isError: true });

const today = (given?: string) =>
  given && DUE_RE.test(given) ? given : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());

type Loaded = Ops.TreeRef & { rev: number };

async function loadTrees(db: Db, uid: string): Promise<Loaded[]> {
  const metas = await listTrees(db, uid);
  return Promise.all(metas.map(async (m) => ({ ...(await getTree(db, uid, m.id)), id: m.id, name: m.name })));
}

/**
 * Load the trees, work out the change, save it with the version check; on a conflict start over with the newer
 * version (up to 4 times).
 */
async function change(db: Db, uid: string, plan: (trees: Loaded[]) => { tree: Loaded; change: Ops.Change } | { error: string }): Promise<Text> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let trees = await loadTrees(db, uid);
    if (!trees.length) {
      // A new account without trees: start one, as the app would.
      await saveTree(db, uid, 'main', { doc: emptyTree('My projects'), rev: 0, name: 'My projects' }).catch(() => {});
      trees = await loadTrees(db, uid);
    }
    const p = plan(trees);
    if ('error' in p) return fail(p.error);
    if ('error' in p.change) return fail(p.change.error);
    try {
      await saveTree(db, uid, p.tree.id, { doc: p.change.doc, rev: p.tree.rev });
      return text(p.change.message);
    } catch (e) {
      if (e instanceof StoreError && e.status === 409) continue;
      throw e;
    }
  }
  return fail('The tree kept changing while saving (someone is editing it). Please try again.');
}

/** The tree named by `tree`, or the tree that holds `item`. */
function scope(trees: Loaded[], treeRef?: string): Loaded[] | { error: string } {
  if (!treeRef?.trim()) return trees;
  const t = Ops.findTree(trees, treeRef);
  return 'error' in t ? t : [t as Loaded];
}

const treeArg = z.string().max(100).optional().describe('Tree id or name. Optional: without it, items are looked up in all trees, and new items go to the first tree.');
const itemArg = (what: string) => z.string().min(1).max(300).describe(`${what}: an item id (from get_tree or search) or its exact title.`);
const dueArg = z
  .string()
  .regex(DUE_RE, 'Use YYYY-MM-DD')
  .nullable()
  .optional()
  .describe('Deadline as YYYY-MM-DD, or null to remove it. Projects and todos only.');

export function createMcpServer(db: Db, uid: string) {
  const server = new McpServer({ name: 'twiglist', title: 'TwigList', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    'list_trees',
    { title: 'List trees', description: 'The user’s trees (areas like Work or Personal), with how many open todos each has.', inputSchema: {}, annotations: READ },
    async () => {
      const trees = await loadTrees(db, uid);
      if (!trees.length) return text('No trees yet. Adding a project or todo creates the first one.');
      const lines = trees.map((t) => {
        const c = Ops.counts(t);
        return `- ${t.name} (tree id: ${t.id}) · ${c.open} open todo${c.open === 1 ? '' : 's'}, ${c.projects} project${c.projects === 1 ? '' : 's'}`;
      });
      return text(`Trees:\n${lines.join('\n')}\n\nUse get_tree to see what’s in one.`);
    },
  );

  server.registerTool(
    'get_tree',
    {
      title: 'Show a tree',
      description:
        'An outline of a tree, or of one project or todo inside it: titles, ids, done state, deadlines, priority. Finished todos are summarised unless include_done.',
      inputSchema: {
        tree: treeArg,
        item: z.string().max(300).optional().describe('Show only this project or todo (id or exact title).'),
        include_done: z.boolean().optional().describe('Also list finished todos.'),
        include_notes: z.boolean().optional().describe('Also show the notes of each item (can be long).'),
        today: z.string().regex(DUE_RE).optional().describe('Today as YYYY-MM-DD, for “due in N days”. Defaults to the server’s date.'),
      },
      annotations: READ,
    },
    async ({ tree, item, include_done, include_notes, today: t }) => {
      const trees = await loadTrees(db, uid);
      const s = scope(trees, tree);
      if ('error' in s) return fail(s.error);
      if (item) {
        const f = Ops.findItem(s, item);
        if ('error' in f) return fail(f.error);
        return text(Ops.outline(f.tree, { itemId: f.node.id, includeDone: include_done, notes: include_notes, today: today(t) }));
      }
      const target = tree ? s[0] : trees[0];
      if (!target) return text('No trees yet.');
      return text(Ops.outline(target, { includeDone: include_done, notes: include_notes, today: today(t) }));
    },
  );

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: 'Find projects, todos and notes by words in their title or notes, across all trees (or one).',
      inputSchema: { query: z.string().min(1).max(200), tree: treeArg },
      annotations: READ,
    },
    async ({ query, tree }) => {
      const trees = await loadTrees(db, uid);
      const s = scope(trees, tree);
      if ('error' in s) return fail(s.error);
      const hits = Ops.search(s, query);
      if (!hits.length) return text(`Nothing matches “${query}”.`);
      return text(
        hits
          .map((h) => `- ${h.type === 'todo' ? (h.done ? '[x]' : '[ ]') : `[${h.type}]`} ${h.title} (id: ${h.id}) in ${h.path}${h.due ? ` · due ${h.due}` : ''}${h.high ? ' · high priority' : ''}`)
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'upcoming',
    {
      title: 'What’s due',
      description: 'Open projects and todos that are overdue or due within the next days, plus open high-priority items, across all trees. Good for “what should I work on?”.',
      inputSchema: {
        days: z.number().int().min(0).max(90).optional().describe('How many days ahead (default 7).'),
        today: z.string().regex(DUE_RE).optional().describe('Today as YYYY-MM-DD. Defaults to the server’s date.'),
      },
      annotations: READ,
    },
    async ({ days, today: t }) => {
      const trees = await loadTrees(db, uid);
      const d = today(t);
      const u = Ops.upcoming(trees, d, days ?? 7);
      if (!u.due.length && !u.high.length) return text(`Nothing due in the next ${days ?? 7} days, and no open high-priority items.`);
      const when = (n: number) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
      const out: string[] = [];
      if (u.due.length) out.push(`Due (today is ${d}):`, ...u.due.map((h) => `- ${h.title} (id: ${h.id}) · ${h.due}, ${when(h.daysLeft)}${h.high ? ' · high priority' : ''} · ${h.path}`));
      if (u.high.length) out.push('', 'High priority, no deadline soon:', ...u.high.map((h) => `- ${h.title} (id: ${h.id}) · ${h.path}`));
      return text(out.join('\n').trim());
    },
  );

  const adder = (type: ChildType, title: string, description: string, withDetails: boolean) =>
    server.registerTool(
      `add_${type}`,
      {
        title,
        description,
        inputSchema: {
          title: z.string().min(1).max(300).describe('Short title.'),
          parent: z
            .string()
            .max(300)
            .optional()
            .describe(`Where to put it: a ${type === 'project' ? 'project' : 'project or todo'} (id or exact title). Without it: the top level of the tree.`),
          tree: treeArg,
          ...(withDetails
            ? {
                notes: z.string().max(20_000).optional().describe('Longer details, Markdown.'),
                due: dueArg,
                high: z.boolean().optional().describe('High priority.'),
              }
            : {}),
        },
        annotations: WRITE,
      },
      async (args: { title: string; parent?: string; tree?: string; notes?: string; due?: string | null; high?: boolean }) =>
        change(db, uid, (trees) => {
          const s = scope(trees, args.tree);
          if ('error' in s) return s;
          if (args.parent?.trim()) {
            const f = Ops.findItem(s, args.parent);
            if ('error' in f) return f;
            const tree = f.tree as Loaded;
            return { tree, change: Ops.addItem(tree, f.node, type, args) };
          }
          const tree = (args.tree ? s[0] : trees[0]) as Loaded;
          return { tree, change: Ops.addItem(tree, null, type, args) };
        }),
    );
  adder('project', 'Add a project', 'Add a project (a branch that holds todos, notes and sub-projects) at the top of a tree or inside another project.', true);
  adder('todo', 'Add a todo', 'Add a todo to a project, or as a step inside another todo, or at the top level of a tree. Optional notes, deadline and priority.', true);
  adder('note', 'Add a note item', 'Add a short note item (a fact to keep next to the work, e.g. “budget is 5k”) to a project or todo. Notes can’t be ticked off.', false);

  server.registerTool(
    'complete_todo',
    {
      title: 'Tick off a todo',
      description: 'Mark a todo as done (or not done with done=false). A todo with steps ticks off all its steps.',
      inputSchema: { item: itemArg('The todo'), tree: treeArg, done: z.boolean().optional().describe('Default true.') },
      annotations: WRITE,
    },
    async ({ item, tree, done }) =>
      change(db, uid, (trees) => {
        const s = scope(trees, tree);
        if ('error' in s) return s;
        const f = Ops.findItem(s, item);
        if ('error' in f) return f;
        return { tree: f.tree as Loaded, change: Ops.setDone(f.tree, f.node, done ?? true) };
      }),
  );

  server.registerTool(
    'update_item',
    {
      title: 'Change an item',
      description: 'Change the title, notes, deadline or priority of a project, todo or note. Only the fields you give are changed.',
      inputSchema: {
        item: itemArg('The item'),
        tree: treeArg,
        title: z.string().min(1).max(300).optional(),
        notes: z.string().max(20_000).optional().describe('Replaces the notes (Markdown). Empty string removes them.'),
        due: dueArg,
        high: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    async ({ item, tree, ...fields }) =>
      change(db, uid, (trees) => {
        const s = scope(trees, tree);
        if ('error' in s) return s;
        const f = Ops.findItem(s, item);
        if ('error' in f) return f;
        return { tree: f.tree as Loaded, change: Ops.updateItem(f.tree, f.node, fields) };
      }),
  );

  server.registerTool(
    'move_item',
    {
      title: 'Move an item',
      description: 'Move a project, todo or note (with everything inside it) into another project or todo in the same tree, or to the top level (to: "top").',
      inputSchema: {
        item: itemArg('The item to move'),
        to: z.string().min(1).max(300).describe('The new parent (id or exact title), or "top" for the top level of its tree.'),
        tree: treeArg,
      },
      annotations: WRITE,
    },
    async ({ item, to, tree }) =>
      change(db, uid, (trees) => {
        const s = scope(trees, tree);
        if ('error' in s) return s;
        const f = Ops.findItem(s, item);
        if ('error' in f) return f;
        const t = f.tree as Loaded;
        if (to.trim().toLowerCase() === 'top') return { tree: t, change: Ops.moveItem(t, f.node, null) };
        const target = Ops.findItem([t], to);
        if ('error' in target) return { error: `${target.error} (Items can only move within their own tree.)` };
        return { tree: t, change: Ops.moveItem(t, f.node, target.node) };
      }),
  );

  return server;
}
