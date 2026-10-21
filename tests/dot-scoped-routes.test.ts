import { afterEach, expect, it } from 'vitest';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';
import { createApp } from '../src/server/app.js';

// These Dot-scoped routes back the per-turn MCP subprocess (httpDotToolDefs),
// which has no database handle of its own. Space-access must therefore be
// enforced here, server-side — that is the whole point of the endpoints.

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function fixture() {
  const store = new Store(':memory:');
  const ws = new WorkspaceStore(':memory:', 'owner');
  cleanup.push(() => {
    store.close();
    ws.close();
  });
  const config = { mode: 'live' as const, baseUrl: 'https://example.com' };
  const platform = new Platform(store, ws, {
    baseUrl: config.baseUrl,
    voiceName: 'marin',
    slackUsers: [],
    runtimeUrl: '',
  });
  return {
    ws,
    app: createApp({
      store,
      runner: new Runner(store, config),
      config,
      platform,
    }),
  };
}
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

it('lists, creates and reads pages scoped to the Dot’s Spaces', async () => {
  const { ws, app } = fixture();
  const dot = ws.dots()[0];
  const space = dot.spaceId;

  const spaces = await app.request(`/api/dots/${dot.id}/spaces`);
  expect(spaces.status).toBe(200);
  expect(await spaces.json()).toEqual([
    { id: space, name: ws.spaces()[0].name },
  ]);

  const created = await app.request(
    `/api/dots/${dot.id}/spaces/${space}/pages`,
    json({ title: 'Notes', content: 'Body text' }),
  );
  expect(created.status).toBe(201);
  const page = (await created.json()) as { id: string; title: string };
  expect(page).toMatchObject({ title: 'Notes' });

  const pages = await app.request(`/api/dots/${dot.id}/pages`);
  expect(await pages.json()).toEqual([
    { id: page.id, spaceId: space, title: 'Notes' },
  ]);

  const read = await app.request(
    `/api/dots/${dot.id}/spaces/${space}/pages/${page.id}`,
  );
  expect(await read.json()).toEqual({ title: 'Notes', content: 'Body text' });
});

it('denies access to a Space the Dot is not granted', async () => {
  const { ws, app } = fixture();
  const dot = ws.dots()[0];
  const other = ws.createSpace('Not granted', '');
  const page = ws.pages.create(other.id, { title: 'Secret' });

  // The unowned Space never appears in the Dot's listing.
  expect(await (await app.request(`/api/dots/${dot.id}/spaces`)).json()).toEqual(
    [{ id: dot.spaceId, name: ws.spaces()[0].name }],
  );

  for (const res of [
    await app.request(`/api/dots/${dot.id}/spaces/${other.id}/pages/${page.id}`),
    await app.request(
      `/api/dots/${dot.id}/spaces/${other.id}/pages`,
      json({ title: 'Intrusion', content: 'x' }),
    ),
  ]) {
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'This Dot does not have access to that Space.',
    });
  }
});

it('returns 404 for an unknown Dot', async () => {
  const { app } = fixture();
  for (const path of ['/api/dots/missing/spaces', '/api/dots/missing/pages']) {
    const res = await app.request(path);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Dot not found.' });
  }
});
