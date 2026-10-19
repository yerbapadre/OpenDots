import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkspaceStore } from '../src/server/workspace.js';

const dbPath = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const ownerId = process.env.OWNER_ID ?? 'opendots-owner';

const workspace = new WorkspaceStore(dbPath, ownerId);
const dotId = workspace.dots()[0].id;
workspace.close();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/server/dot-mcp-server.ts'],
  env: { ...process.env, DOT_ID: dotId, DATABASE_PATH: dbPath, OWNER_ID: ownerId },
});
const client = new Client({ name: 'tools-list', version: '0.1.0' });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

const names = tools.map((t) => t.name);
console.log('TOOLS:', names.join(', '));
console.log(
  names.includes('spawn_coding_task')
    ? 'OK: spawn_coding_task registered.'
    : 'MISSING: spawn_coding_task not found.',
);
process.exit(names.includes('spawn_coding_task') ? 0 : 1);
