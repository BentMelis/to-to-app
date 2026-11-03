/**
 * Reading and writing a user's trees in MongoDB (KAN-39, KAN-42). Every query is scoped to `ownerId`,
 * so one user can never read or change another user's trees.
 *
 * Collections
 * - `users`: `_id` = Firebase UID, email, name, provider, createdAt, lastSeenAt.
 * - `trees`: one document per tree: ownerId, treeId (the id the app uses), name, order, doc (TreeDoc),
 *   rev (+1 per save), createdAt, updatedAt, deletedAt (soft delete: undo and recovery).
 *
 * Nothing here logs tree content: titles and notes are user data.
 */
import type { Db, WithId } from 'mongodb';
import { parseDoc } from '@/lib/tree/model';
import { MAX_TREES, cleanName } from '@/lib/tree/trees';
import type { TreeDoc } from '@/lib/tree/types';
import type { Profile, TreeMeta, TreeRecord } from '@/lib/cloud/types';

/** Soft-deleted trees are removed for good after this long. */
export const PURGE_AFTER_DAYS = 30;

interface TreeRow {
  ownerId: string;
  treeId: string;
  name: string;
  order: number;
  doc: TreeDoc;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface UserRow {
  _id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export class StoreError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 422,
    public code: string,
    public current?: TreeRecord,
  ) {
    super(code);
  }
}

const trees = (db: Db) => db.collection<TreeRow>('trees');
const users = (db: Db) => db.collection<UserRow>('users');
const LIVE = { deletedAt: null };

const meta = (r: TreeRow): TreeMeta => ({ id: r.treeId, name: r.name, order: r.order, rev: r.rev, updatedAt: r.updatedAt.toISOString() });
const record = (r: TreeRow): TreeRecord => ({ ...meta(r), doc: r.doc });
const strip = <T extends object>(r: WithId<T>): T => {
  const { _id, ...rest } = r;
  void _id;
  return rest as T;
};

/** Validate and normalise a tree document from the client (same rules as loading from the browser). */
export function cleanDoc(input: unknown): TreeDoc {
  const doc = parseDoc(input);
  if (!doc) throw new StoreError(400, 'invalid_doc');
  return doc;
}

/* ---------- Users ---------- */

