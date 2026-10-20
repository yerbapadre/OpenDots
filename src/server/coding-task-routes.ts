import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { CodingTask } from '../shared/coding-task.js';
import type { CodingTaskService } from './coding-task-service.js';
import type { WorkspaceStore } from './workspace.js';

const spawnSchema = z.object({
  dotId: z.string().min(1),
  threadId: z.string().min(1),
  task: z.string().min(1).max(10_000),
  repo: z.string().max(500).optional(),
  base: z.string().max(200).optional(),
});

export function codingTaskRoutes(
  tasks: CodingTaskService,
  workspace: WorkspaceStore,
) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof SyntaxError)
      return c.json({ error: 'Invalid JSON request.' }, 400);
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid coding task request.' }, 400);
    if (error.message === 'Conversation not found.')
      return c.json({ error: error.message }, 404);
    if (error.message.startsWith('Invalid repo name'))
      return c.json({ error: error.message }, 400);
    return c.json({ error: error.message }, 503);
  });

  app.post('/coding-tasks', async (c) => {
    const body = spawnSchema.parse(await c.req.json());
    if (!workspace.dot(body.dotId))
      return c.json({ error: 'Dot not found.' }, 404);
    workspace.requireThread(body.threadId);
    const result = tasks.spawn(body);
    return c.json(result, result.duplicate ? 200 : 201);
  });

  app.get('/coding-tasks', (c) =>
    c.json({
      tasks: tasks.list({
        dotId: c.req.query('dotId') || undefined,
        threadId: c.req.query('threadId') || undefined,
      }),
    }),
  );

  app.get('/coding-tasks/:id', (c) => {
    const task = tasks.get(c.req.param('id'));
    return task
      ? c.json(task)
      : c.json({ error: 'Coding task not found.' }, 404);
  });

  // One-way push channel: every status change streams here. The client uses
  // fetch-based SSE so the owner token travels in the Authorization header.
  app.get('/coding-tasks-stream', (c) =>
    streamSSE(c, async (stream) => {
      let settle = () => {};
      const closed = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const onTask = (task: CodingTask) =>
        void stream
          .writeSSE({ event: 'task', data: JSON.stringify(task) })
          .catch(settle);
      tasks.on('task', onTask);
      const heartbeat = setInterval(
        () => void stream.writeSSE({ event: 'ping', data: '' }).catch(settle),
        25_000,
      );
      stream.onAbort(settle);
      await stream.writeSSE({ event: 'ready', data: '' });
      await closed;
      clearInterval(heartbeat);
      tasks.off('task', onTask);
    }),
  );

  return app;
}
