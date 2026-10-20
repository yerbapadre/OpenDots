import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lightweight per-run logger. Writes a transcript to data/logs/<name>.log and,
 * in dev, mirrors each line to the server console (prefixed with the run name).
 *
 * Enabled by default outside production; set DOTS_LOG=0 to silence file logging,
 * DOTS_LOG=1 to force it on in production. The console mirror follows the same
 * switch but is additionally suppressed when NODE_ENV === 'production'.
 *
 * NEVER pass secrets here: args/env for spawned processes contain tokens and
 * API keys, so callers log a redacted summary, not the raw argv/env.
 */
export interface RunLog {
  readonly path: string | null;
  write(line: string): void;
  close(): void;
}

const LOG_DIR = resolve(process.env.DOTS_LOG_DIR ?? 'data/logs');

function enabled(): boolean {
  if (process.env.DOTS_LOG === '0') return false;
  if (process.env.DOTS_LOG === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

const NOOP: RunLog = { path: null, write: () => {}, close: () => {} };

export function createRunLog(name: string): RunLog {
  if (!enabled()) return NOOP;

  let stream: WriteStream;
  let path: string;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    path = resolve(LOG_DIR, `${safeName(name)}.log`);
    stream = createWriteStream(path, { flags: 'a' });
  } catch {
    return NOOP;
  }

  const mirror = process.env.NODE_ENV !== 'production';
  const write = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    try {
      stream.write(stamped + '\n');
    } catch {
      /* best-effort logging; never throw into the request path */
    }
    // Mirror to STDERR, never stdout: this logger also runs inside the stdio
    // MCP server (dot-mcp-server.ts), whose stdout is the JSON-RPC channel.
    // Writing to stdout there would corrupt the MCP stream and hang the Dot.
    if (mirror) process.stderr.write(`[${safeName(name)}] ${line}\n`);
  };

  write(`--- run log opened: ${path} ---`);
  return {
    path,
    write,
    close: () => {
      try {
        stream.end();
      } catch {
        /* ignore */
      }
    },
  };
}
