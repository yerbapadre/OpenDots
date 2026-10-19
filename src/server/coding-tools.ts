import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runCodingTask } from './coding-task.js';

const DEFAULT_REPO =
  process.env.CODING_REPO ?? '/Users/jakeevans/Leland/leland-monorepo';

export function codingToolDefs() {
  return [
    tool(
      'spawn_coding_task',
      'Spawn a coding agent to implement a change and open a draft PR. The agent works in an isolated git worktree off the base branch, commits, pushes, and opens a draft PR. Returns the branch and PR URL. Use for requests like "implement X", "fix bug Y", or "add a test for Z".',
      {
        task: z.string(),
        repo: z.string().optional(),
        base: z.string().optional(),
      },
      async ({ task, repo, base }) => {
        const result = await runCodingTask({
          repoPath: repo ?? DEFAULT_REPO,
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
