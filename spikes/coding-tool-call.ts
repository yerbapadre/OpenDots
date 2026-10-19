import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkspaceStore } from '../src/server/workspace.js';

const dbPath = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const ws = new WorkspaceStore(dbPath, process.env.OWNER_ID ?? 'opendots-owner');
const dotId = ws.dots()[0].id;
ws.close();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/server/dot-mcp-server.ts'],
  env: { ...process.env, DOT_ID: dotId, DATABASE_PATH: dbPath },
});
const client = new Client({ name: 'coding-tool-call', version: '0.1.0' });
await client.connect(transport);

console.log('calling spawn_coding_task (repo="leland-monorepo")...');
try {
  const result = await client.callTool(
    {
      name: 'spawn_coding_task',
      arguments: {
        task: 'Add a unit test for formatName covering the last-initial case.',
        repo: 'leland-monorepo',
      },
    },
    undefined,
    { timeout: 900000 },
  );
  console.log('RESULT:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('TOOL CALL ERROR:', error);
}
await client.close();
process.exit(0);
