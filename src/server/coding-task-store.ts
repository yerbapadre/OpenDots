import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { CodingTask, CodingTaskStatus } from '../shared/coding-task.js';

export class CodingTaskStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS coding_tasks(
      id TEXT PRIMARY KEY,
      dotId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      repoPath TEXT NOT NULL,
      task TEXT NOT NULL,
      base TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL,
      prUrl TEXT,
      summary TEXT,
      error TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      notifiedAt INTEGER
    );`);
  }

  create(params: {
    dotId: string;
    threadId: string;
    repoPath: string;
    task: string;
    base: string;
    branch: string;
  }): CodingTask {
    const now = Date.now();
    const row: CodingTask = {
      id: randomUUID(),
      ...params,
      status: 'running',
      prUrl: null,
      summary: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      notifiedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO coding_tasks(id,dotId,threadId,repoPath,task,base,branch,status,prUrl,summary,error,createdAt,updatedAt,notifiedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.dotId,
        row.threadId,
        row.repoPath,
        row.task,
        row.base,
        row.branch,
        row.status,
        null,
        null,
        null,
        row.createdAt,
        row.updatedAt,
        null,
      );
    return row;
  }

  finish(
    id: string,
    outcome:
      | { status: 'pr_open'; prUrl: string; summary: string }
      | { status: 'failed'; error: string },
  ): CodingTask | undefined {
    this.db
      .prepare(
        `UPDATE coding_tasks SET status=?, prUrl=?, summary=?, error=?, updatedAt=? WHERE id=?`,
      )
      .run(
        outcome.status,
        outcome.status === 'pr_open' ? outcome.prUrl : null,
        outcome.status === 'pr_open' ? outcome.summary : null,
        outcome.status === 'failed' ? outcome.error : null,
        Date.now(),
        id,
      );
    return this.get(id);
  }

  get(id: string): CodingTask | undefined {
    const row = this.db
      .prepare('SELECT * FROM coding_tasks WHERE id=?')
      .get(id);
    return row ? toTask(row) : undefined;
  }

  list(filter: { dotId?: string; threadId?: string }): CodingTask[] {
    const clauses: string[] = [];
    const args: string[] = [];
    if (filter.dotId) {
      clauses.push('dotId=?');
      args.push(filter.dotId);
    }
    if (filter.threadId) {
      clauses.push('threadId=?');
      args.push(filter.threadId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT * FROM coding_tasks ${where} ORDER BY createdAt DESC LIMIT 50`,
      )
      .all(...args)
      .map(toTask);
  }

  activeDuplicate(repoPath: string, task: string): CodingTask | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM coding_tasks WHERE repoPath=? AND task=? AND status='running' LIMIT 1`,
      )
      .get(repoPath, task);
    return row ? toTask(row) : undefined;
  }

  unnotified(threadId: string): CodingTask[] {
    return this.db
      .prepare(
        `SELECT * FROM coding_tasks
         WHERE threadId=? AND status!='running' AND notifiedAt IS NULL
         ORDER BY createdAt ASC`,
      )
      .all(threadId)
      .map(toTask);
  }

  markNotified(ids: string[]): void {
    const statement = this.db.prepare(
      'UPDATE coding_tasks SET notifiedAt=? WHERE id=?',
    );
    for (const id of ids) statement.run(Date.now(), id);
  }

  failAbandoned(reason: string): CodingTask[] {
    const stuck = this.db
      .prepare(`SELECT * FROM coding_tasks WHERE status='running'`)
      .all()
      .map(toTask);
    for (const task of stuck) this.finish(task.id, { status: 'failed', error: reason });
    return stuck.map((task) => ({ ...task, status: 'failed' as const, error: reason }));
  }
}

function toTask(row: Record<string, unknown>): CodingTask {
  return {
    id: String(row.id),
    dotId: String(row.dotId),
    threadId: String(row.threadId),
    repoPath: String(row.repoPath),
    task: String(row.task),
    base: String(row.base),
    branch: String(row.branch),
    status: String(row.status) as CodingTaskStatus,
    prUrl: row.prUrl == null ? null : String(row.prUrl),
    summary: row.summary == null ? null : String(row.summary),
    error: row.error == null ? null : String(row.error),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    notifiedAt: row.notifiedAt == null ? null : Number(row.notifiedAt),
  };
}
