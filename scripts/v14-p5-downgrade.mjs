import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const old = process.env.DND_TCG_LEGACY_EXE;
const upgraded = process.env.DND_TCG_P5_UPGRADED_PROFILE;
assert(old && upgraded, 'Set the verified v1.3 executable and an upgraded QA profile');
assert((await readFile(join(dirname(old), 'resources', 'app.asar'))).includes('DND_TCG_TEST_USER_DATA'), 'Legacy build supports a separate profile');
const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'p5-downgrade-'));
const userData = join(run, 'user-data');
await cp(upgraded, userData, { recursive: true });
const file = join(userData, 'data', 'app.sqlite3');
const db = new DatabaseSync(file, { readOnly: true });
assert.equal(db.prepare('PRAGMA user_version').get().user_version, 10);
db.close();
const hash = async () => createHash('sha256').update(await readFile(file)).digest('hex');
const before = await hash();
const env = { ...process.env, DND_TCG_TEST_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' };
delete env.DND_TCG_DEV_URL;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(old, [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise(resolve => child.once('close', resolve));
const expected = '더 새로운 버전의 데이터입니다.';
let log = '';
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expected version rejection was not observed in the legacy startup log.')), 12000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    const onChunk = chunk => {
      log += chunk.toString('utf8');
      if (log.includes(expected)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
  });
} finally {
  // The older app can be waiting on its own startup error dialog.
  child.kill();
  await exited;
}
assert.equal(await hash(), before, 'v9 database remains byte-for-byte identical');
await writeFile(join(run, 'report.json'), JSON.stringify({ outcome: 'PASS', message: expected, schemaVersion: 10, dbSha256: before, run }, null, 2));
console.log(run);
