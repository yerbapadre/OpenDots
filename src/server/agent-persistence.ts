import type { DatabaseSync } from 'node:sqlite';
import { ɵGLOBAL_STORE as GLOBAL_STORE } from '@copilotkit/runtime/v2';

// Durable conversation history for local mode.
//
// In local mode the CopilotKit runtime keeps every thread's messages/events in
// the process-global in-memory store, which is lost on each server restart
// (every --watch reload). The thread LIST survives (SQLite thread_bindings) but
// transcripts don't, so old chats open blank.
//
// This module makes that store durable without forking the runtime:
//   1. Rehydrate: on startup, replay persisted runs back into the global store
//      so getThreadEvents/getThreadMessages (which power the local connect
//      replay) return them.
//   2. Persist: wrap the store's appendRun so every finalized run is written to
//      SQLite as it happens.
//
// A "run" carries the AG-UI `events` (text + tool calls, what the UI replays)
// and a `messages` snapshot (the full conversation). We store both verbatim.

interface StoredRun {
  threadId: string;
  runId: string;
  agentId: string;
  parentRunId: string | null;
  events: unknown[];
  messages: unknown[];
  createdAt: number;
}

export function installAgentPersistence(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_runs(
    threadId TEXT NOT NULL,
    runId TEXT NOT NULL,
    agentId TEXT NOT NULL,
    parentRunId TEXT,
    events TEXT NOT NULL,
    messages TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    PRIMARY KEY (threadId, runId)
  );`);

  const store = GLOBAL_STORE as unknown as {
    getOrCreate(threadId: string): unknown;
    appendRun(threadId: string, run: StoredRun): void;
  };

  // 1. Rehydrate persisted runs into the in-memory store, oldest first so
  //    historicRuns keep their original order. Use the original appendRun
  //    before wrapping, so replay doesn't re-persist what we just read.
  const originalAppendRun = store.appendRun.bind(store);
  const rows = db
    .prepare('SELECT * FROM agent_runs ORDER BY createdAt ASC')
    .all() as Array<Record<string, unknown>>;
  let restored = 0;
  for (const row of rows) {
    try {
      const threadId = String(row.threadId);
      store.getOrCreate(threadId);
      originalAppendRun(threadId, {
        threadId,
        runId: String(row.runId),
        agentId: String(row.agentId),
        parentRunId: row.parentRunId == null ? null : String(row.parentRunId),
        events: JSON.parse(String(row.events)) as unknown[],
        messages: JSON.parse(String(row.messages)) as unknown[],
        createdAt: Number(row.createdAt),
      });
      restored += 1;
    } catch {
      // A single corrupt row must not block the rest of history.
    }
  }
  if (restored)
    console.log(`[dots] rehydrated ${restored} persisted conversation run(s)`);

  // 2. Persist each finalized run. appendRun mutates run.messages to [] after
  //    snapshotting, so capture both arrays before delegating.
  const upsert = db.prepare(
    `INSERT INTO agent_runs(threadId,runId,agentId,parentRunId,events,messages,createdAt)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(threadId,runId) DO UPDATE SET
       events=excluded.events, messages=excluded.messages, createdAt=excluded.createdAt`,
  );
  store.appendRun = (threadId: string, run: StoredRun) => {
    try {
      upsert.run(
        threadId,
        run.runId,
        run.agentId ?? 'default',
        run.parentRunId ?? null,
        JSON.stringify(run.events ?? []),
        JSON.stringify(run.messages ?? []),
        run.createdAt ?? Date.now(),
      );
    } catch {
      // Logging/persistence must never break a live turn.
    }
    return originalAppendRun(threadId, run);
  };
}
