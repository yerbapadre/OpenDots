import { EventEmitter } from 'node:events';
import { cronMatches, isValidCron, type ScheduledTurn } from '../shared/scheduled-turn.js';
import type { ScheduledTurnStore } from './scheduled-turn-store.js';
import { runLocalTurn, type LocalTurnDeps } from './local-turn.js';

// Proactive turns: a minute-granularity scheduler that fires due scheduled
// turns by driving the Dot server-side via runLocalTurn. Results land in the
// thread (persisted, replayable), so the user sees them on next open.
//
// Semantics: ticks once per minute and runs every enabled turn whose cron
// matches the current minute. No catch-up for minutes the server was down
// (acceptable for a local, single-user setup; documented in .env.example).
export class ScheduledTurnService extends EventEmitter {
  private timer?: ReturnType<typeof setInterval>;
  private lastTickMinute = '';
  private running = new Set<string>();

  constructor(
    private store: ScheduledTurnStore,
    private deps: LocalTurnDeps,
  ) {
    super();
  }

  create(params: {
    dotId: string;
    threadId: string;
    prompt: string;
    cron: string;
  }): ScheduledTurn {
    if (!isValidCron(params.cron))
      throw new Error(`Invalid cron expression: "${params.cron}"`);
    this.deps.workspace.requireThread(params.threadId);
    if (!this.deps.workspace.dot(params.dotId))
      throw new Error('Dot not found.');
    return this.store.create(params);
  }

  list(filter: { dotId?: string; threadId?: string } = {}): ScheduledTurn[] {
    return this.store.list(filter);
  }

  setEnabled(id: string, enabled: boolean): ScheduledTurn | undefined {
    this.store.setEnabled(id, enabled);
    return this.store.get(id);
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  start(): void {
    if (this.timer) return;
    // Align roughly to minute boundaries by checking every 20s; the
    // minute-key guard prevents double-firing within the same minute.
    this.timer = setInterval(() => void this.tick(), 20_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(now: Date = new Date()): Promise<void> {
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (minuteKey === this.lastTickMinute) return;
    this.lastTickMinute = minuteKey;

    let due: ScheduledTurn[];
    try {
      due = this.store
        .enabled()
        .filter((turn) => cronMatches(turn.cron, now));
    } catch {
      return; // never let a store error crash the interval
    }

    for (const turn of due) {
      if (this.running.has(turn.id)) continue;
      this.running.add(turn.id);
      void this.fire(turn).finally(() => this.running.delete(turn.id));
    }
  }

  private async fire(turn: ScheduledTurn): Promise<void> {
    try {
      await runLocalTurn(this.deps, {
        threadId: turn.threadId,
        prompt: turn.prompt,
        source: 'scheduled_task',
      });
      this.store.markRun(turn.id, 'ok');
      this.emit('run', { turn, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markRun(turn.id, `error: ${message.slice(0, 200)}`);
      this.emit('run', { turn, ok: false, error: message });
    }
  }
}
