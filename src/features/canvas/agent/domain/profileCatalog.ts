import { z } from 'zod';

export const profileKindSchema = z.enum([
  'role',
  'workflow',
  'reference',
  'vendor',
  'contract',
  'index',
  'authoring',
]);

export type ProfileKind = z.infer<typeof profileKindSchema>;

export const runtimePolicySchema = z.enum([
  'always-on',
  'on-demand',
  'index-only',
  'developer-only',
]);

export type RuntimePolicy = z.infer<typeof runtimePolicySchema>;

export const knowledgeCoverageStatusSchema = z.enum([
  'pending',
  'adapted',
  'verified',
]);

export type KnowledgeCoverageStatus = z.infer<typeof knowledgeCoverageStatusSchema>;

export const executionCoverageStatusSchema = z.enum([
  'not-applicable',
  'pending',
  'implemented',
  'verified',
  'blocked',
]);

export type ExecutionCoverageStatus = z.infer<typeof executionCoverageStatusSchema>;

export const profileActivationSchema = z.object({
  intents: z.array(z.string()),
  stages: z.array(z.string()),
  modalities: z.array(z.string()),
  exclusions: z.array(z.string()),
});

export type ProfileActivation = z.infer<typeof profileActivationSchema>;

export const profileCoverageSchema = z.object({
  knowledge: knowledgeCoverageStatusSchema,
  execution: executionCoverageStatusSchema,
  evidenceIds: z.array(z.string()),
  blockingReason: z.string().optional(),
});

export type ProfileCoverage = z.infer<typeof profileCoverageSchema>;

export const profileCatalogEntrySchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  kind: profileKindSchema,
  sourceHash: z.string().length(64),
  utf8Bytes: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  adaptationPath: z.string().optional(),
  adaptationHash: z.string().length(64).optional(),
  versionGroup: z.string().optional(),
  variant: z.string().optional(),
  canonicalId: z.string().optional(),
  activation: profileActivationSchema,
  dependencies: z.array(z.string()),
  originalTools: z.array(z.string()),
  requiredCapabilities: z.array(z.string()),
  runtimePolicy: runtimePolicySchema,
  coverage: profileCoverageSchema,
});

export type ProfileCatalogEntryV1 = z.infer<typeof profileCatalogEntrySchema>;

export const profileCatalogSchema = z.array(profileCatalogEntrySchema);

export type ProfileCatalogV1 = ProfileCatalogEntryV1[];

export function parseProfileCatalog(raw: unknown): ProfileCatalogV1 {
  return profileCatalogSchema.parse(raw);
}

export function findProfileById(catalog: ProfileCatalogV1, id: string): ProfileCatalogEntryV1 | undefined {
  return catalog.find((entry) => entry.id === id);
}

export function resolveCanonicalProfile(catalog: ProfileCatalogV1, id: string): ProfileCatalogEntryV1 | undefined {
  const entry = findProfileById(catalog, id);
  if (!entry) return undefined;
  if (!entry.canonicalId || entry.canonicalId === id) return entry;
  return findProfileById(catalog, entry.canonicalId) || entry;
}

export function filterProfilesByIntent(catalog: ProfileCatalogV1, intent: string): ProfileCatalogV1 {
  const target = intent.toLowerCase().trim();
  return catalog.filter((entry) =>
    entry.activation.intents.some((i) => i.toLowerCase().trim() === target)
  );
}

export function filterProfilesByStage(catalog: ProfileCatalogV1, stage: string): ProfileCatalogV1 {
  const target = stage.toLowerCase().trim();
  return catalog.filter((entry) =>
    entry.activation.stages.some((s) => s.toLowerCase().trim() === target)
  );
}

export function filterProfilesByModality(catalog: ProfileCatalogV1, modality: string): ProfileCatalogV1 {
  const target = modality.toLowerCase().trim();
  return catalog.filter((entry) =>
    entry.activation.modalities.some((m) => m.toLowerCase().trim() === target)
  );
}

export function filterProfilesByPolicy(catalog: ProfileCatalogV1, policy: RuntimePolicy): ProfileCatalogV1 {
  return catalog.filter((entry) => entry.runtimePolicy === policy);
}

