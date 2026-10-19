import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Dot } from '../shared/types.js';
import type { WorkspaceStore } from './workspace.js';

export function createDotMcpServer(dot: Dot, workspace: WorkspaceStore) {
  const spaceIds = dot.spaceIds?.length ? dot.spaceIds : [dot.spaceId];
  const assertSpace = (spaceId: string) => {
    if (!spaceIds.includes(spaceId))
      throw new Error('This Dot does not have access to that Space.');
  };
  const text = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });

  return createSdkMcpServer({
    name: 'dot',
    version: '0.1.0',
    tools: [
      tool('list_spaces', "List this Dot's Spaces (id and name).", {}, async () =>
        text(
          workspace
            .spaces()
            .filter((space) => spaceIds.includes(space.id))
            .map((space) => ({ id: space.id, name: space.name })),
        ),
      ),
      tool('list_pages', "List pages in this Dot's Spaces.", {}, async () =>
        text(
          spaceIds.flatMap((spaceId) =>
            workspace.pages.list(spaceId).map((page) => ({
              id: page.id,
              spaceId: page.spaceId,
              title: page.title,
            })),
          ),
        ),
      ),
      tool(
        'read_page',
        'Read a page by Space id and page id.',
        { spaceId: z.string(), pageId: z.string() },
        async ({ spaceId, pageId }) => {
          assertSpace(spaceId);
          const page = workspace.pages.get(spaceId, pageId);
          return text({ title: page.title, content: page.content });
        },
      ),
      tool(
        'create_page',
        'Create a new page in one of this Dot\'s Spaces.',
        { spaceId: z.string(), title: z.string(), content: z.string() },
        async ({ spaceId, title, content }) => {
          assertSpace(spaceId);
          const page = workspace.pages.create(spaceId, { title, content });
          return text({ id: page.id, title: page.title });
        },
      ),
    ],
  });
}
