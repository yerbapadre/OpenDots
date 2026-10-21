import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { httpDotToolDefs } from './dot-tools.js';
import { httpComputerToolDefs } from './computer-mcp.js';
import { codingToolDefs } from './coding-tools.js';
import { schedulingToolDefs } from './scheduling-tools.js';

// The per-turn MCP subprocess is a pure HTTP client of the long-lived main
// server: every tool reaches back over OPENDOTS_API_URL (authenticated with
// OWNER_TOKEN) rather than opening the workspace database or the computer
// supervisor directly. That keeps this process free of filesystem/DB coupling,
// so it can run anywhere — including inside the Dot's own container.
const dotId = process.env.DOT_ID;
if (!dotId) throw new Error('DOT_ID is required to run the Dot MCP server.');
if (!process.env.OPENDOTS_API_URL)
  throw new Error('OPENDOTS_API_URL is required to run the Dot MCP server.');

const server = createSdkMcpServer({
  name: 'dot',
  version: '0.1.0',
  tools: [
    ...httpDotToolDefs(),
    ...httpComputerToolDefs(dotId),
    ...codingToolDefs(),
    ...schedulingToolDefs(),
  ],
});

await server.instance.connect(new StdioServerTransport());
