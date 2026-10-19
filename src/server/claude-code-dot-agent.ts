import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { AbstractAgent } from '@ag-ui/client';
import { type BaseEvent, type RunAgentInput, EventType } from '@ag-ui/core';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Dot } from '../shared/types.js';
import type { PlatformConfig } from './platform-config.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

export interface ThreadSessionStore {
  getThreadSession(threadId: string): string | undefined;
  setThreadSession(threadId: string, sessionId: string): void;
}

function latestUserText(messages: RunAgentInput['messages']): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content))
      return content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
  }
  return '';
}

export class ClaudeCodeDotAgent extends AbstractAgent {
  private controller?: AbortController;

  constructor(
    private readonly dot: Dot,
    private readonly platformConfig: PlatformConfig,
    private readonly sessions: ThreadSessionStore,
  ) {
    super({ agentId: dot.id });
  }

  clone() {
    return new ClaudeCodeDotAgent(this.dot, this.platformConfig, this.sessions);
  }

  abortRun() {
    this.controller?.abort();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController();
      this.controller = controller;
      const resume = this.sessions.getThreadSession(input.threadId);

      const emit = (event: Record<string, unknown>) =>
        subscriber.next(event as BaseEvent);

      void (async () => {
        let failed = false;
        try {
          emit({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });

          const run = query({
            prompt: latestUserText(input.messages),
            options: {
              model: DEFAULT_MODEL,
              systemPrompt: this.dot.instructions,
              settingSources: [],
              allowedTools: [],
              permissionMode: 'default',
              abortController: controller,
              canUseTool: async () => ({
                behavior: 'deny',
                message:
                  'Tools are disabled for this Dot until the tool bridge ships.',
              }),
              ...(resume ? { resume } : {}),
            },
          });

          for await (const message of run) {
            if (message.type === 'system' && message.subtype === 'init') {
              this.sessions.setThreadSession(input.threadId, message.session_id);
            } else if (message.type === 'assistant') {
              for (const block of message.message.content) {
                if (block.type !== 'text' || !block.text) continue;
                const messageId = randomUUID();
                emit({
                  type: EventType.TEXT_MESSAGE_START,
                  messageId,
                  role: 'assistant',
                });
                emit({
                  type: EventType.TEXT_MESSAGE_CONTENT,
                  messageId,
                  delta: block.text,
                });
                emit({ type: EventType.TEXT_MESSAGE_END, messageId });
              }
            } else if (message.type === 'result') {
              this.sessions.setThreadSession(input.threadId, message.session_id);
              if (message.subtype !== 'success') {
                emit({
                  type: EventType.RUN_ERROR,
                  message: `Claude Code ended: ${message.subtype}`,
                });
                failed = true;
              }
            }
          }

          if (!failed)
            emit({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
          subscriber.complete();
        } catch (error) {
          emit({
            type: EventType.RUN_ERROR,
            message:
              error instanceof Error ? error.message : 'Claude Code run failed.',
          });
          subscriber.complete();
        }
      })();

      return () => controller.abort();
    });
  }
}
