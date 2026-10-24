export type NodeType = 'root' | 'project' | 'todo' | 'note';
export type ChildType = Exclude<NodeType, 'root'>;

export interface TreeNode {
  id: string;
  type: NodeType;
  title: string;
  /** Only meaningful for leaf todos; parents derive completion from their children. */
  done: boolean;
  collapsed: boolean;
  /** Things to bring up at a meeting: meeting id → ask a question, or just mention it. */
  flags?: Record<string, FlagKind>;
  /** High priority (todos and projects). */
  high?: boolean;
  /** Hidden (with everything inside it) while "Hide sensitive" is on, e.g. when screen-sharing. Any item but the root. */
  sensitive?: boolean;
  /** Deadline as a local calendar date, "YYYY-MM-DD" (todos and projects). */
  due?: string;
  /** Rich notes for projects and todos, as Markdown (GFM). */
  notes?: string;
  /** Last time this item itself changed (ms since epoch). Set automatically; see activity.ts. */
  touched?: number;
  /** When a todo was ticked (ms since epoch). Cleared when unticked. Drives the archive (KAN-28). */
  doneAt?: number;
  /** Archived todos that used to sit directly under this project (or the root), counted as done, so 8/10 stays 8/10. */
  arch?: number;
  /** Don't auto-archive this branch before this moment + ARCHIVE_DAYS (set on restore, and when a meeting flag is cleared). */
  holdFrom?: number;
  children: TreeNode[];
}

export interface TreeDoc {
  v: number;
  root: TreeNode;
  /** The user's own list of meetings items can be flagged for (standup, weekly sync, 1:1…). */
  meetings: Meeting[];
  settings?: DocSettings;
  /** Finished items moved out of the tree (KAN-28), newest last. */
  archive?: ArchivedItem[];
}

/** A finished todo or complete project, moved out of the tree with everything inside it. */
export interface ArchivedItem {
  /** The item itself, with everything that was inside it. Its id is the entry's id. */
  node: TreeNode;
  /** Where it was: parent id and position among the siblings. */
  parentId: string;
  index: number;
  /** Ids and titles of the items above it at the time (top level first, root excluded). */
  ancestors: string[];
  path: string[];
  archivedAt: number;
  how: 'auto' | 'manual';
  /** Sensitive itself or inside a sensitive item: hidden in the archive while "Hide sensitive" is on. */
  sensitive?: boolean;
  /** Archived earlier from inside a project that was archived later: shown inside that project's entry. */
  within?: string;
}

export interface DocSettings {
  /** Open items without activity for this many days get an idle heads-up. 0 = off. */
  idleDays: number;
}

export type FlagKind = 'ask' | 'mention';

export const MEETING_COLORS = ['amber', 'blue', 'teal', 'rose', 'violet', 'slate'] as const;
export type MeetingColor = (typeof MEETING_COLORS)[number];

export interface Meeting {
  id: string;
  name: string;
  color: MeetingColor;
}

export const MAX_MEETINGS = 9;

export interface Stats {
  total: number;
  done: number;
  /** How many of the done ones are in the archive. Only set when > 0. */
  arch?: number;
}

export const TYPES: Record<NodeType, { label: string; allows: ChildType[] }> = {
  root: { label: 'Top level', allows: ['project', 'todo', 'note'] },
  project: { label: 'Project', allows: ['project', 'todo', 'note'] },
  todo: { label: 'Todo', allows: ['todo', 'note'] },
  note: { label: 'Note', allows: [] },
};

export const TYPE_KEYS: Record<string, ChildType> = { p: 'project', t: 'todo', n: 'note' };

/** 4: notes are Markdown (were plain text). 5: archive, `doneAt` (KAN-28). */
export const DOC_VERSION = 5;

/** Only things that can be finished can have a priority or a deadline. */
export const canSchedule = (t: NodeType) => t === 'todo' || t === 'project';

/** Projects and todos have a notes panel; a Note item *is* a note. */
export const canHaveNotes = (t: NodeType) => t === 'todo' || t === 'project';
