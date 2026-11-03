import { authed, body, json } from '@/lib/server/http';
import { deleteTree, getTree, renameTree, saveTree } from '@/lib/server/store';
import { TREE_ID } from '@/lib/cloud/types';

/** The tree id from /api/trees/:id (validated). */
const treeId = (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split('/')[3] ?? '');
  return TREE_ID.test(id) ? id : null;
};
const badId = () => json({ error: 'invalid_id' }, 400);

export const GET = authed(async ({ req, caller, db }) => {
  const id = treeId(req);
  return id ? json(await getTree(db, caller.uid, id)) : badId();
});

/** Save (or create, with rev 0): `{ doc, rev, name? }`. 409 with `current` when rev is stale. */
export const PUT = authed(async ({ req, caller, db }) => {
  const id = treeId(req);
  if (!id) return badId();
  const b = await body<{ doc?: unknown; rev?: unknown; name?: unknown }>(req);
  return json(await saveTree(db, caller.uid, id, { doc: b.doc, rev: b.rev, name: b.name }));
});

/** Rename: `{ name }`. */
export const PATCH = authed(async ({ req, caller, db }) => {
  const id = treeId(req);
  if (!id) return badId();
  const b = await body<{ name?: unknown }>(req);
  return json(await renameTree(db, caller.uid, id, b.name));
});

/** Soft delete (restorable for 30 days). */
export const DELETE = authed(async ({ req, caller, db }) => {
  const id = treeId(req);
  if (!id) return badId();
  await deleteTree(db, caller.uid, id);
  return json({ ok: true });
});
