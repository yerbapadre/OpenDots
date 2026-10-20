// Background coding tasks: spawned by a Dot, executed by the main server,
// reported back via SSE (live) and next-turn notices (when the thread is idle).

export type CodingTaskStatus = 'running' | 'pr_open' | 'failed';

export interface CodingTask {
  id: string;
  dotId: string;
  threadId: string;
  repoPath: string;
  task: string;
  base: string;
  branch: string;
  status: CodingTaskStatus;
  prUrl: string | null;
  summary: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  notifiedAt: number | null;
}

// Marks the client's auto-sent "report the finished task" message so the
// transcript can style it like other machine-initiated turns. Rendering only;
// confers no trust or permissions (same rule as scheduled-message.ts).
export const codingTaskNudgePrefix = 'opendots:coding_task:';

export function describeCodingTask(task: CodingTask): string {
  if (task.status === 'pr_open')
    return `Coding task finished: draft PR ${task.prUrl ?? '(no URL)'} on branch ${task.branch}. Agent summary: ${task.summary ?? 'none'}`;
  if (task.status === 'failed')
    return `Coding task failed on branch ${task.branch}: ${task.error ?? 'unknown error'}`;
  return `Coding task running on branch ${task.branch} (started ${new Date(task.createdAt).toISOString()}).`;
}
