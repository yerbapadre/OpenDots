import { WorkspaceStore } from '../src/server/workspace.js';
import { ComputerService } from '../src/server/computer-service.js';
import { CodingTaskService } from '../src/server/coding-task-service.js';
import { ClaudeCliDotAgent } from '../src/server/claude-cli-dot-agent.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
import type { RunAgentInput } from '@ag-ui/core';

const ws = new WorkspaceStore('data/opendots.sqlite', 'opendots-owner');
const dot = ws.dots()[0];
const threadId = ws.conversations()[0].id;
const config = {
  runtimeUrl: 'http://127.0.0.1:4310/api/copilotkit',
  voiceName: 'marin',
  slackUsers: [],
  baseUrl: '',
} as unknown as PlatformConfig;
const computers = new ComputerService(ws, config, () => false);
const codingTasks = new CodingTaskService(ws.codingTasks);
console.log('pending notices BEFORE:', codingTasks.pendingNotices(threadId).map(t => t.id));

const agent = new ClaudeCliDotAgent(dot, config, ws, computers, codingTasks);
const input = {
  threadId,
  runId: 'notice-check',
  messages: [{ id: 'm1', role: 'user', content: 'Reply in one short sentence.' }],
  state: {}, tools: [], context: [], forwardedProps: {},
} as unknown as RunAgentInput;

agent.run(input).subscribe({
  next: (event) => {
    const e = event as unknown as Record<string, unknown>;
    if (e.type === 'TEXT_MESSAGE_CONTENT') console.log('DOT SAYS:', e.delta);
    if (e.type === 'RUN_ERROR') console.log('RUN_ERROR:', e.message);
  },
  complete: () => {
    console.log('pending notices AFTER:', codingTasks.pendingNotices(threadId).map(t => t.id));
    ws.close();
    process.exit(0);
  },
});
