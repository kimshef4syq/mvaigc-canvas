import {
  parseProfileCatalog,
  type ProfileCatalogEntryV1,
  type ProfileCatalogV1,
} from '../domain/profileCatalog';
import rawCatalog from '@/generated/profile-catalog.json';

const catalog: ProfileCatalogV1 = parseProfileCatalog(rawCatalog);
const profileMap = new Map<string, ProfileCatalogEntryV1>(
  catalog.map((entry) => [entry.id, entry])
);

// Vite dynamic raw glob for client/browser bundles
const browserProfileLoaders = import.meta.glob(
  '/resources/agent-profiles/**/*.md',
  { query: '?raw', import: 'default' }
);

export interface ProfileSearchParams {
  query?: string;
  category?: string;
  kind?: string;
  stage?: string;
  intent?: string;
  modality?: string;
  cursor?: string;
  limit?: number;
}

export interface ProfileSummary {
  id: string;
  title: string;
  category: string;
  kind: string;
  runtimePolicy: string;
  characterCount: number;
  dependencies: string[];
  canonicalId?: string;
  intents: string[];
  stages: string[];
  modalities: string[];
}

export interface ProfileSearchResult {
  items: ProfileSummary[];
  total: number;
  nextCursor: string | null;
}

export interface ProfileReadParams {
  id: string;
  revision?: string;
  cursor?: number;
  limitCharacters?: number;
}

export interface ProfileReadResult {
  id: string;
  title: string;
  sourceHash: string;
  totalCharacters: number;
  cursor: number;
  content: string;
  nextCursor: number | null;
  isEof: boolean;
  dependencies: string[];
  canonicalId?: string;
}

export function searchProfiles(params: ProfileSearchParams = {}): ProfileSearchResult {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 20);
  const offset = params.cursor ? Math.max(parseInt(params.cursor, 10) || 0, 0) : 0;

  const query = params.query?.toLowerCase().trim();
  const category = params.category?.toLowerCase().trim();
  const kind = params.kind?.toLowerCase().trim();
  const stage = params.stage?.toLowerCase().trim();
  const intent = params.intent?.toLowerCase().trim();
  const modality = params.modality?.toLowerCase().trim();

  const filtered = catalog.filter((entry) => {
    if (category && entry.category.toLowerCase() !== category) return false;
    if (kind && entry.kind.toLowerCase() !== kind) return false;
    if (stage && !entry.activation.stages.some((s) => s.toLowerCase() === stage)) return false;
    if (intent && !entry.activation.intents.some((i) => i.toLowerCase() === intent)) return false;
    if (modality && !entry.activation.modalities.some((m) => m.toLowerCase() === modality)) return false;
    if (query) {
      const matchId = entry.id.toLowerCase().includes(query);
      const matchTitle = entry.title.toLowerCase().includes(query);
      const matchIntent = entry.activation.intents.some((i) => i.toLowerCase().includes(query));
      if (!matchId && !matchTitle && !matchIntent) return false;
    }
    return true;
  });

  const total = filtered.length;
  const sliced = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit < total ? String(offset + limit) : null;

  const items: ProfileSummary[] = sliced.map((entry) => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    kind: entry.kind,
    runtimePolicy: entry.runtimePolicy,
    characterCount: entry.characterCount,
    dependencies: entry.dependencies,
    canonicalId: entry.canonicalId,
    intents: entry.activation.intents,
    stages: entry.activation.stages,
    modalities: entry.activation.modalities,
  }));

  return {
    items,
    total,
    nextCursor: nextOffset,
  };
}

async function loadRawContent(sourcePath: string): Promise<string> {
  const normalized = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;

  // 1. Try Vite lazy loader (browser / Vitest)
  const loader = browserProfileLoaders[normalized];
  if (typeof loader === 'function') {
    const raw = await loader();
    return typeof raw === 'string' ? raw : String(raw);
  }

  // 2. Node.js environment fallback
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const fullPath = resolve(process.cwd(), sourcePath);
    return readFileSync(fullPath, 'utf8');
  }

  throw new Error(`Profile source loader not found for: ${sourcePath}`);
}

export async function readProfile(params: ProfileReadParams): Promise<ProfileReadResult> {
  const entry = profileMap.get(params.id);
  if (!entry) {
    throw new Error(`Profile not found in catalog: ${params.id}`);
  }

  if (params.revision && !entry.sourceHash.startsWith(params.revision)) {
    throw new Error(
      `Profile revision mismatch for ${params.id}: requested ${params.revision}, actual ${entry.sourceHash}`
    );
  }

  const fullText = await loadRawContent(entry.sourcePath);
  const totalCharacters = fullText.length;
  const cursor = Math.max(params.cursor ?? 0, 0);
  const maxLimit = 12_000;
  const limit = Math.min(Math.max(params.limitCharacters ?? maxLimit, 1), maxLimit);

  const chunk = fullText.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < totalCharacters ? cursor + limit : null;
  const isEof = nextCursor === null;

  return {
    id: entry.id,
    title: entry.title,
    sourceHash: entry.sourceHash,
    totalCharacters,
    cursor,
    content: chunk,
    nextCursor,
    isEof,
    dependencies: entry.dependencies,
    canonicalId: entry.canonicalId,
  };
}

export function getProfileCatalog(): ProfileCatalogV1 {
  return catalog;
}

export function getProfileEntry(id: string): ProfileCatalogEntryV1 | undefined {
  return profileMap.get(id);
}
