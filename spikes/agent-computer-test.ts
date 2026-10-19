import { ClaudeCodeDotAgent } from '../src/server/claude-code-dot-agent.js';
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

async function ensureComputer(): Promise<void> {
  await computers.permissions(dot.id, {
    enabled: true,
    browser: false,
    files: true,
    shell: false,
  });
  await computers.start(dot.id);
  for (let i = 0; i < 30; i += 1) {
    const status = await computers.status(dot.id);
    if (status.state === 'running') return;
    if (status.state === 'unavailable') throw new Error('computer unavailable');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('computer did not start');
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('Set ANTHROPIC_API_KEY in the mini .env first.');

  console.log('ensuring Dot computer is running + files enabled...');
  await ensureComputer();

  const agent = new ClaudeCodeDotAgent(dot, config, workspace, computers);
  const input = {
    threadId: 'computer-test-thread',
    runId: 'computer-test-run',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content:
          'Use your computer tools: write a file named agent.txt containing exactly "written by the agent" to your computer, then read it back and tell me its contents.',
      },
    ],
    state: {},
    tools: [],
    context: [],
  } as unknown as RunAgentInput;

  await new Promise<void>((resolve) => {
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
      error: (err) => {
        console.error('OBSERVABLE ERROR:', err);
        resolve();
      },
      complete: () => resolve(),
    });
  });

  const readBack = await computers.action(
    dot.id,
    'files_read',
    { path: 'agent.txt' },
    'owner',
  );
  console.log('\nFILE ON DISK (read via ComputerService):', JSON.stringify(readBack));
  const ok = JSON.stringify(readBack).includes('written by the agent');
  console.log(
    ok
      ? 'FULL PATH OK: Claude Code wrote a file into its container via the MCP computer tool.'
      : 'INCOMPLETE: agent did not write the expected file.',
  );
  workspace.close();
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('AGENT COMPUTER TEST FAILED:', error);
  process.exit(1);
});
