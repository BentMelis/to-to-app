import { authed, body, json } from '@/lib/server/http';
import { listTrees, reorderTrees } from '@/lib/server/store';

/** The signed-in user's trees, in order, without their documents. */
export const GET = authed(async ({ caller, db }) => json({ trees: await listTrees(db, caller.uid) }));

/** Reorder: `{ order: [treeId, …] }`. */
export const PATCH = authed(async ({ req, caller, db }) => {
  const b = await body<{ order?: unknown }>(req);
  return json({ trees: await reorderTrees(db, caller.uid, b.order) });
});
