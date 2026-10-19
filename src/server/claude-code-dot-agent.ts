import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { AbstractAgent } from '@ag-ui/client';
import { type BaseEvent, type RunAgentInput, EventType } from '@ag-ui/core';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Dot } from '../shared/types.js';
import type { PlatformConfig } from './platform-config.js';
import type { WorkspaceStore } from './workspace.js';
import { createDotMcpServer } from './dot-tools.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

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
    private readonly workspace: WorkspaceStore,
  ) {
    super({ agentId: dot.id });
  }

  clone() {
    return new ClaudeCodeDotAgent(this.dot, this.platformConfig, this.workspace);
  }

  abortRun() {
    this.controller?.abort();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController();
      this.controller = controller;
      const resume = this.workspace.getThreadSession(input.threadId);

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
              tools: [],
              mcpServers: {
                dot: createDotMcpServer(this.dot, this.workspace),
              },
              allowedTools: [
                'mcp__dot__list_spaces',
                'mcp__dot__list_pages',
                'mcp__dot__read_page',
                'mcp__dot__create_page',
              ],
              permissionMode: 'default',
              abortController: controller,
              canUseTool: async (toolName, toolInput) =>
                toolName.startsWith('mcp__dot__')
                  ? { behavior: 'allow', updatedInput: toolInput }
                  : {
                      behavior: 'deny',
                      message: "Only this Dot's own data tools are enabled.",
                    },
              ...(resume ? { resume } : {}),
            },
          });

          for await (const message of run) {
            if (message.type === 'system' && message.subtype === 'init') {
              this.workspace.setThreadSession(input.threadId, message.session_id);
            } else if (message.type === 'assistant') {
              for (const block of message.message.content) {
                if (block.type === 'text' && block.text) {
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
                } else if (block.type === 'tool_use') {
                  emit({
                    type: EventType.TOOL_CALL_START,
                    toolCallId: block.id,
                    toolCallName: block.name,
                  });
                  emit({
                    type: EventType.TOOL_CALL_ARGS,
                    toolCallId: block.id,
                    delta: JSON.stringify(block.input ?? {}),
                  });
                  emit({ type: EventType.TOOL_CALL_END, toolCallId: block.id });
                }
              }
            } else if (message.type === 'result') {
              this.workspace.setThreadSession(input.threadId, message.session_id);
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
