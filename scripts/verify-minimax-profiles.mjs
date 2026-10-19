import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const root = resolve(projectRoot, 'resources/agent-profiles');
const manifestPath = resolve(projectRoot, 'src/generated/profiles-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest)) throw new Error('Profile manifest must be an array.');

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.md')) files.push(relative(root, path).split(sep).join('/'));
  }
}
walk(root);

const ids = new Set();
const indexed = new Set();
for (const entry of manifest) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.relativePath !== 'string') {
    throw new Error('Profile manifest entry has no id or relativePath.');
  }
  if (ids.has(entry.id)) throw new Error(`Duplicate profile id: ${entry.id}`);
  if (indexed.has(entry.relativePath)) throw new Error(`Duplicate profile path: ${entry.relativePath}`);
  ids.add(entry.id);
  indexed.add(entry.relativePath);
  const target = resolve(root, entry.relativePath);
  if (!target.startsWith(`${root}${sep}`) || !realpathSync(target).startsWith(`${root}${sep}`)) {
    throw new Error(`Profile path escapes resource directory: ${entry.relativePath}`);
  }
  const content = readFileSync(target, 'utf8');
  if (entry.sizeBytes !== content.length) throw new Error(`Stale profile size: ${entry.relativePath}`);
}

const missing = files.filter((path) => !indexed.has(path));
if (missing.length) throw new Error(`Unindexed profile files: ${missing.join(', ')}`);
if (files.length !== manifest.length) throw new Error(`Count mismatch: ${files.length} files, ${manifest.length} entries`);
console.log(`Verified ${files.length} MiniMax Design profile files and manifest entries.`);
