import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/server/workspace.js';

const dbPath = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const ws = new WorkspaceStore(dbPath, process.env.OWNER_ID ?? 'opendots-owner');
const dot = ws.dots()[0];
ws.close();

const MCP_SERVER = resolve('src/server/dot-mcp-server.ts');
const mcpConfig = JSON.stringify({
  mcpServers: {
    dot: {
      type: 'stdio',
      command: process.execPath,
      args: ['--import', 'tsx', MCP_SERVER],
      env: { ...process.env, DOT_ID: dot.id, DATABASE_PATH: dbPath },
    },
  },
});

const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;

const child = spawn(
  'claude',
  [
    '--print',
    'A user asks you to "spawn a coding task on leland-monorepo to add a test for formatName". Do you have a tool that can do this? Name it exactly. Do NOT call any tool — just answer in one sentence.',
    '--output-format',
    'stream-json',
    '--verbose',
    '--system-prompt',
    dot.instructions,
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
    '--model',
    'claude-opus-4-8',
  ],
  { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
);

console.log('system prompt =', JSON.stringify(dot.instructions));
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
        const toolList = (m.tools as string[]) ?? [];
        console.log('TOOL COUNT:', toolList.length);
        console.log(
          'spawn_coding_task present?',
          toolList.includes('mcp__dot__spawn_coding_task'),
        );
      }
      else if (m.type === 'assistant') {
        const content =
          (m.message as { content?: unknown[] } | undefined)?.content ?? [];
        for (const raw of content) {
          const b = raw as Record<string, unknown>;
          if (b.type === 'text' && b.text) console.log('DOT SAYS:', b.text);
        }
      }
    } catch {
      continue;
    }
  }
});
child.on('close', (code) => console.log('exit', code));
