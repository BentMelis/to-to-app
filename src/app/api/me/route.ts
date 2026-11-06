import { authed, json } from '@/lib/server/http';
import { deleteUserData, touchUser } from '@/lib/server/store';
import { forgetUser } from '@/lib/server/oauth';

/** The profile; creates it on first sign-in. */
export const GET = authed(async ({ caller, db }) => json(await touchUser(db, caller)));

/**
 * Delete the account's data: all trees and the profile. The browser then deletes the Firebase sign-in account
 * itself (see deleteAccount in src/lib/cloud/auth.ts), so the server needs no admin credentials.
 */
export const DELETE = authed(async ({ caller, db }) => {
  const r = await deleteUserData(db, caller.uid);
  await forgetUser(db, caller.uid); // connected apps (MCP) lose access too
  return json({ ok: true, deletedTrees: r.trees });
});
