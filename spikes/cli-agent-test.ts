import { ClaudeCliDotAgent } from '../src/server/claude-cli-dot-agent.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { ComputerService } from '../src/server/computer-service.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
import type { RunAgentInput } from '@ag-ui/core';

const workspace = new WorkspaceStore(
  process.env.DATABASE_PATH ?? 'data/opendots.sqlite',
  process.env.OWNER_ID ?? 'opendots-owner',
);
const dot = workspace.dots()[0];
const config = {
  computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
  computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  baseUrl: '',
  voiceName: 'marin',
  slackUsers: [],
  runtimeUrl: '',
} as PlatformConfig;
const computers = new ComputerService(workspace, config, () => false);

const agent = new ClaudeCliDotAgent(dot, config, workspace, computers);

const input = {
  threadId: 'cli-test-thread',
  runId: 'cli-test-run',
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'Use your tools to list my Spaces, then tell me their names. Be brief.',
    },
  ],
  state: {},
  tools: [],
  context: [],
} as unknown as RunAgentInput;

agent.run(input).subscribe({
  next: (event) => {
    const e = event as Record<string, unknown>;
    const detail =
      e.toolCallName !== undefined
        ? ` tool=${String(e.toolCallName)}`
        : e.delta !== undefined
          ? ` delta=${JSON.stringify(e.delta)}`
          : e.message !== undefined
            ? ` message=${JSON.stringify(e.message)}`
            : '';
    console.log(`EVENT ${String(e.type)}${detail}`);
  },
  error: (err) => console.error('OBSERVABLE ERROR:', err),
  complete: () => {
    console.log('\nCLI PATH: run complete.');
    process.exit(0);
  },
});
