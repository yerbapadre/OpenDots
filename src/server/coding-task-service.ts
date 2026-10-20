import { EventEmitter } from 'node:events';
import type { CodingTask } from '../shared/coding-task.js';
import type { CodingTaskStore } from './coding-task-store.js';
import { runCodingTask } from './coding-task.js';

const REPOS_DIR = process.env.CODING_REPOS_DIR ?? '/Users/jakeevans/Leland';
const DEFAULT_REPO = process.env.CODING_REPO ?? `${REPOS_DIR}/leland-monorepo`;

export function resolveRepoPath(repo?: string): string {
  if (!repo) return DEFAULT_REPO;
  if (repo.startsWith('/')) return repo;
  const name = repo.split('/').filter(Boolean).pop() ?? '';
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..'))
    throw new Error(`Invalid repo name: ${repo}`);
  return `${REPOS_DIR}/${name}`;
}

export interface SpawnResult {
  task: CodingTask;
  duplicate: boolean;
}

// Owns long-running coding tasks so they survive the Dot's per-turn
// subprocesses. Lives in the main server; emits 'task' events on every
// status change for the SSE stream.
export class CodingTaskService extends EventEmitter {
  constructor(private store: CodingTaskStore) {
    super();
    // Anything still 'running' at construction was orphaned by a restart.
    this.store.failAbandoned(
      'The server restarted while this task was running. Check the repo for a pushed branch before retrying.',
    );
  }

  spawn(params: {
    dotId: string;
    threadId: string;
    task: string;
    repo?: string;
    base?: string;
  }): SpawnResult {
    const repoPath = resolveRepoPath(params.repo);
    const existing = this.store.activeDuplicate(repoPath, params.task);
    if (existing) return { task: existing, duplicate: true };

    const record = this.store.create({
      dotId: params.dotId,
      threadId: params.threadId,
      repoPath,
      task: params.task,
      base: params.base ?? 'main',
      branch: `dots/task-${Date.now().toString(36)}`,
    });
    this.emit('task', record);

    void runCodingTask({
      repoPath,
      task: params.task,
      base: record.base,
      branch: record.branch,
    })
      .then((result) =>
        this.finish(record.id, {
          status: 'pr_open',
          prUrl: result.prUrl,
          summary: result.summary,
        }),
      )
      .catch((error: unknown) =>
        this.finish(record.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );

    return { task: record, duplicate: false };
  }

  private finish(
    id: string,
    outcome:
      | { status: 'pr_open'; prUrl: string; summary: string }
      | { status: 'failed'; error: string },
  ) {
    const updated = this.store.finish(id, outcome);
    if (updated) this.emit('task', updated);
  }

  get(id: string): CodingTask | undefined {
    return this.store.get(id);
  }

  list(filter: { dotId?: string; threadId?: string }): CodingTask[] {
    return this.store.list(filter);
  }

  // Next-turn notices: finished-but-unreported tasks for a thread. The caller
  // marks them notified only after the turn that carried them succeeds.
  pendingNotices(threadId: string): CodingTask[] {
    return this.store.unnotified(threadId);
  }

  markNotified(ids: string[]): void {
    this.store.markNotified(ids);
  }
}
