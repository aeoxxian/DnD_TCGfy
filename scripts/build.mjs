import { execFileSync } from 'node:child_process';
import { build } from 'vite';

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { stdio: 'inherit' });
await build();
await import('./build-electron.mjs');
