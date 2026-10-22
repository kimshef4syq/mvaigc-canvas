import { z } from 'zod';

export const taskRouteKindSchema = z.enum([
  'direct',
  'stage',
  'workflow',
  'clarify',
]);

export type TaskRouteKind = z.infer<typeof taskRouteKindSchema>;

export const taskWorkflowKindSchema = z.enum([
  'general-video',
  'drama-series',
  'ad-tvc',
  'mv',
  'koc-video',
  'audio-production',
]);

export type TaskWorkflowKind = z.infer<typeof taskWorkflowKindSchema>;

export const taskRouteScopeSchema = z.object({
  targetNodeIds: z.array(z.string()).max(50).default([]),
  episodeScope: z.string().max(100).optional(),
  itemIds: z.array(z.string()).max(50).optional(),
});

export type TaskRouteScope = z.infer<typeof taskRouteScopeSchema>;

export const missingFactSchema = z.object({
  key: z.string().min(1).max(100),
  question: z.string().min(1).max(500),
  affects: z.string().min(1).max(200),
});

export type MissingFact = z.infer<typeof missingFactSchema>;

export const routeEvidenceSchema = z.object({
  source: z.enum(['user', 'project', 'asset']),
  referenceId: z.string().min(1).max(100),
  excerpt: z.string().max(1_000),
});

export type RouteEvidence = z.infer<typeof routeEvidenceSchema>;

export const taskRouteSchema = z.object({
  version: z.literal(1),
  kind: taskRouteKindSchema,
  requestedDeliverables: z.array(z.string().max(100)).max(20),
  scope: taskRouteScopeSchema,
  workflow: taskWorkflowKindSchema.optional(),
  stageIntent: z.string().max(100).optional(),
  activePlanId: z.string().min(1).optional(),
  productionCategory: z.enum(['music-video', 'commercial', 'product-launch', 'ugc', 'drama', 'presenter', 'explainer', 'documentary', 'creative', 'promotion']).optional(),
  sourceIds: z.array(z.string().max(100)).max(50).default([]),
  requiredCapabilities: z.array(z.string().max(100)).max(20).default([]),
  missingFacts: z.array(missingFactSchema).max(10).default([]),
  evidence: z.array(routeEvidenceSchema).max(20).default([]),
});

export type TaskRouteV1 = z.infer<typeof taskRouteSchema>;

export function parseTaskRoute(raw: unknown): TaskRouteV1 {
  return taskRouteSchema.parse(raw);
}
