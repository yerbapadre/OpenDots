import { setupInputSchema } from './setup-telemetry.js';
import { pageRoutes } from './page-routes.js';
import { pageInput } from './pages.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { Platform } from './platform.js';
import { VoiceService } from './voice.js';
import {
  learningContainerIdSchema,
  validateLearningSettings,
} from '../shared/learning.js';
import { DOT_ICONS } from '../shared/types.js';
const dotSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    icon: z.enum(DOT_ICONS).optional(),
    instructions: z.string().trim().min(3).max(2000),
    researchAllowed: z.boolean(),
    memoryAllowed: z.boolean(),
    appsAllowed: z.boolean().default(false),
    composioToolkits: z
      .array(z.string().regex(/^[a-z0-9_]+$/))
      .max(100)
      .default([]),
    learningContainerId: learningContainerIdSchema.optional(),
    skillDeliveryEnabled: z.boolean().optional(),
    spaceIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    spaceId: z.string().min(1).optional(),
  })
  .strict();
export function workspaceRoutes(platform: Platform, voice: VoiceService) {
  const app = new Hono();
  app.route('/', pageRoutes(platform));
  app.post('/setup-telemetry', async (c) => {
    const parsed = setupInputSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: 'Invalid setup event.' }, 400);
    const event = parsed.data;
    if (
      event.kind === 'step_viewed' &&
      event.step !== 'settings' &&
      event.step !==
        (platform.setup().missing.length ? 'setup_required' : 'ready')
    )
      return c.json({ error: 'Setup step does not match server state.' }, 400);
    platform.setupTelemetry.capture(event);
    return c.json({ ok: true });
  });
  app.get('/workspace', (c) =>
    c.json({
      spaces: platform.workspace.spaces(),
      dots: platform.workspace.dots(),
      conversations: platform.workspace.conversations(),
      setup: platform.setup(),
      calls: platform.workspace.calls(),
    }),
  );
  // Dot-scoped Space/page access for a Dot's own MCP tools. Space-access is
  // enforced here, server-side, so the per-turn MCP subprocess never touches
  // the database and runs as a pure HTTP client (the prerequisite for running
  // it inside the Dot's container). See httpDotToolDefs in dot-tools.ts.
  const dotOr404 = (dotId: string) => platform.workspace.dot(dotId);
  app.get('/dots/:dotId/spaces', (c) => {
    const dot = dotOr404(c.req.param('dotId'));
    if (!dot) return c.json({ error: 'Dot not found.' }, 404);
    return c.json(
      platform.workspace
        .spaces()
        .filter((space) => dot.spaceIds.includes(space.id))
        .map((space) => ({ id: space.id, name: space.name })),
    );
  });
  app.get('/dots/:dotId/pages', (c) => {
    const dot = dotOr404(c.req.param('dotId'));
    if (!dot) return c.json({ error: 'Dot not found.' }, 404);
    return c.json(
      dot.spaceIds.flatMap((spaceId) =>
        platform.workspace.pages
          .list(spaceId)
          .map((page) => ({
            id: page.id,
            spaceId: page.spaceId,
            title: page.title,
          })),
      ),
    );
  });
  app.get('/dots/:dotId/spaces/:spaceId/pages/:pageId', (c) => {
    const dot = dotOr404(c.req.param('dotId'));
    if (!dot) return c.json({ error: 'Dot not found.' }, 404);
    const spaceId = c.req.param('spaceId');
    if (!platform.workspace.canAccessSpace(dot.id, spaceId))
      return c.json(
        { error: 'This Dot does not have access to that Space.' },
        403,
      );
    const pageId = c.req.param('pageId');
    if (!platform.workspace.pages.exists(spaceId, pageId))
      return c.json({ error: 'Page not found in this Space.' }, 404);
    const page = platform.workspace.pages.get(spaceId, pageId);
    return c.json({ title: page.title, content: page.content });
  });
  app.post('/dots/:dotId/spaces/:spaceId/pages', async (c) => {
    const dot = dotOr404(c.req.param('dotId'));
    if (!dot) return c.json({ error: 'Dot not found.' }, 404);
    const spaceId = c.req.param('spaceId');
    if (!platform.workspace.canAccessSpace(dot.id, spaceId))
      return c.json(
        { error: 'This Dot does not have access to that Space.' },
        403,
      );
    const data = pageInput.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        {
          error:
            'Enter a title (160 characters max) and Markdown content (100,000 max).',
        },
        400,
      );
    const page = platform.workspace.pages.create(spaceId, data.data);
    return c.json({ id: page.id, title: page.title }, 201);
  });
  app.post('/spaces', async (c) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().max(500).default(''),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Enter a Space name (up to 60 characters).' },
        400,
      );
    return c.json(
      platform.workspace.createSpace(data.data.name, data.data.description),
      201,
    );
  });
  app.post('/dots', async (c) => {
    const data = dotSchema
      .extend({ spaceId: z.string() })
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        {
          error:
            'Provide a name, role instructions, and explicit tool permissions.',
        },
        400,
      );
    try {
      validateLearningSettings(
        data.data.learningContainerId ?? null,
        data.data.skillDeliveryEnabled ?? false,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid Learning settings.',
        },
        400,
      );
    }
    return c.json(
      platform.workspace.createDot(
        data.data.spaceId,
        data.data.name,
        data.data.instructions,
        data.data.researchAllowed,
        data.data.memoryAllowed,
        data.data.spaceIds,
        data.data.learningContainerId,
        data.data.skillDeliveryEnabled,
        data.data.appsAllowed,
        data.data.composioToolkits,
        data.data.icon ?? null,
      ),
      201,
    );
  });
  app.put('/dots/:id', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Invalid specialist settings.' }, 400);
    const current = platform.workspace.dot(c.req.param('id'));
    if (!current) return c.json({ error: 'Dot not found.' }, 404);
    try {
      validateLearningSettings(
        data.data.learningContainerId === undefined
          ? (current.learningContainerId ?? null)
          : data.data.learningContainerId,
        data.data.skillDeliveryEnabled ?? current.skillDeliveryEnabled ?? false,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid Learning settings.',
        },
        400,
      );
    }
    return c.json(platform.workspace.updateDot(c.req.param('id'), data.data));
  });
  app.post('/conversations', async (c) => {
    const data = z
      .object({
        dotId: z.string(),
        title: z.string().trim().min(1).max(120).default('A new thought'),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Select a Dot and a conversation title.' }, 400);
    if (platform.setup().missing.length)
      return c.json(
        { error: `Setup required: ${platform.setup().missing.join(', ')}.` },
        503,
      );
    return c.json(
      await platform.createConversation(data.data.dotId, data.data.title),
      201,
    );
  });
  app.patch('/conversations/:id', async (c) => {
    const data = z
      .object({ title: z.string().trim().min(1).max(120) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Provide a conversation title.' }, 400);
    try {
      return c.json(
        platform.workspace.renameThread(c.req.param('id'), data.data.title),
      );
    } catch {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
  });
  app.delete('/conversations/:id', (c) => {
    try {
      platform.workspace.deleteThread(c.req.param('id'));
      return c.json({ ok: true });
    } catch {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
  });
  app.get('/conversations/:id/capture', (c) =>
    c.json(platform.workspace.capture(c.req.param('id'))),
  );
  app.post('/voice/calls', async (c) => {
    const data = z
      .object({ threadId: z.string(), sdp: z.string().max(100000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'A conversation and audio SDP offer are required.' },
        400,
      );
    return c.json(
      await voice.begin(data.data.threadId, data.data.sdp, c.req.raw.signal),
      201,
    );
  });
  app.get('/voice/calls/:id', (c) =>
    c.json(platform.workspace.call(c.req.param('id'))),
  );
  app.post('/voice/calls/:id/active', (c) =>
    c.json(voice.activate(c.req.param('id'))),
  );
  app.post('/voice/calls/:id/compute', async (c) => {
    const data = z
      .object({
        toolCallId: z.string().min(1).max(200),
        request: z.string().trim().min(1).max(4000),
        transcript: z.string().max(12000).default(''),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'A bounded compute request and tool call ID are required.' },
        400,
      );
    return c.json({
      text: await voice.compute(
        c.req.param('id'),
        data.data.toolCallId,
        `${data.data.request}\n\nUntrusted current-call transcript for context:\n${data.data.transcript}`,
      ),
    });
  });
  app.post('/voice/calls/:id/end', async (c) => {
    const data = z
      .object({
        transcript: z.string().max(20000),
        anchorMessageId: z.string().max(200).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Transcript exceeds the 20,000 character limit.' },
        400,
      );
    platform.workspace.anchorCall(c.req.param('id'), data.data.anchorMessageId);
    return c.json(await voice.end(c.req.param('id'), data.data.transcript));
  });
  app.all('/copilotkit/*', (c) => platform.handle(c.req.raw));
  app.onError((error, c) => {
    const text = error.message;
    if (text.startsWith('Space access must include'))
      return c.json({ error: text }, 400);
    const known =
      /^(Setup|Voice setup|Dot |Space |Specialist |Conversation |Call |This call|End the current|Voice provider|An audio|Intelligence could not)/.test(
        text,
      );
    // A conversation, call or Dot the caller named that does not exist is a missing resource, not a
    // server fault.
    if (
      /^(Dot not found|Call not found|Conversation does not belong)/.test(text)
    )
      return c.json({ error: text }, 404);
    return c.json(
      {
        error: known
          ? text
          : 'The service request failed. Check the server configuration and try again.',
      },
      503,
    );
  });
  return app;
}
