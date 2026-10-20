import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { WorkspaceStore } from './workspace.js';
import { ComputerService } from './computer-service.js';
import type { PlatformConfig } from './platform-config.js';
import { dotToolDefs } from './dot-tools.js';
import { computerToolDefs } from './computer-mcp.js';
import { codingToolDefs } from './coding-tools.js';
import { schedulingToolDefs } from './scheduling-tools.js';

const dotId = process.env.DOT_ID;
if (!dotId) throw new Error('DOT_ID is required to run the Dot MCP server.');

const workspace = new WorkspaceStore(
  process.env.DATABASE_PATH ?? 'data/opendots.sqlite',
  process.env.OWNER_ID ?? 'opendots-owner',
);
const dot = workspace.dots().find((candidate) => candidate.id === dotId);
if (!dot) throw new Error(`Dot ${dotId} not found in the workspace.`);

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

const server = createSdkMcpServer({
  name: 'dot',
  version: '0.1.0',
  tools: [
    ...dotToolDefs(dot, workspace),
    ...computerToolDefs(dot.id, computers),
    ...codingToolDefs(),
    ...schedulingToolDefs(),
  ],
});

await server.instance.connect(new StdioServerTransport());
