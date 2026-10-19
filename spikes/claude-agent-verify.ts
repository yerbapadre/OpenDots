import { ClaudeCodeDotAgent } from '../src/server/claude-code-dot-agent.js';
import type { Dot } from '../src/shared/types.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
import type { RunAgentInput } from '@ag-ui/core';

const dot = {
  id: 'verify-dot',
  name: 'Verify Dot',
  instructions: 'You are a concise test Dot. Reply in exactly one short sentence.',
} as Dot;

const agent = new ClaudeCodeDotAgent(dot, {} as PlatformConfig);

const input = {
  threadId: 'verify-thread',
  runId: 'verify-run',
  messages: [{ id: 'm1', role: 'user', content: 'Introduce yourself briefly.' }],
  state: {},
  tools: [],
  context: [],
} as unknown as RunAgentInput;

agent.run(input).subscribe({
  next: (event) => {
    const e = event as Record<string, unknown>;
    const extra =
      e.delta !== undefined
        ? ` delta=${JSON.stringify(e.delta)}`
        : e.message !== undefined
          ? ` message=${JSON.stringify(e.message)}`
          : '';
    console.log(`EVENT ${String(e.type)}${extra}`);
  },
  error: (error) => console.error('OBSERVABLE ERROR:', error),
  complete: () => {
    console.log('\nCOMPLETE. Mapper emitted the AG-UI sequence above from a real Claude Code turn.');
    process.exit(0);
  },
});
