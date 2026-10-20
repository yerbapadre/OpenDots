import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRunLog, type RunLog } from './run-log.js';

export interface CodingTaskResult {
  branch: string;
  prUrl: string;
  summary: string;
}

const WORKTREE_ROOT = process.env.CODING_WORKTREE_ROOT ?? '/tmp/dots-worktrees';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function runCodingAgent(
  cwd: string,
  prompt: string,
  log: RunLog,
): Promise<string> {
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '--print',
        prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        process.env.CODING_MODEL ?? 'claude-opus-4-8',
        '--permission-mode',
        'auto',
      ],
      { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let buffer = '';
    let lastText = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      log.write(`coder stderr> ${String(chunk).trimEnd()}`);
    });
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;
        log.write(`coder> ${line}`);
        try {
          const m = JSON.parse(line) as Record<string, unknown>;
          if (m.type === 'assistant') {
            const content =
              (m.message as { content?: unknown[] } | undefined)?.content ?? [];
            for (const raw of content) {
              const b = raw as Record<string, unknown>;
              if (b.type === 'text' && b.text) lastText = String(b.text);
            }
          } else if (m.type === 'result' && m.subtype !== 'success') {
            reject(new Error(`coding agent ended: ${String(m.subtype)}`));
          }
        } catch {
          continue;
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(lastText)
        : reject(new Error(`claude exited ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

export async function runCodingTask(params: {
  repoPath: string;
  task: string;
  branch?: string;
  base?: string;
}): Promise<CodingTaskResult> {
  if (!existsSync(`${params.repoPath}/.git`))
    throw new Error(`${params.repoPath} is not a git repository.`);

  const base = params.base ?? 'main';
  const branch =
    params.branch ?? `dots/task-${Date.now().toString(36)}`;
  const worktree = `${WORKTREE_ROOT}/${branch.replace(/[^a-zA-Z0-9]/g, '_')}`;
  mkdirSync(WORKTREE_ROOT, { recursive: true });

  const log = createRunLog(`coding-${branch}`);
  log.write(`repo=${params.repoPath} base=${base} branch=${branch}`);
  log.write(`task> ${params.task}`);
  const step = (args: string[], cwd: string) => {
    log.write(`git ${args.join(' ')} (cwd=${cwd})`);
    return git(args, cwd);
  };

  step(['fetch', 'origin', base], params.repoPath);
  step(['worktree', 'add', worktree, '-b', branch, `origin/${base}`], params.repoPath);

  try {
    const summary = await runCodingAgent(
      worktree,
      `${params.task}\n\nMake only the code change. Do NOT run git commit, push, or open a PR — that is handled automatically.`,
      log,
    );

    const dirty = step(['status', '--porcelain'], worktree).trim();
    if (!dirty) throw new Error('The coding agent produced no changes.');

    step(['add', '-A'], worktree);
    const subject = params.task
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[.:]+$/, '')
      .slice(0, 68);
    step(['commit', '-m', `chore: ${subject}`], worktree);
    step(['push', '--no-verify', '-u', 'origin', branch], worktree);

    log.write(`gh pr create --draft --fill --head ${branch} --base ${base}`);
    const prUrl = execFileSync(
      'gh',
      ['pr', 'create', '--draft', '--fill', '--head', branch, '--base', base],
      { cwd: worktree, encoding: 'utf8' },
    ).trim();

    log.write(`PR: ${prUrl}`);
    return { branch, prUrl, summary };
  } catch (error) {
    log.write(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    try {
      step(['worktree', 'remove', '--force', worktree], params.repoPath);
    } catch {
      // Best-effort cleanup; a leftover worktree is logged, not fatal.
    }
    log.close();
  }
}
