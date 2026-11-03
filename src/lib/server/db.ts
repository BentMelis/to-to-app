/**
 * MongoDB (KAN-40). One client per server instance, reused across requests (connection pooling);
 * in development it survives hot reloads on globalThis.
 */
import { MongoClient, type Db } from 'mongodb';
import { serverConfig } from './config';

type Cache = { client?: MongoClient; db?: Promise<Db> };
const g = globalThis as typeof globalThis & { __twiglistMongo?: Cache };
const cache: Cache = (g.__twiglistMongo ??= {});

export function getDb(): Promise<Db> {
  if (!cache.db) {
    const { mongoUri, mongoDb } = serverConfig();
    if (!mongoUri) return Promise.reject(new Error('MONGODB_URI is not set'));
    cache.client = new MongoClient(mongoUri, { maxPoolSize: 10, appName: 'twiglist' });
    cache.db = cache.client
      .connect()
      .then(async (c) => {
        const db = c.db(mongoDb);
        // Indexes keep queries fast and tree ids unique per user. If they can't be created (e.g. a database
        // user without that right), the API still works; it's logged so it can be fixed.
        await ensureIndexes(db).catch((e) => console.error('[db] could not create indexes', (e as Error)?.message?.slice(0, 200)));
        return db;
      })
      .catch((e) => {
        cache.db = undefined; // try again on the next request
        throw e;
      });
  }
  return cache.db;
}

/** Collections and indexes from the data model (KAN-39). Safe to run repeatedly. */
export async function ensureIndexes(db: Db) {
  await db.collection('trees').createIndexes([
    { key: { ownerId: 1, treeId: 1 }, name: 'owner_tree', unique: true },
    { key: { ownerId: 1, deletedAt: 1, order: 1 }, name: 'owner_live_order' },
  ]);
}
