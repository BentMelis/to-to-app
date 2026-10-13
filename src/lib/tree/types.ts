export type NodeType = 'root' | 'project' | 'todo' | 'note';
export type ChildType = Exclude<NodeType, 'root'>;

export interface TreeNode {
  id: string;
  type: NodeType;
  title: string;
  /** Only meaningful for leaf todos; parents derive completion from their children. */
  done: boolean;
  collapsed: boolean;
  children: TreeNode[];
}

export interface TreeDoc {
  v: number;
  root: TreeNode;
}

export interface Stats {
  total: number;
  done: number;
}

export const TYPES: Record<NodeType, { label: string; allows: ChildType[] }> = {
  root: { label: 'Top level', allows: ['project', 'todo', 'note'] },
  project: { label: 'Project', allows: ['project', 'todo', 'note'] },
  todo: { label: 'Todo', allows: ['todo', 'note'] },
  note: { label: 'Note', allows: [] },
};

export const TYPE_KEYS: Record<string, ChildType> = { p: 'project', t: 'todo', n: 'note' };

export const DOC_VERSION = 2;
