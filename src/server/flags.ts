import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Non-secret, agent-readable behavioral flags live in opendots.flags.json at
// the repo root (committed), unlike secrets which stay in the gitignored .env.
// Values are applied as DEFAULTS: anything already present in the environment
// (including values loaded from .env) takes precedence, so operators can still
// override any flag per-machine without editing the committed file.
const FLAGS_FILE = 'opendots.flags.json';

export function applyFlags(env: NodeJS.ProcessEnv = process.env): void {
  let flags: Record<string, unknown>;
  try {
    flags = JSON.parse(
      readFileSync(resolve(process.cwd(), FLAGS_FILE), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    // No flags file (or it is unreadable/invalid) — rely on the environment.
    return;
  }
  for (const [key, value] of Object.entries(flags)) {
    if (key.startsWith('_')) continue; // documentation keys like _comment
    if (value === null || value === undefined || value === '') continue;
    if (env[key] === undefined || env[key] === '') env[key] = String(value);
  }
}
