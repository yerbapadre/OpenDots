import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
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

// Each Dot works from its own home directory: its authored skills live in
// <home>/.claude/skills and its durable scratch/memory in <home>/memory. The
// home persists across turns (it is just a directory on disk).
function dotHome(dotId: string): string {
  const home = resolve(process.cwd(), 'data', 'dots', dotId);
  mkdirSync(resolve(home, '.claude', 'skills'), { recursive: true });
  mkdirSync(resolve(home, 'memory'), { recursive: true });
  return home;
}

// The codebase root a Dot may read and write. Full host access by design — the
// owner has opted out of sandboxing for now and supervises directly.
const ACCESS_DIR = process.env.DOTS_ACCESS_DIR ?? resolve(homedir(), 'Leland');

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
            // The Dot MCP subprocess is a pure HTTP client of the long-lived
            // main server: pages/spaces, computer actions, coding tasks and
            // scheduled turns all round-trip through its routes so this process
            // holds no database handle or supervisor credentials. It needs only
            // the API base and the owner token (required once requests cross a
            // container boundary instead of loopback).
            OPENDOTS_API_URL: this.platformConfig.runtimeUrl.replace(
              /\/copilotkit$/,
              '',
            ),
            OWNER_TOKEN: this.platformConfig.ownerToken ?? '',
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
        // Emit partial message chunks (Anthropic SSE deltas) as they arrive so
        // text types out live and tool-call args stream in, instead of each
        // complete block popping in at once.
        '--include-partial-messages',
        '--system-prompt',
        this.dot.instructions,
        // No --setting-sources override: load every source by default so each
        // Dot inherits the owner's full global Claude config — personal skills,
        // plugins, global settings.json (hooks included), and managed policy —
        // AND, because cwd is the Dot's own home, any skills it authors under
        // <home>/.claude/skills. (Owner chose global inheritance over per-Dot
        // isolation; flip by setting CLAUDE_CONFIG_DIR to the Dot's home.)
        //
        // The codebase the Dot may read and write, in addition to its home.
        '--add-dir',
        ACCESS_DIR,
        '--strict-mcp-config',
        '--mcp-config',
        this.mcpConfig(input.threadId),
        // Full host access by design: native tools (Bash/Read/Write/Edit/…),
        // the Skill system, and all configured MCP tools run without prompting.
        // The Dot is effectively a headless Claude Code instance with a role.
        // 'auto' matches the coding-task runner (runs tools headless) while
        // keeping more guardrails than bypassPermissions. Owner has opted out
        // of sandboxing for now.
        '--permission-mode',
        'auto',
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
        cwd: dotHome(this.dot.id),
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

      // With --include-partial-messages the CLI streams raw Anthropic SSE
      // events. Each content block is identified by its index; we map text
      // blocks to AG-UI message ids and tool blocks to tool-call ids so the
      // START/CONTENT/END deltas line up. The final complete `assistant`
      // message still arrives afterward and is intentionally ignored here to
      // avoid emitting every block twice.
      const textMessageIds = new Map<number, string>();
      const toolCallIds = new Map<number, string>();

      const handleStreamEvent = (event: Record<string, unknown>) => {
        const index = Number(event.index);
        switch (event.type) {
          case 'content_block_start': {
            const block = (event.content_block ?? {}) as Record<
              string,
              unknown
            >;
            if (block.type === 'text') {
              const messageId = randomUUID();
              textMessageIds.set(index, messageId);
              emit({
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: 'assistant',
              });
              if (block.text)
                emit({
                  type: EventType.TEXT_MESSAGE_CONTENT,
                  messageId,
                  delta: String(block.text),
                });
            } else if (block.type === 'tool_use') {
              const toolCallId = String(block.id);
              toolCallIds.set(index, toolCallId);
              emit({
                type: EventType.TOOL_CALL_START,
                toolCallId,
                toolCallName: String(block.name),
              });
            }
            break;
          }
          case 'content_block_delta': {
            const delta = (event.delta ?? {}) as Record<string, unknown>;
            if (delta.type === 'text_delta') {
              const messageId = textMessageIds.get(index);
              if (messageId)
                emit({
                  type: EventType.TEXT_MESSAGE_CONTENT,
                  messageId,
                  delta: String(delta.text ?? ''),
                });
            } else if (delta.type === 'input_json_delta') {
              const toolCallId = toolCallIds.get(index);
              if (toolCallId)
                emit({
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId,
                  delta: String(delta.partial_json ?? ''),
                });
            }
            break;
          }
          case 'content_block_stop': {
            const messageId = textMessageIds.get(index);
            if (messageId) {
              emit({ type: EventType.TEXT_MESSAGE_END, messageId });
              textMessageIds.delete(index);
            }
            const toolCallId = toolCallIds.get(index);
            if (toolCallId) {
              emit({ type: EventType.TOOL_CALL_END, toolCallId });
              toolCallIds.delete(index);
            }
            break;
          }
        }
      };

      const handle = (message: Record<string, unknown>) => {
        if (message.type === 'system' && message.subtype === 'init') {
          persistSession(message.session_id);
        } else if (message.type === 'stream_event') {
          handleStreamEvent((message.event ?? {}) as Record<string, unknown>);
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
        // `assistant` (complete message) is ignored: its blocks already
        // streamed via stream_event above.
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
