/**
 * Trees API data layer against a real MongoDB-protocol server (KAN-42).
 * Runs when MONGODB_TEST_URI is set (e.g. a local mongod, or FerretDB); skipped otherwise.
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { ensureIndexes } from '../db';
import * as S from '../store';
import { emptyTree } from '@/lib/tree/trees';
import { starter } from '@/lib/tree/model';

const URI = process.env.MONGODB_TEST_URI;

describe.skipIf(!URI)('cloud store (MongoDB)', () => {
  let client: MongoClient;
  let db: Db;
  const A = 'user-a';
  const B = 'user-b';

  beforeAll(async () => {
    client = await new MongoClient(URI!).connect();
    db = client.db(`twiglist_test_${process.pid}`);
  });
  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });
  beforeEach(async () => {
    await db.dropDatabase();
    await ensureIndexes(db);
  });

  const err = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as S.StoreError;
    }
    throw new Error('expected an error');
  };

  it('creates a tree with rev 0, then saves only from the current rev', async () => {
    const created = await S.saveTree(db, A, 'main', { doc: emptyTree('Work'), rev: 0 });
    expect(created).toMatchObject({ id: 'main', name: 'Work', order: 0, rev: 1 });
    const doc = starter();
    expect((await S.saveTree(db, A, 'main', { doc, rev: 1 })).rev).toBe(2);
    expect((await S.getTree(db, A, 'main')).doc.root.children.length).toBe(doc.root.children.length);

    // A save based on an old rev is refused with the current version; nothing is overwritten.
    const stale = await err(S.saveTree(db, A, 'main', { doc: emptyTree('Work'), rev: 1 }));
    expect(stale.status).toBe(409);
    expect(stale.current).toMatchObject({ id: 'main', rev: 2 });
    expect(stale.current!.doc.root.children.length).toBe(doc.root.children.length);
    // Creating a tree that already exists is a conflict too.
    expect((await err(S.saveTree(db, A, 'main', { doc: emptyTree('Work'), rev: 0 }))).status).toBe(409);
  });

  it('never lets one user see or change another user’s trees', async () => {
    await S.saveTree(db, A, 'main', { doc: emptyTree('Mine'), rev: 0 });
    expect((await err(S.getTree(db, B, 'main'))).status).toBe(404);
    expect((await err(S.saveTree(db, B, 'main', { doc: emptyTree('x'), rev: 1 }))).status).toBe(404);
    expect((await err(S.renameTree(db, B, 'main', 'x'))).status).toBe(404);
    expect((await err(S.deleteTree(db, B, 'main'))).status).toBe(404);
    expect(await S.listTrees(db, B)).toEqual([]);
    // The same tree id can exist for both users (every local first tree is called "main").
    await S.saveTree(db, B, 'main', { doc: emptyTree('Theirs'), rev: 0 });
    expect((await S.getTree(db, A, 'main')).name).toBe('Mine');
    expect((await S.getTree(db, B, 'main')).name).toBe('Theirs');
  });

  it('validates documents', async () => {
    expect((await err(S.saveTree(db, A, 't', { doc: { nope: 1 }, rev: 0 }))).status).toBe(400);
    expect((await err(S.saveTree(db, A, 't', { doc: emptyTree('x'), rev: -1 }))).status).toBe(400);
    expect((await err(S.saveTree(db, A, 't', { doc: emptyTree('x'), rev: '1' }))).status).toBe(400);
  });

  it('lists, renames and reorders', async () => {
    for (const [id, n] of [['a', 'One'], ['b', 'Two'], ['c', 'Three']]) await S.saveTree(db, A, id, { doc: emptyTree(n), rev: 0 });
    expect((await S.listTrees(db, A)).map((t) => t.name)).toEqual(['One', 'Two', 'Three']);
    await S.renameTree(db, A, 'b', '  Second   tree ');
    expect((await S.reorderTrees(db, A, ['c', 'a', 'zzz'])).map((t) => `${t.id}:${t.name}`)).toEqual(['c:Three', 'a:One', 'b:Second tree']);
    expect((await err(S.renameTree(db, A, 'a', '   '))).status).toBe(400);
  });

  it('keeps to 10 trees', async () => {
    for (let i = 0; i < 10; i++) await S.saveTree(db, A, `t${i}`, { doc: emptyTree(`T${i}`), rev: 0 });
    expect((await err(S.saveTree(db, A, 't10', { doc: emptyTree('Eleven'), rev: 0 }))).status).toBe(422);
  });

  it('soft-deletes and restores; the last tree stays; old deletions are purged', async () => {
    await S.saveTree(db, A, 'a', { doc: emptyTree('One'), rev: 0 });
    await S.saveTree(db, A, 'b', { doc: emptyTree('Two'), rev: 0 });
    await S.deleteTree(db, A, 'b');
    expect((await S.listTrees(db, A)).map((t) => t.id)).toEqual(['a']);
    expect((await err(S.getTree(db, A, 'b'))).status).toBe(404);
    expect((await err(S.deleteTree(db, A, 'a'))).status).toBe(422);
    expect((await S.restoreTree(db, A, 'b')).name).toBe('Two');
    expect((await S.listTrees(db, A)).map((t) => t.id)).toEqual(['a', 'b']);

    await S.deleteTree(db, A, 'b');
    await db.collection('trees').updateOne({ ownerId: A, treeId: 'b' }, { $set: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    await S.listTrees(db, A);
    expect(await db.collection('trees').countDocuments({ ownerId: A, treeId: 'b' })).toBe(0);
  });

  it('keeps a profile, exports everything and deletes everything', async () => {
    const p = await S.touchUser(db, { uid: A, email: 'a@example.com', name: 'A', provider: 'google.com' });
    expect(p).toMatchObject({ uid: A, email: 'a@example.com', provider: 'google.com' });
    const again = await S.touchUser(db, { uid: A, email: 'a@example.com', name: 'A', provider: 'microsoft.com' });
    expect(again.createdAt).toBe(p.createdAt);
    await S.saveTree(db, A, 'a', { doc: starter(), rev: 0, name: 'Work' });
    await S.saveTree(db, B, 'a', { doc: emptyTree('Other'), rev: 0 });
    const all = await S.exportAll(db, A);
    expect(all.account).toMatchObject({ uid: A, email: 'a@example.com' });
    expect(all.trees.map((t) => t.name)).toEqual(['Work']);
    expect(all.trees[0].doc.root.children.length).toBeGreaterThan(0);

    expect(await S.deleteUserData(db, A)).toEqual({ trees: 1 });
    expect(await S.listTrees(db, A)).toEqual([]);
    expect(await db.collection('users').countDocuments({ _id: A } as object)).toBe(0);
    expect(await S.listTrees(db, B)).toHaveLength(1);
  });
});
