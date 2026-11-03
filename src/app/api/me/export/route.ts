import { authed, json } from '@/lib/server/http';
import { exportAll } from '@/lib/server/store';

/** Everything stored for this account, as JSON ("Download all my data"). */
export const GET = authed(async ({ caller, db }) => json(await exportAll(db, caller.uid)));
