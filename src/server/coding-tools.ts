import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { describeCodingTask, type CodingTask } from '../shared/coding-task.js';

// These tools run inside the per-turn Dot MCP subprocess, which dies when the
// turn ends. Long-running work therefore cannot execute here: spawn_coding_task
// enqueues the task over HTTP to the long-lived main server and returns
// immediately. The server reports completion via SSE and next-turn notices.

function apiConfig() {
  const base = process.env.OPENDOTS_API_URL;
  if (!base)
    throw new Error(
      'OPENDOTS_API_URL is not configured for the Dot MCP server.',
    );
  const token = process.env.OWNER_TOKEN;
  return {
    base,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

async function callApi(path: string, init?: RequestInit): Promise<unknown> {
  const { base, headers } = apiConfig();
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok)
    throw new Error(data.error ?? `Coding task API returned ${response.status}.`);
  return data;
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

export function codingToolDefs() {
  const dotId = process.env.DOT_ID ?? '';
  const threadId = process.env.THREAD_ID ?? '';
  return [
    tool(
      'spawn_coding_task',
      'Start a background coding agent that implements a change and opens a draft PR. Returns immediately with a task id and branch; the work continues after this conversation turn ends. You will receive a notice in this conversation when it finishes, and check_coding_tasks shows live status. The repo argument is a repo name (e.g. "leland-monorepo") or an absolute path, defaulting to the configured repo.',
      {
        task: z.string(),
        repo: z.string().optional(),
        base: z.string().optional(),
      },
      async ({ task, repo, base }) => {
        const result = (await callApi('/coding-tasks', {
          method: 'POST',
          body: JSON.stringify({ dotId, threadId, task, repo, base }),
        })) as { task: CodingTask; duplicate: boolean };
        if (result.duplicate)
          return text(
            `An identical task is already running (id ${result.task.id}, branch ${result.task.branch}, started ${new Date(result.task.createdAt).toISOString()}). Not starting a second one.`,
          );
        return text(
          `Started background coding task ${result.task.id} on branch ${result.task.branch}. It will open a draft PR when done; a notice will arrive in this conversation. Tell the user it is running — do not wait for it.`,
        );
      },
    ),
    tool(
      'check_coding_tasks',
      'Check the status of background coding tasks spawned from this conversation (or one task by id). Shows running, pr_open (with the PR URL), and failed tasks.',
      { taskId: z.string().optional() },
      async ({ taskId }) => {
        if (taskId) {
          const task = (await callApi(
            `/coding-tasks/${encodeURIComponent(taskId)}`,
          )) as CodingTask;
          return text(describeCodingTask(task));
        }
        const { tasks } = (await callApi(
          `/coding-tasks?threadId=${encodeURIComponent(threadId)}`,
        )) as { tasks: CodingTask[] };
        if (!tasks.length)
          return text('No coding tasks have been spawned from this conversation.');
        return text(
          tasks
            .map((task) => `[${task.id}] ${describeCodingTask(task)}`)
            .join('\n'),
        );
      },
    ),
  ];
}
