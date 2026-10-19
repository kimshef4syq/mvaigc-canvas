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
