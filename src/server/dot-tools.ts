import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Dot } from '../shared/types.js';
import type { WorkspaceStore } from './workspace.js';
import { callOpenDotsApi as callApi } from './dot-api.js';

export function dotToolDefs(dot: Dot, workspace: WorkspaceStore) {
  const spaceIds = dot.spaceIds?.length ? dot.spaceIds : [dot.spaceId];
  const assertSpace = (spaceId: string) => {
    if (!spaceIds.includes(spaceId))
      throw new Error('This Dot does not have access to that Space.');
  };
  const text = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });

  return [
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
      "Create a new page in one of this Dot's Spaces.",
      { spaceId: z.string(), title: z.string(), content: z.string() },
      async ({ spaceId, title, content }) => {
        assertSpace(spaceId);
        const page = workspace.pages.create(spaceId, { title, content });
        return text({ id: page.id, title: page.title });
      },
    ),
  ];
}

export function createDotMcpServer(dot: Dot, workspace: WorkspaceStore) {
  return createSdkMcpServer({
    name: 'dot',
    version: '0.1.0',
    tools: dotToolDefs(dot, workspace),
  });
}

// HTTP-client variant for the per-turn MCP subprocess: identical tools, but
// each reaches the long-lived main server over HTTP (Space-access is enforced
// there) instead of opening the workspace database. The Dot id comes from the
// subprocess environment, matching the coding/scheduling tools.
export function httpDotToolDefs() {
  const dotId = process.env.DOT_ID ?? '';
  const base = `/dots/${encodeURIComponent(dotId)}`;
  const text = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  return [
    tool('list_spaces', "List this Dot's Spaces (id and name).", {}, async () =>
      text(await callApi(`${base}/spaces`)),
    ),
    tool('list_pages', "List pages in this Dot's Spaces.", {}, async () =>
      text(await callApi(`${base}/pages`)),
    ),
    tool(
      'read_page',
      'Read a page by Space id and page id.',
      { spaceId: z.string(), pageId: z.string() },
      async ({ spaceId, pageId }) =>
        text(
          await callApi(
            `${base}/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`,
          ),
        ),
    ),
    tool(
      'create_page',
      "Create a new page in one of this Dot's Spaces.",
      { spaceId: z.string(), title: z.string(), content: z.string() },
      async ({ spaceId, title, content }) =>
        text(
          await callApi(`${base}/spaces/${encodeURIComponent(spaceId)}/pages`, {
            method: 'POST',
            body: JSON.stringify({ title, content }),
          }),
        ),
    ),
  ];
}
