/**
 * Shapes shared by the Trees API (src/app/api) and the browser (src/lib/cloud). See KAN-39 and the
 * Confluence page "TwigList – Cloud data model". The tree document itself is the same `TreeDoc` as in the browser.
 */
import type { TreeDoc } from '@/lib/tree/types';

/** A tree in the account's list, without its document. */
export interface TreeMeta {
  id: string;
  name: string;
  order: number;
  /** +1 on every save; a save must say which rev it started from (optimistic concurrency). */
  rev: number;
  updatedAt: string;
}

export interface TreeRecord extends TreeMeta {
  doc: TreeDoc;
}

export interface Profile {
  uid: string;
  email: string | null;
  name: string | null;
  provider: string | null;
  createdAt: string;
}

/** PUT /api/trees/:id */
export interface SaveBody {
  doc: TreeDoc;
  /** The rev this save is based on. 0 = a new tree. */
  rev: number;
  /** Only used when the tree is created. */
  name?: string;
}

/** 409 from PUT: someone else saved first. */
export interface ConflictBody {
  error: 'conflict';
  current: TreeRecord;
}

export const MAX_DOC_BYTES = 1_000_000;
export const TREE_ID = /^[\w-]{1,40}$/;
