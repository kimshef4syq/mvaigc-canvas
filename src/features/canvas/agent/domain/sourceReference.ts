import { z } from 'zod';

export const sourceKindSchema = z.enum([
  'pasted-text',
  'canvas-text',
  'text-file',
  'pdf',
  'docx',
  'table',
  'asset',
]);

export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceSegmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});

export type SourceSegmentV1 = z.infer<typeof sourceSegmentSchema>;

export const sourceReferenceSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  kind: sourceKindSchema,
  mimeType: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  characterCount: z.number().int().nonnegative(),
  pageCount: z.number().int().positive().optional(),
  segments: z.array(sourceSegmentSchema).default([]),
  requiresOcr: z.boolean().default(false),
  ocrReason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type SourceReferenceV1 = z.infer<typeof sourceReferenceSchema>;
