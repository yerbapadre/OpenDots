import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkspaceStore } from '../src/server/workspace.js';

const dbPath = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const ownerId = process.env.OWNER_ID ?? 'opendots-owner';

const workspace = new WorkspaceStore(dbPath, ownerId);
const dotId = workspace.dots()[0].id;
workspace.close();
console.log('dotId:', dotId);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/server/dot-mcp-server.ts'],
  env: { ...process.env, DOT_ID: dotId, DATABASE_PATH: dbPath, OWNER_ID: ownerId },
});

const client = new Client({ name: 'smoke', version: '0.1.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log('TOOLS EXPOSED:', tools.map((t) => t.name).join(', '));
await client.close();

const names = tools.map((t) => t.name);
const ok =
  names.includes('list_spaces') &&
  names.includes('create_page') &&
  names.includes('computer_files_write');
console.log(
  ok
    ? '\nMCP SERVER OK: standalone stdio server exposes dot + computer tools.'
    : '\nMCP SERVER INCOMPLETE: missing expected tools.',
);
process.exit(ok ? 0 : 1);