export const LEGACY_PATH_PREFIXES: Record<string, string> = {
  'drama-series/': '03-DramaSeries-短剧微电影完整流程/',
  'ad-tvc/': '04-AdTVC-商业广告与品牌大片流程/',
  'mv/': '05-MV-音乐卡点与歌词视频流程/',
  'general-video/': '06-GeneralVideo-通用视频制作流程/',
  'koc-video/': '06-KOC-带货与口播种草流程/',
  '_shared/': '07-SharedPipelines-共享资产与后期管线/',
  'vendors/': '02-Vendors-模型生成提示词与参数/',
  'failures/': '08-Failures-防翻车与负向避坑知识库/',
  'contracts/': '09-Contracts-画布纪律与语义契约/',
  'agents/': '01-Agents-智能体人设与编排/',
};

export const LEGACY_TEMPLATE_VARIABLES: Record<string, string> = {
  '<workflowsDir>': 'resources/agent-profiles/',
  '<knowledgeDir>': 'resources/agent-profiles/',
  '.opencode-v2/': 'resources/agent-profiles/',
};

export interface LegacyReferenceResolution {
  resolved: boolean;
  legacyPath: string;
  catalogId?: string;
  sourcePath?: string;
  reason?: string;
}

export function resolveLegacyReference(
  catalog: ProfileCatalogV1,
  rawPath: string
): LegacyReferenceResolution {
  let normalized = rawPath.trim();
  for (const [tpl, replacement] of Object.entries(LEGACY_TEMPLATE_VARIABLES)) {
    if (normalized.startsWith(tpl)) {
      normalized = normalized.replace(tpl, replacement);
    }
  }

  // Normalize slashes
  normalized = normalized.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.?\//, '');

  // Strip leading resources/agent-profiles/ for uniform prefix matching
  if (normalized.startsWith('resources/agent-profiles/')) {
    normalized = normalized.slice('resources/agent-profiles/'.length);
  }

  for (const [prefix, mappedPrefix] of Object.entries(LEGACY_PATH_PREFIXES)) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.replace(prefix, mappedPrefix);
      break;
    }
  }

  const withoutExt = normalized.replace(/\.md$/, '');
  const withExt = withoutExt + '.md';
  const fullSourcePath = `resources/agent-profiles/${withExt}`;

  // 1. Direct ID or sourcePath match
  const directMatch = catalog.find((entry) => {
    return entry.id === withoutExt || entry.sourcePath === fullSourcePath;
  });
  if (directMatch) {
    return {
      resolved: true,
      legacyPath: rawPath,
      catalogId: directMatch.id,
      sourcePath: directMatch.sourcePath,
    };
  }

  // 2. Sub-path / reference directory match (e.g., drama-series/production-plan -> 03-DramaSeries.../reference/production-plan)
  const pathParts = withoutExt.split('/');
  const categoryPart = pathParts[0];
  const filePart = pathParts[pathParts.length - 1];

  const subPathMatch = catalog.find((entry) => {
    if (categoryPart && !entry.category.includes(categoryPart) && !entry.sourcePath.includes(categoryPart)) {
      return false;
    }
    return entry.id.endsWith(`/${filePart}`) || entry.id === filePart;
  });
  if (subPathMatch) {
    return {
      resolved: true,
      legacyPath: rawPath,
      catalogId: subPathMatch.id,
      sourcePath: subPathMatch.sourcePath,
    };
  }

  // 3. Keyword / alias / filename fallback
  const baseKey = filePart.toLowerCase();
  const keywordMatch = catalog.find((entry) => {
    const entryIdLower = entry.id.toLowerCase();
    if (categoryPart && !entry.category.toLowerCase().includes(categoryPart.toLowerCase())) {
      return false;
    }
    if (baseKey.includes('stage-plan') || baseKey.includes('production-plan')) {
      return entryIdLower.includes('production-plan');
    }
    if (baseKey.includes('hailuo') || baseKey.includes('minimax')) {
      return entryIdLower.includes('minimax');
    }
    return entryIdLower.includes(baseKey);
  });
  if (keywordMatch) {
    return {
      resolved: true,
      legacyPath: rawPath,
      catalogId: keywordMatch.id,
      sourcePath: keywordMatch.sourcePath,
    };
  }

  return {
    resolved: false,
    legacyPath: rawPath,
    reason: `未能在语义目录中找到与 ${rawPath} 匹配的档案条目`,
  };
}

