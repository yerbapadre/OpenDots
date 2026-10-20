import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { callOpenDotsApi as callApi, toolText as text } from './dot-api.js';
import { isValidCron, type ScheduledTurn } from '../shared/scheduled-turn.js';

// Lets a Dot schedule its own recurring work. The scheduled turn runs this same
// Dot in this same conversation on a cron schedule; results appear in the thread.
// Enqueued over HTTP to the main server (the per-turn MCP subprocess can't hold
// a schedule). Use for "every morning…", "every hour…", "each Monday…".

export function schedulingToolDefs() {
  const dotId = process.env.DOT_ID ?? '';
  const threadId = process.env.THREAD_ID ?? '';
  return [
    tool(
      'schedule_task',
      'Schedule a recurring task that runs YOU in THIS conversation on a cron schedule. ' +
        'cron is standard 5-field "minute hour day-of-month month day-of-week" in the server timezone ' +
        '(e.g. "0 9 * * 1-5" = 9am weekdays, "*/30 * * * *" = every 30 min). ' +
        'The prompt is what you will be asked to do each time. Results post into this conversation. ' +
        'Use when the user wants something done on a schedule.',
      { prompt: z.string(), cron: z.string() },
      async ({ prompt, cron }) => {
        if (!isValidCron(cron))
          return text(
            `"${cron}" is not a valid 5-field cron expression. Example: "0 9 * * 1-5" for 9am on weekdays.`,
          );
        const turn = (await callApi('/scheduled-turns', {
          method: 'POST',
          body: JSON.stringify({ dotId, threadId, prompt, cron }),
        })) as ScheduledTurn;
        return text(
          `Scheduled task ${turn.id} on "${turn.cron}". It will run in this conversation and post results here. Use list_scheduled_tasks to review or cancel_scheduled_task to stop it.`,
        );
      },
    ),
    tool(
      'list_scheduled_tasks',
      'List the scheduled tasks for this conversation, with their cron schedule and last run status.',
      {},
      async () => {
        const { scheduledTurns } = (await callApi(
          `/scheduled-turns?threadId=${encodeURIComponent(threadId)}`,
        )) as { scheduledTurns: ScheduledTurn[] };
        if (!scheduledTurns.length)
          return text('No scheduled tasks for this conversation.');
        return text(
          scheduledTurns
            .map(
              (t) =>
                `[${t.id}] "${t.cron}" ${t.enabled ? 'enabled' : 'disabled'} — ${t.prompt.slice(0, 80)}${t.lastStatus ? ` (last: ${t.lastStatus})` : ''}`,
            )
            .join('\n'),
        );
      },
    ),
    tool(
      'cancel_scheduled_task',
      'Cancel (delete) a scheduled task by its id.',
      { taskId: z.string() },
      async ({ taskId }) => {
        await callApi(`/scheduled-turns/${encodeURIComponent(taskId)}`, {
          method: 'DELETE',
        });
        return text(`Cancelled scheduled task ${taskId}.`);
      },
    ),
  ];
}
