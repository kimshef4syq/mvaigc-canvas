import { cp, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve('vendor/supersplat');
const result = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir('public/supersplat', { recursive: true });
await cp(resolve(root, 'dist'), 'public/supersplat', { recursive: true, force: true });
