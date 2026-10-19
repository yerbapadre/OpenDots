import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/server/workspace.js';

const dbPath = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const ws = new WorkspaceStore(dbPath, process.env.OWNER_ID ?? 'opendots-owner');
const dotId = ws.dots()[0].id;
ws.close();

const MCP_SERVER = resolve('src/server/dot-mcp-server.ts');
const mcpConfig = JSON.stringify({
  mcpServers: {
    dot: {
      type: 'stdio',
      command: process.execPath,
      args: ['--import', 'tsx', MCP_SERVER],
      env: {
        ...process.env,
        DOT_ID: dotId,
        DATABASE_PATH: dbPath,
        OWNER_ID: process.env.OWNER_ID ?? 'opendots-owner',
      },
    },
  },
});

const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;

const child = spawn(
  'claude',
  [
    '--print',
    'List the names of every tool available to you, one per line. Do nothing else.',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    'claude-opus-4-8',
    '--setting-sources',
    '',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--allowedTools',
    'mcp__dot__*',
    '--permission-mode',
    'default',
  ],
  { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
);

let buffer = '';
child.stderr.on('data', (c) => process.stderr.write(c));
child.stdout.on('data', (chunk) => {
  buffer += String(chunk);
  let nl = buffer.indexOf('\n');
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    nl = buffer.indexOf('\n');
    if (!line) continue;
    try {
      const m = JSON.parse(line) as Record<string, unknown>;
      if (m.type === 'system' && m.subtype === 'init') {
        console.log('MCP SERVERS:', JSON.stringify(m.mcp_servers));
        console.log('TOOLS:', JSON.stringify(m.tools));
      } else if (m.type === 'assistant') {
        const content =
          (m.message as { content?: unknown[] } | undefined)?.content ?? [];
        for (const raw of content) {
          const b = raw as Record<string, unknown>;
          if (b.type === 'text' && b.text) console.log('TEXT:', b.text);
        }
      } else if (m.type === 'result') console.log('RESULT:', m.subtype);
    } catch {
      continue;
    }
  }
});
child.on('close', (code) => console.log('exit', code));
