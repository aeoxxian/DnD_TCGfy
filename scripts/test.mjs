import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Keep transformed modules in the writable project even in a restricted Windows host.
const tempRoot = resolve('artifacts/vitest-temp');
mkdirSync(tempRoot, { recursive: true });
const temp = mkdtempSync(join(tempRoot, 'run-'));
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp }, windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
