import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const testServer = createSdkMcpServer({
  name: 'test',
  version: '0.1.0',
  tools: [
    tool('ping', 'Replies with pong.', {}, async () => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    })),
  ],
});

const run = query({
  prompt:
    'First call the ping tool. Then try to run the shell command `whoami` with Bash.',
  options: {
    model: 'claude-opus-4-8',
    maxTurns: 3,
    settingSources: [],
    tools: [],
    mcpServers: { test: testServer },
    allowedTools: ['mcp__test__ping'],
    permissionMode: 'default',
    canUseTool: async (name, input) =>
      name.startsWith('mcp__')
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'native tools disabled' },
  },
});

for await (const message of run) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log('AVAILABLE TOOLS:', JSON.stringify(message.tools));
    const natives = message.tools.filter((t) => !t.startsWith('mcp__'));
    console.log('NON-MCP TOOLS PRESENT:', JSON.stringify(natives));
  } else if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') console.log('TEXT:', block.text);
      else if (block.type === 'tool_use')
        console.log('TOOL_USE:', block.name);
    }
  } else if (message.type === 'result') {
    const denials = (message as Record<string, unknown>).permission_denials;
    console.log('RESULT:', message.subtype, '| denials:', JSON.stringify(denials));
  }
}
