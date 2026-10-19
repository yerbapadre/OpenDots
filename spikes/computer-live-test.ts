import { WorkspaceStore } from '../src/server/workspace.js';
import { ComputerService } from '../src/server/computer-service.js';
import type { PlatformConfig } from '../src/server/platform-config.js';

const workspace = new WorkspaceStore(
  process.env.DATABASE_PATH ?? 'data/opendots.sqlite',
  process.env.OWNER_ID ?? 'opendots-owner',
);
const dot = workspace.dots()[0];

const config = {
  computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
  computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  baseUrl: '',
  voiceName: 'marin',
  slackUsers: [],
  runtimeUrl: '',
} as PlatformConfig;

const service = new ComputerService(workspace, config, () => false);

async function main(): Promise<void> {
  console.log('dot:', dot.id);
  console.log('enabling files permission...');
  await service.permissions(dot.id, {
    enabled: true,
    browser: false,
    files: true,
    shell: false,
  });

  console.log('starting computer (provisions a container)...');
  await service.start(dot.id);

  let state = '';
  for (let i = 0; i < 30; i += 1) {
    const status = await service.status(dot.id);
    state = status.state;
    console.log(`  status: ${state}`);
    if (state === 'running') break;
    if (state === 'unavailable') throw new Error('computer unavailable');
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (state !== 'running') throw new Error(`computer did not start (state=${state})`);

  console.log('files_write notes.txt ...');
  await service.action(
    dot.id,
    'files_write',
    { path: 'notes.txt', contents: 'hello from the sandbox' },
    'agent',
  );

  console.log('files_read notes.txt ...');
  const read = await service.action(dot.id, 'files_read', { path: 'notes.txt' }, 'agent');
  console.log('READ RESULT:', JSON.stringify(read));

  const ok = JSON.stringify(read).includes('hello from the sandbox');
  console.log(
    ok
      ? '\nSANDBOX OK: wrote + read a file inside the Dot container via ComputerService.'
      : '\nSANDBOX FAILED: did not read back the written contents.',
  );
  workspace.close();
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('LIVE TEST FAILED:', error);
  process.exit(1);
});
