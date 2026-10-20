import { randomUUID } from 'node:crypto';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { ɵGLOBAL_STORE as GLOBAL_STORE } from '@copilotkit/runtime/v2';
import { ClaudeCliDotAgent } from './claude-cli-dot-agent.js';
import { scheduledTaskMessagePrefix } from '../shared/scheduled-message.js';
import type { PlatformConfig } from './platform-config.js';
import type { WorkspaceStore } from './workspace.js';
import type { ComputerService } from './computer-service.js';
import type { CodingTaskService } from './coding-task-service.js';

// The local analog of platform.turn(): drive a Dot turn server-side (no browser,
// no Intelligence) and land the result in the thread's in-memory store so it
// persists (via agent-persistence) and replays to the browser on next open.
//
// Used for proactive/scheduled work. The store's event list is additive
// (historicRuns), but its message snapshot is REPLACED on each appendRun, so we
// carry the full prior transcript forward plus the new user+assistant messages.

export interface LocalTurnDeps {
  config: PlatformConfig;
  workspace: WorkspaceStore;
  computers: ComputerService;
  codingTasks: CodingTaskService;
}

interface StoreForTurn {
  getOrCreate(threadId: string): { messagesSnapshot?: unknown[] } | undefined;
  peek(threadId: string): { messagesSnapshot?: unknown[] } | undefined;
  appendRun(threadId: string, run: unknown): void;
}

export interface LocalTurnResult {
  text: string;
  runId: string;
}

export async function runLocalTurn(
  deps: LocalTurnDeps,
  params: { threadId: string; prompt: string; source?: string },
): Promise<LocalTurnResult> {
  const thread = deps.workspace.requireThread(params.threadId);
  const dot = deps.workspace.dot(thread.dotId);
  if (!dot) throw new Error('The thread is bound to a Dot that no longer exists.');

  const agent = new ClaudeCliDotAgent(
    dot,
    deps.config,
    deps.workspace,
    deps.computers,
    deps.codingTasks,
  );

  const runId = randomUUID();
  const source = params.source ?? 'scheduled_task';
  const userMessage = {
    id: `${scheduledTaskMessagePrefix}${randomUUID()}`,
    role: 'user' as const,
    content: params.prompt,
    metadata: { opendotsSource: source },
  };

  const input = {
    threadId: params.threadId,
    runId,
    messages: [userMessage],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  } as unknown as RunAgentInput;

  // Drive the turn, collecting content events and assistant text.
  const contentEvents: Record<string, unknown>[] = [];
  const textByMessage = new Map<string, string>();
  let runError: string | undefined;

  await new Promise<void>((resolveTurn) => {
    agent.run(input).subscribe({
      next: (event) => {
        const e = event as unknown as Record<string, unknown>;
        const type = e.type;
        if (
          type === EventType.RUN_STARTED ||
          type === EventType.RUN_FINISHED
        )
          return; // we synthesize these so RUN_STARTED carries the user message
        if (type === EventType.RUN_ERROR) {
          runError = String(e.message ?? 'Run error');
          return;
        }
        if (type === EventType.TEXT_MESSAGE_CONTENT) {
          const id = String(e.messageId);
          textByMessage.set(id, (textByMessage.get(id) ?? '') + String(e.delta ?? ''));
        }
        contentEvents.push(e);
      },
      error: (err) => {
        runError = err instanceof Error ? err.message : String(err);
        resolveTurn();
      },
      complete: () => resolveTurn(),
    });
  });

  if (runError) throw new Error(runError);

  const assistantText = [...textByMessage.values()].join('\n').trim();
  const assistantMessage = {
    id: randomUUID(),
    role: 'assistant' as const,
    content: assistantText,
  };

  // Full transcript snapshot = prior messages + this turn's two messages.
  const store = GLOBAL_STORE as unknown as StoreForTurn;
  const prior = (store.peek(params.threadId)?.messagesSnapshot ?? []) as unknown[];
  const messages = [...prior, userMessage, assistantMessage];

  const events = [
    {
      type: EventType.RUN_STARTED,
      threadId: params.threadId,
      runId,
      input: { messages: [userMessage] },
    },
    ...contentEvents,
    { type: EventType.RUN_FINISHED, threadId: params.threadId, runId },
  ];

  store.getOrCreate(params.threadId);
  store.appendRun(params.threadId, {
    threadId: params.threadId,
    runId,
    agentId: dot.id,
    parentRunId: null,
    events,
    messages,
    createdAt: Date.now(),
  });

  return { text: assistantText, runId };
}
