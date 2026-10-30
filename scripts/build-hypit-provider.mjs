import { existsSync, mkdtempSync, readdirSync, readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../resources/hypit-provider-mvaigc/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${npm} exited with status ${result.status}`);
}

// Preserve timestamps for unchanged resources: Tauri watches dist and otherwise
// recompiles the Rust application every time TypeScript rewrites these files.
function syncOutput(source, target) {
  mkdirSync(target, { recursive: true });
  const entries = readdirSync(source, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(to) && !readdirSafeDirectory(to)) rmSync(to, { recursive: true, force: true });
      syncOutput(from, to);
    } else if (entry.isFile()) {
      if (!existsSync(to) || !sameFile(from, to)) {
        rmSync(to, { recursive: true, force: true });
        copyFileSync(from, to);
      }
    }
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!names.has(entry.name)) rmSync(join(target, entry.name), { recursive: true, force: true });
  }
}
function readdirSafeDirectory(path) {
  try { readdirSync(path); return true; } catch { return false; }
}
function sameFile(a, b) {
  try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; }
}

if (!existsSync(join(root, 'node_modules/@hypit/hypit/package.json'))) run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
const temporaryOutput = mkdtempSync(join(tmpdir(), 'mvaigc-provider-build-'));
try {
  run(['run', 'build', '--', '--outDir', temporaryOutput]);
  syncOutput(temporaryOutput, join(root, 'dist'));
} finally {
  rmSync(temporaryOutput, { recursive: true, force: true });
}
