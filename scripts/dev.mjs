import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import './build-electron.mjs';

const server = await createServer();
await server.listen();
const childEnv = { ...process.env, DND_TCG_DEV_URL: 'http://127.0.0.1:5173' };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: childEnv, windowsHide: true });
let shuttingDown = false;
async function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('error', (error) => { console.error(error); void stop(1); });
child.on('exit', (code) => { void stop(code ?? 0); });
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
