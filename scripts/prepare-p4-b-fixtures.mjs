// Optional QA helper, not an application/runtime dependency.
// SQLite only opens an isolated DB/WAL copy; originals are read as files.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
execFileSync('python', [fileURLToPath(new URL('./prepare-p4-b-fixtures.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
