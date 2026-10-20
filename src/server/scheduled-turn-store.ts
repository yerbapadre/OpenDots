import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { ScheduledTurn } from '../shared/scheduled-turn.js';

export class ScheduledTurnStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS scheduled_turns(
      id TEXT PRIMARY KEY,
      dotId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      lastRunAt INTEGER,
      lastStatus TEXT
    );`);
  }

  create(params: {
    dotId: string;
    threadId: string;
    prompt: string;
    cron: string;
  }): ScheduledTurn {
    const row: ScheduledTurn = {
      id: randomUUID(),
      ...params,
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
      lastStatus: null,
    };
    this.db
      .prepare(
        `INSERT INTO scheduled_turns(id,dotId,threadId,prompt,cron,enabled,createdAt,lastRunAt,lastStatus)
         VALUES (?,?,?,?,?,1,?,NULL,NULL)`,
      )
      .run(row.id, row.dotId, row.threadId, row.prompt, row.cron, row.createdAt);
    return row;
  }

  list(filter: { dotId?: string; threadId?: string } = {}): ScheduledTurn[] {
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
      .prepare(`SELECT * FROM scheduled_turns ${where} ORDER BY createdAt DESC`)
      .all(...args)
      .map(toTurn);
  }

  enabled(): ScheduledTurn[] {
    return this.db
      .prepare('SELECT * FROM scheduled_turns WHERE enabled=1')
      .all()
      .map(toTurn);
  }

  get(id: string): ScheduledTurn | undefined {
    const row = this.db
      .prepare('SELECT * FROM scheduled_turns WHERE id=?')
      .get(id);
    return row ? toTurn(row) : undefined;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE scheduled_turns SET enabled=? WHERE id=?')
      .run(enabled ? 1 : 0, id);
  }

  markRun(id: string, status: string): void {
    this.db
      .prepare('UPDATE scheduled_turns SET lastRunAt=?, lastStatus=? WHERE id=?')
      .run(Date.now(), status, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM scheduled_turns WHERE id=?').run(id);
  }
}

function toTurn(row: Record<string, unknown>): ScheduledTurn {
  return {
    id: String(row.id),
    dotId: String(row.dotId),
    threadId: String(row.threadId),
    prompt: String(row.prompt),
    cron: String(row.cron),
    enabled: !!row.enabled,
    createdAt: Number(row.createdAt),
    lastRunAt: row.lastRunAt == null ? null : Number(row.lastRunAt),
    lastStatus: row.lastStatus == null ? null : String(row.lastStatus),
  };
}
