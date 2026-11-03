import { authed, json } from '@/lib/server/http';
import { restoreTree } from '@/lib/server/store';
import { TREE_ID } from '@/lib/cloud/types';

/** Undo a delete. */
export const POST = authed(async ({ req, caller, db }) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split('/')[3] ?? '');
  if (!TREE_ID.test(id)) return json({ error: 'invalid_id' }, 400);
  return json(await restoreTree(db, caller.uid, id));
});
