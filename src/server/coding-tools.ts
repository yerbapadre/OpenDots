import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runCodingTask } from './coding-task.js';

const REPOS_DIR = process.env.CODING_REPOS_DIR ?? '/Users/jakeevans/Leland';
const DEFAULT_REPO = process.env.CODING_REPO ?? `${REPOS_DIR}/leland-monorepo`;

function resolveRepoPath(repo?: string): string {
  if (!repo) return DEFAULT_REPO;
  if (repo.startsWith('/')) return repo;
  const name = repo.split('/').filter(Boolean).pop() ?? '';
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..'))
    throw new Error(`Invalid repo name: ${repo}`);
  return `${REPOS_DIR}/${name}`;
}

export function codingToolDefs() {
  return [
    tool(
      'spawn_coding_task',
      'Spawn a coding agent to implement a change and open a draft PR. Works in an isolated git worktree off the base branch, commits, pushes, and opens a draft PR. Returns the branch and PR URL. The repo argument is a repo name (e.g. "leland-monorepo") or an absolute path, and defaults to the configured repo if omitted. Use for requests like "implement X", "fix bug Y", or "add a test for Z".',
      {
        task: z.string(),
        repo: z.string().optional(),
        base: z.string().optional(),
      },
      async ({ task, repo, base }) => {
        const result = await runCodingTask({
          repoPath: resolveRepoPath(repo),
          task,
          base,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      },
    ),
  ];
}
