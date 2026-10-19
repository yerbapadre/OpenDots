import { WorkspaceStore } from '../src/server/workspace.js';

const workspace = new WorkspaceStore(':memory:', 'verify-owner');

const missingBefore = workspace.getThreadSession('t1');
workspace.setThreadSession('t1', 'sess-abc');
const afterSet = workspace.getThreadSession('t1');
workspace.setThreadSession('t1', 'sess-xyz');
const afterUpsert = workspace.getThreadSession('t1');
const otherThread = workspace.getThreadSession('t2');

workspace.close();

console.log({ missingBefore, afterSet, afterUpsert, otherThread });

const pass =
  missingBefore === undefined &&
  afterSet === 'sess-abc' &&
  afterUpsert === 'sess-xyz' &&
  otherThread === undefined;

console.log(pass ? 'SESSION STORE OK' : 'SESSION STORE FAILED');
process.exit(pass ? 0 : 1);
