import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const root = resolve(projectRoot, 'resources/agent-profiles');
const manifestPath = resolve(projectRoot, 'src/generated/profiles-manifest.json');
const catalogPath = resolve(projectRoot, 'src/generated/profile-catalog.json');
const decisionsPath = resolve(projectRoot, 'resources/agent-adaptations/minimax-design/version-decisions.json');
const toolsPath = resolve(projectRoot, 'resources/agent-adaptations/minimax-design/tool-mappings.json');

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

// Verify semantic profile-catalog if present
if (existsSync(catalogPath)) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  if (!Array.isArray(catalog) || catalog.length !== 202) {
    throw new Error(`Profile catalog must contain exactly 202 entries (found ${catalog?.length})`);
  }

  const catalogIds = new Set();
  for (const entry of catalog) {
    if (catalogIds.has(entry.id)) {
      throw new Error(`Duplicate id in profile catalog: ${entry.id}`);
    }
    catalogIds.add(entry.id);

    const fullPath = resolve(projectRoot, entry.sourcePath);
    if (!existsSync(fullPath)) {
      throw new Error(`Catalog source file missing: ${entry.sourcePath}`);
    }
    const raw = readFileSync(fullPath);
    const text = raw.toString('utf8');
    const expectedHash = createHash('sha256').update(raw).digest('hex');

    if (entry.sourceHash !== expectedHash) {
      throw new Error(`Catalog sourceHash mismatch for ${entry.id}: expected ${expectedHash}, got ${entry.sourceHash}`);
    }
    if (entry.utf8Bytes !== Buffer.byteLength(raw)) {
      throw new Error(`Catalog utf8Bytes mismatch for ${entry.id}`);
    }
    if (entry.characterCount !== text.length) {
      throw new Error(`Catalog characterCount mismatch for ${entry.id}`);
    }
  }

  for (const entry of catalog) {
    if (entry.canonicalId && !catalogIds.has(entry.canonicalId)) {
      throw new Error(`Entry ${entry.id} references missing canonicalId: ${entry.canonicalId}`);
    }
    for (const dep of entry.dependencies) {
      if (!catalogIds.has(dep)) {
        throw new Error(`Entry ${entry.id} references missing dependency: ${dep}`);
      }
    }
  }
}

// Verify version decisions if present
if (existsSync(decisionsPath)) {
  const { decisions } = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw new Error('Version decisions must be a non-empty array');
  }
  for (const d of decisions) {
    if (!ids.has(d.canonicalId)) {
      throw new Error(`Decision references non-existent canonicalId: ${d.canonicalId}`);
    }
    for (const alt of d.alternateIds) {
      if (!ids.has(alt)) {
        throw new Error(`Decision references non-existent alternateId: ${alt}`);
      }
    }
  }
}

// Verify tool mappings if present
if (existsSync(toolsPath)) {
  const { tools } = JSON.parse(readFileSync(toolsPath, 'utf8'));
  if (!Array.isArray(tools) || tools.length !== 54) {
    throw new Error(`Expected exactly 54 tool mappings, found ${tools?.length}`);
  }
}

console.log(`Verified ${files.length} MiniMax Design profile files, manifest entries, semantic catalog, and adaptation records.`);
