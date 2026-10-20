import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(projectRoot, 'resources/agent-profiles');
const overridesPath = resolve(
  projectRoot,
  'resources/agent-adaptations/minimax-design/catalog-overrides.json'
);
const outputPath = resolve(projectRoot, 'src/generated/profile-catalog.json');

const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name.endsWith('.md')) {
      files.push(relative(sourceRoot, fullPath).split(sep).join('/'));
    }
  }
}
walk(sourceRoot);
files.sort();

if (files.length !== 202) {
  throw new Error(`Expected exactly 202 profile files, found ${files.length}`);
}

const catalog = [];
const seenIds = new Set();

for (const relPath of files) {
  const profileId = relPath.replace(/\.md$/, '');
  if (seenIds.has(profileId)) {
    throw new Error(`Duplicate profile id: ${profileId}`);
  }
  seenIds.add(profileId);

  const fullPath = resolve(sourceRoot, relPath);
  const raw = readFileSync(fullPath);
  const text = raw.toString('utf8');

  const sha256 = createHash('sha256').update(raw).digest('hex');
  const utf8Bytes = Buffer.byteLength(raw);
  const characterCount = text.length;

  const titleMatch = text.match(/^#\s+(.+)$/m);
  const detectedTitle = titleMatch ? titleMatch[1].trim() : profileId;

  const override = overrides[profileId] || {};
  const category = relPath.split('/')[0] || 'root';

  const entry = {
    id: profileId,
    sourcePath: `resources/agent-profiles/${relPath}`,
    title: override.title || detectedTitle,
    category,
    kind: override.kind || 'reference',
    sourceHash: sha256,
    utf8Bytes,
    characterCount,
    ...(override.adaptationPath ? { adaptationPath: override.adaptationPath } : {}),
    ...(override.adaptationHash ? { adaptationHash: override.adaptationHash } : {}),
    ...(override.versionGroup ? { versionGroup: override.versionGroup } : {}),
    ...(override.variant ? { variant: override.variant } : {}),
    ...(override.canonicalId ? { canonicalId: override.canonicalId } : {}),
    activation: {
      intents: override.activation?.intents || [],
      stages: override.activation?.stages || [],
      modalities: override.activation?.modalities || [],
      exclusions: override.activation?.exclusions || [],
    },
    dependencies: override.dependencies || [],
    originalTools: override.originalTools || [],
    requiredCapabilities: override.requiredCapabilities || [],
    runtimePolicy: override.runtimePolicy || 'on-demand',
    coverage: {
      knowledge: override.coverage?.knowledge || 'pending',
      execution: override.coverage?.execution || 'pending',
      evidenceIds: override.coverage?.evidenceIds || [],
      ...(override.coverage?.blockingReason ? { blockingReason: override.coverage.blockingReason } : {}),
    },
  };

  catalog.push(entry);
}

// Integrity checks: canonical references must exist
for (const entry of catalog) {
  if (entry.canonicalId && !seenIds.has(entry.canonicalId)) {
    throw new Error(`Entry ${entry.id} references missing canonicalId: ${entry.canonicalId}`);
  }
  for (const dep of entry.dependencies) {
    if (!seenIds.has(dep)) {
      throw new Error(`Entry ${entry.id} references missing dependency: ${dep}`);
    }
  }
}

writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

console.log(`Generated profile catalog with ${catalog.length} entries at: ${outputPath}`);
