import { ClaudeCodeDotAgent } from '../src/server/claude-code-dot-agent.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
import type { RunAgentInput } from '@ag-ui/core';

const workspace = new WorkspaceStore(':memory:', 'verify-owner');
const dot = workspace.dots()[0];
const spaceId = dot.spaceIds?.[0] ?? dot.spaceId;

const agent = new ClaudeCodeDotAgent(dot, {} as PlatformConfig, workspace);

const input = {
  threadId: 'verify-thread',
  runId: 'verify-run',
  messages: [
    {
      id: 'm1',
      role: 'user',
      content:
        'Use your tools: list my spaces, then create a page in the first space titled "Hello" with content "Hi from a Dot".',
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
          : e.content !== undefined
            ? ` content=${JSON.stringify(e.content)}`
            : e.message !== undefined
              ? ` message=${JSON.stringify(e.message)}`
              : '';
    console.log(`EVENT ${String(e.type)}${detail}`);
  },
  error: (error) => console.error('OBSERVABLE ERROR:', error),
  complete: () => {
    const pages = workspace.pages.list(spaceId).map((page) => page.title);
    console.log('\nPAGES AFTER RUN:', JSON.stringify(pages));
    console.log(
      pages.includes('Hello')
        ? 'M3 OK: Dot created a page through the MCP tool bridge.'
        : 'M3 INCOMPLETE: no page created.',
    );
    workspace.close();
    process.exit(0);
  },
});