/** Create or refresh the user's profile. Called on every sign-in (GET /api/me). */
export async function touchUser(db: Db, u: { uid: string; email?: string | null; name?: string | null; provider?: string | null }): Promise<Profile> {
  const now = new Date();
  const r = await users(db).findOneAndUpdate(
    { _id: u.uid },
    {
      $set: { email: u.email ?? null, name: u.name ?? null, provider: u.provider ?? null, lastSeenAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return { uid: u.uid, email: r?.email ?? null, name: r?.name ?? null, provider: r?.provider ?? null, createdAt: (r?.createdAt ?? now).toISOString() };
}

/** Everything we store about a user, for "Download all my data". */
export async function exportAll(db: Db, uid: string) {
  const user = await users(db).findOne({ _id: uid });
  const rows = await trees(db).find({ ownerId: uid, ...LIVE }).sort({ order: 1 }).toArray();
  return {
    exportedAt: new Date().toISOString(),
    account: user ? { uid, email: user.email, name: user.name, provider: user.provider, createdAt: user.createdAt.toISOString() } : { uid },
    trees: rows.map((r) => record(strip(r))),
  };
}

/** Delete the account's data: all trees (also soft-deleted ones) and the profile. */
export async function deleteUserData(db: Db, uid: string) {
  const t = await trees(db).deleteMany({ ownerId: uid });
  await users(db).deleteOne({ _id: uid });
  return { trees: t.deletedCount };
}

/* ---------- Trees ---------- */

/** The account's trees in order, without documents. Also clears out trees deleted more than 30 days ago. */
export async function listTrees(db: Db, uid: string): Promise<TreeMeta[]> {
  await trees(db).deleteMany({ ownerId: uid, deletedAt: { $lt: new Date(Date.now() - PURGE_AFTER_DAYS * 86_400_000) } });
  const rows = await trees(db)
    .find({ ownerId: uid, ...LIVE }, { projection: { doc: 0 } })
    .sort({ order: 1, createdAt: 1 })
    .toArray();
  return rows.map((r) => meta(strip(r) as TreeRow));
}

export async function getTree(db: Db, uid: string, treeId: string): Promise<TreeRecord> {
  const r = await trees(db).findOne({ ownerId: uid, treeId, ...LIVE });
  if (!r) throw new StoreError(404, 'not_found');
  return record(strip(r));
}

/**
 * Save a tree. `rev` is the version the client started from:
 * - 0: create it (at the end of the list, within the 10-tree limit);
 * - otherwise it must still be the current rev, or the save is refused with 409 and the current version,
 *   so nothing is ever overwritten without the client knowing.
 */
export async function saveTree(db: Db, uid: string, treeId: string, input: { doc: unknown; rev: unknown; name?: unknown }): Promise<TreeMeta> {
  const doc = cleanDoc(input.doc);
  const rev = typeof input.rev === 'number' && Number.isInteger(input.rev) && input.rev >= 0 ? input.rev : -1;
  if (rev < 0) throw new StoreError(400, 'invalid_rev');
  const now = new Date();

  if (rev === 0) {
    const existing = await trees(db).findOne({ ownerId: uid, treeId });
    if (existing) {
      if (existing.deletedAt) throw new StoreError(404, 'not_found');
      throw new StoreError(409, 'conflict', record(strip(existing)));
    }
    const live = await trees(db).countDocuments({ ownerId: uid, ...LIVE });
    if (live >= MAX_TREES) throw new StoreError(422, 'tree_limit');
    const last = await trees(db).find({ ownerId: uid, ...LIVE }).sort({ order: -1 }).limit(1).toArray();
    const name = cleanName(typeof input.name === 'string' ? input.name : doc.root.title) || 'Untitled';
    const row: TreeRow = { ownerId: uid, treeId, name, order: (last[0]?.order ?? -1) + 1, doc, rev: 1, createdAt: now, updatedAt: now, deletedAt: null };
    try {
      await trees(db).insertOne(row);
    } catch (e) {
      // Created at the same moment from another device (unique index).
      if ((e as { code?: number }).code === 11000) {
        const cur = await trees(db).findOne({ ownerId: uid, treeId });
        if (cur) throw new StoreError(409, 'conflict', record(strip(cur)));
      }
      throw e;
    }
    return meta(row);
  }

  const r = await trees(db).findOneAndUpdate(
    { ownerId: uid, treeId, rev, ...LIVE },
    { $set: { doc, updatedAt: now }, $inc: { rev: 1 } },
    { returnDocument: 'after' },
  );
  if (r) return meta(strip(r) as TreeRow);
  const cur = await trees(db).findOne({ ownerId: uid, treeId, ...LIVE });
  if (!cur) throw new StoreError(404, 'not_found');
  throw new StoreError(409, 'conflict', record(strip(cur)));
}

export async function renameTree(db: Db, uid: string, treeId: string, name: unknown): Promise<TreeMeta> {
  const n = typeof name === 'string' ? cleanName(name) : '';
  if (!n) throw new StoreError(400, 'invalid_name');
  const r = await trees(db).findOneAndUpdate({ ownerId: uid, treeId, ...LIVE }, { $set: { name: n } }, { returnDocument: 'after' });
  if (!r) throw new StoreError(404, 'not_found');
  return meta(strip(r) as TreeRow);
}

/** Put the trees in this order. Ids that aren't the user's are ignored; trees not mentioned keep their place after them. */
export async function reorderTrees(db: Db, uid: string, ids: unknown): Promise<TreeMeta[]> {
  if (!Array.isArray(ids) || ids.length > MAX_TREES * 2 || !ids.every((i) => typeof i === 'string')) throw new StoreError(400, 'invalid_order');
  const current = await listTrees(db, uid);
  const wanted = (ids as string[]).filter((id, i, a) => a.indexOf(id) === i && current.some((t) => t.id === id));
  const rest = current.filter((t) => !wanted.includes(t.id)).map((t) => t.id);
  const order = [...wanted, ...rest];
  await Promise.all(order.map((treeId, i) => trees(db).updateOne({ ownerId: uid, treeId, ...LIVE }, { $set: { order: i } })));
  return listTrees(db, uid);
}

/** Soft delete: the tree disappears from the list but can be restored (undo, support) for 30 days. */
export async function deleteTree(db: Db, uid: string, treeId: string) {
  const exists = await trees(db).countDocuments({ ownerId: uid, treeId, ...LIVE });
  if (!exists) throw new StoreError(404, 'not_found');
  // Like in the app: the last tree can't be deleted.
  if ((await trees(db).countDocuments({ ownerId: uid, ...LIVE })) <= 1) throw new StoreError(422, 'last_tree');
  await trees(db).updateOne({ ownerId: uid, treeId, ...LIVE }, { $set: { deletedAt: new Date() } });
}

export async function restoreTree(db: Db, uid: string, treeId: string): Promise<TreeMeta> {
  const live = await trees(db).countDocuments({ ownerId: uid, ...LIVE });
  if (live >= MAX_TREES) throw new StoreError(422, 'tree_limit');
  const r = await trees(db).findOneAndUpdate(
    { ownerId: uid, treeId, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { returnDocument: 'after' },
  );
  if (!r) throw new StoreError(404, 'not_found');
  return meta(strip(r) as TreeRow);
}
