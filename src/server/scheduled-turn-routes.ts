import { Hono } from 'hono';
import { z } from 'zod';
import { isValidCron } from '../shared/scheduled-turn.js';
import type { ScheduledTurnService } from './scheduled-turn-service.js';
import type { WorkspaceStore } from './workspace.js';

const createSchema = z.object({
  dotId: z.string().min(1),
  threadId: z.string().min(1),
  prompt: z.string().min(1).max(10_000),
  cron: z.string().min(1).max(100),
});

export function scheduledTurnRoutes(
  scheduler: ScheduledTurnService,
  workspace: WorkspaceStore,
) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof SyntaxError)
      return c.json({ error: 'Invalid JSON request.' }, 400);
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid scheduled-turn request.' }, 400);
    if (error.message === 'Conversation not found.')
      return c.json({ error: error.message }, 404);
    if (error.message.startsWith('Invalid cron'))
      return c.json({ error: error.message }, 400);
    return c.json({ error: error.message }, 503);
  });

  app.post('/scheduled-turns', async (c) => {
    const body = createSchema.parse(await c.req.json());
    if (!isValidCron(body.cron))
      return c.json({ error: `Invalid cron expression: "${body.cron}"` }, 400);
    if (!workspace.dot(body.dotId))
      return c.json({ error: 'Dot not found.' }, 404);
    workspace.requireThread(body.threadId);
    return c.json(scheduler.create(body), 201);
  });

  app.get('/scheduled-turns', (c) =>
    c.json({
      scheduledTurns: scheduler.list({
        dotId: c.req.query('dotId') || undefined,
        threadId: c.req.query('threadId') || undefined,
      }),
    }),
  );

  app.patch('/scheduled-turns/:id', async (c) => {
    const body = (await c.req.json()) as { enabled?: boolean };
    const updated = scheduler.setEnabled(c.req.param('id'), !!body.enabled);
    return updated
      ? c.json(updated)
      : c.json({ error: 'Scheduled turn not found.' }, 404);
  });

  app.delete('/scheduled-turns/:id', (c) => {
    scheduler.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  return app;
}
