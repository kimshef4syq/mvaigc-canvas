import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../resources/hypit-provider-mvaigc/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(root + 'node_modules/@hypit/hypit/package.json')) run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
run(['run', 'build']);
