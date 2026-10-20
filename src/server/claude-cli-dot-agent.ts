import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Observable } from 'rxjs';
import { AbstractAgent } from '@ag-ui/client';
import { type BaseEvent, type RunAgentInput, EventType } from '@ag-ui/core';
import type { Dot } from '../shared/types.js';
import type { PlatformConfig } from './platform-config.js';
import type { WorkspaceStore } from './workspace.js';
import type { ComputerService } from './computer-service.js';
import type { CodingTaskService } from './coding-task-service.js';
import { describeCodingTask } from '../shared/coding-task.js';
import { externalMcp } from './external-mcp.js';
import { createRunLog } from './run-log.js';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MCP_SERVER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'dot-mcp-server.ts',
);

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

export class ClaudeCliDotAgent extends AbstractAgent {
  private child?: ChildProcess;

  constructor(
    private readonly dot: Dot,
    private readonly platformConfig: PlatformConfig,
    private readonly workspace: WorkspaceStore,
    private readonly computers: ComputerService,
    private readonly codingTasks?: CodingTaskService,
  ) {
    super({ agentId: dot.id });
  }

  clone() {
    return new ClaudeCliDotAgent(
      this.dot,
      this.platformConfig,
      this.workspace,
      this.computers,
      this.codingTasks,
    );
  }

  abortRun() {
    this.child?.kill('SIGINT');
  }

  private mcpConfig(threadId: string): string {
    return JSON.stringify({
      mcpServers: {
        ...externalMcp().servers,
        dot: {
          type: 'stdio',
          command: process.execPath,
          args: ['--import', 'tsx', MCP_SERVER],
          env: {
            ...process.env,
            DOT_ID: this.dot.id,
            THREAD_ID: threadId,
            // Background coding tasks are enqueued over HTTP to the main
            // server so they outlive this per-turn MCP subprocess.
            OPENDOTS_API_URL: this.platformConfig.runtimeUrl.replace(
              /\/copilotkit$/,
              '',
            ),
            DATABASE_PATH: process.env.DATABASE_PATH ?? 'data/opendots.sqlite',
            OWNER_ID: process.env.OWNER_ID ?? 'opendots-owner',
            COMPUTER_SUPERVISOR_URL:
              this.platformConfig.computerSupervisorUrl ?? '',
            COMPUTER_SUPERVISOR_TOKEN:
              this.platformConfig.computerSupervisorToken ?? '',
            COMPUTER_TOKEN: this.platformConfig.computerToken ?? '',
            COMPUTER_NAMESPACE: this.platformConfig.computerNamespace ?? '',
          },
        },
      },
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const emit = (event: Record<string, unknown>) =>
        subscriber.next(event as BaseEvent);
      const resume = this.workspace.getThreadSession(input.threadId);
      const log = createRunLog(`dot-${input.threadId}-${input.runId}`);
      const userText = latestUserText(input.messages);
      log.write(
        `dot=${this.dot.id} model=${DEFAULT_MODEL} resume=${resume ?? 'none'}`,
      );
      log.write(`user> ${userText}`);

      // Finished background coding tasks are reported as a notice on the next
      // turn (the Claude Code pattern): prepend them to the prompt and mark
      // them notified only once this turn completes successfully.
      const notices = this.codingTasks?.pendingNotices(input.threadId) ?? [];
      const noticeIds = notices.map((task) => task.id);
      const prompt = notices.length
        ? `[Background task update — relay this to the user]\n${notices
            .map(describeCodingTask)
            .join('\n')}\n\n${userText}`
        : userText;
      if (notices.length) log.write(`notices> ${noticeIds.join(', ')}`);

      const args = [
        '--print',
        prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--system-prompt',
        this.dot.instructions,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        this.mcpConfig(input.threadId),
        // NOTE: do NOT pass `--tools ''` here. In the CLI, an empty --tools
        // means "disable ALL tools" (including MCP), so the Dot ends up with
        // zero tools and reports "I don't have a tool". To remove Claude Code's
        // native host tools while keeping the `dot` MCP tools, deny the native
        // set explicitly and allow only mcp__dot__*.
        '--disallowedTools',
        'Bash,BashOutput,KillShell,Read,Write,Edit,NotebookEdit,Glob,Grep,WebSearch,WebFetch,Task,TodoWrite',
        '--allowedTools',
        ['mcp__dot__*', ...externalMcp().allowedTools].join(','),
        '--permission-mode',
        'default',
        '--model',
        DEFAULT_MODEL,
        ...(resume ? ['--resume', resume] : []),
      ];

      const childEnv = { ...process.env };
      delete childEnv.ANTHROPIC_API_KEY;
      childEnv.MCP_TIMEOUT = childEnv.MCP_TIMEOUT ?? '60000';

      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });

      const child = spawn('claude', args, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;

      let buffer = '';
      let failed = false;
      let stderr = '';

      const persistSession = (sessionId: unknown) => {
        if (typeof sessionId === 'string' && sessionId)
          this.workspace.setThreadSession(input.threadId, sessionId);
      };

      const handle = (message: Record<string, unknown>) => {
        if (message.type === 'system' && message.subtype === 'init') {
          persistSession(message.session_id);
        } else if (message.type === 'assistant') {
          const content =
            (message.message as { content?: unknown[] } | undefined)?.content ??
            [];
          for (const raw of content) {
            const block = raw as Record<string, unknown>;
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
                delta: String(block.text),
              });
              emit({ type: EventType.TEXT_MESSAGE_END, messageId });
            } else if (block.type === 'tool_use') {
              const toolCallId = String(block.id);
              emit({
                type: EventType.TOOL_CALL_START,
                toolCallId,
                toolCallName: String(block.name),
              });
              emit({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId,
                delta: JSON.stringify(block.input ?? {}),
              });
              emit({ type: EventType.TOOL_CALL_END, toolCallId });
            }
          }
        } else if (message.type === 'result') {
          persistSession(message.session_id);
          if (message.subtype !== 'success') {
            emit({
              type: EventType.RUN_ERROR,
              message: `Claude CLI ended: ${String(message.subtype)}`,
            });
            failed = true;
          }
        }
      };

      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
        log.write(`stderr> ${String(chunk).trimEnd()}`);
      });
      child.stdout?.on('data', (chunk) => {
        buffer += String(chunk);
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line) continue;
          log.write(`claude> ${line}`);
          try {
            handle(JSON.parse(line) as Record<string, unknown>);
          } catch {
            continue;
          }
        }
      });

      child.on('error', (error) => {
        log.write(`spawn error: ${error.message}`);
        log.close();
        emit({
          type: EventType.RUN_ERROR,
          message: `Failed to spawn claude: ${error.message}`,
        });
        subscriber.complete();
      });
      child.on('close', (code) => {
        log.write(`claude exited ${String(code)}`);
        log.close();
        if (!failed && code !== 0)
          emit({
            type: EventType.RUN_ERROR,
            message: `claude exited ${String(code)}: ${stderr.slice(-500)}`,
          });
        else if (!failed) {
          if (noticeIds.length) this.codingTasks?.markNotified(noticeIds);
          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
        }
        subscriber.complete();
      });

      return () => child.kill('SIGINT');
    });
  }
}
