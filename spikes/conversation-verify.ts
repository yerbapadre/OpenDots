import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import type { PlatformConfig } from '../src/server/platform-config.js';

const store = new Store(':memory:');
const workspace = new WorkspaceStore(':memory:', 'verify-owner');
const config = {
  localRuntime: true,
  baseUrl: '',
  voiceName: 'marin',
  slackUsers: [],
  runtimeUrl: '',
} as PlatformConfig;

const platform = new Platform(store, workspace, config);
const dot = workspace.dots()[0];

const conversation = await platform.createConversation(dot.id, 'Test chat');
console.log('createConversation returned:', JSON.stringify(conversation));
console.log('history:', JSON.stringify(await platform.history(conversation.id)));
console.log('handler present:', Boolean(platform.handler));
console.log(
  conversation.id && platform.handler
    ? 'CONVERSATION FIX OK: local mode creates a conversation without Intelligence.'
    : 'CONVERSATION FIX FAILED.',
);
