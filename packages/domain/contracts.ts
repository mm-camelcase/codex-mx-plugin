export type ThreadState = 'working' | 'needs-attention' | 'done' | 'idle' | 'error' | 'unknown' | 'observed-active' | 'possible-attention' | 'stopped' | 'interrupted';
export interface CodexThread { id: string; projectId: string; cwd: string; name: string; preview?: string; state: ThreadState; updatedAt: number; }
export interface CodexProject { id: string; cwd: string; name: string; threads: CodexThread[]; }
export type KeyAction = { type: 'projects' | 'back' | 'none' } | { type: 'project' | 'thread'; id: string } | { type: 'page'; page: number };
export interface KeyDefinition { id: string; title: string; subtitle?: string; state?: ThreadState; badge?: number; icon?: string; disabled?: boolean; action: KeyAction; }
export interface KeypadTarget { render(keys: KeyDefinition[]): Promise<void>; }
export interface CodexNavigator { readonly supported: boolean; openThread(threadId: string): Promise<void>; focusCodex(): Promise<void>; }
