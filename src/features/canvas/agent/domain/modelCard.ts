import { z } from 'zod';
import { type PromptIssue } from '@/features/promptCompiler/PromptLinter';

export const vendorModelIdSchema = z.enum([
  'minimax-h3',
  'minimax',
  'seedance',
  'seedaudio',
  'kling-omni',
  'kling',
  'veo',
  'wan',
  'midjourney',
  'banana',
  'gpt-image',
  'moss',
  'official-music',
  'seedream',
]);

export type VendorModelId = z.infer<typeof vendorModelIdSchema>;

export const VENDOR_MODEL_ALIASES: Record<string, VendorModelId> = {
  'minimax-h3': 'minimax-h3',
  'h3': 'minimax-h3',
  'hailuo': 'minimax',
  'minimax': 'minimax',
  'seedance': 'seedance',
  'seed-dance': 'seedance',
  'seedaudio': 'seedaudio',
  'seed-audio': 'seedaudio',
  'kling': 'kling',
  'kling-omni': 'kling-omni',
  'kling-1.5': 'kling-omni',
  'kuaishou-kling': 'kling-omni',
  'veo': 'veo',
  'veo-2': 'veo',
  'veo-3': 'veo',
  'google-veo': 'veo',
  'wan': 'wan',
  'wan-2.1': 'wan',
  'wan-2.2': 'wan',
  'midjourney': 'midjourney',
  'mj': 'midjourney',
  'banana': 'banana',
  'flux': 'banana',
  'gpt-image': 'gpt-image',
  'dalle-3': 'gpt-image',
  'moss': 'moss',
  'official-music': 'official-music',
  'suno': 'official-music',
  'udio': 'official-music',
  'seedream': 'seedream',
};

export function resolveVendorModelAlias(rawName: string): VendorModelId | undefined {
  const normalized = rawName.toLowerCase().trim().replace(/_/g, '-');
  return VENDOR_MODEL_ALIASES[normalized];
}

export const soundPolicyKindSchema = z.enum([
  'dialogue',       // Native spoken dialogue
  'sfx',            // Native ambient sound / Foley SFX
  'voiceover',      // Separate narration audio track
  'bgm',            // Background music
  'keep-original',  // Preserve source audio
  'replace-audio',  // Strip and replace audio track
  'mute',           // Explicitly silent
]);

export type SoundPolicyKind = z.infer<typeof soundPolicyKindSchema>;

export const soundPolicySchema = z.object({
  kind: soundPolicyKindSchema,
  speaker: z.string().optional(),
  voiceId: z.string().optional(),
  tone: z.string().optional(),
  language: z.string().default('zh-CN'),
  hasBgm: z.boolean().default(false),
  hasDialogue: z.boolean().default(false),
  details: z.string().optional(),
});

export type SoundPolicyV1 = z.infer<typeof soundPolicySchema>;

export const multimodalReferenceUsageSchema = z.enum([
  'identity', // Character face/body identity anchor
  'style',    // Visual aesthetic or color grade reference
  'product',  // Commercial merchandise anchor
  'scene',    // Environmental lighting/location reference
  'motion',   // Camera movement or choreography reference
  'voice',    // Audio voiceprint sample
]);

export type MultimodalReferenceUsage = z.infer<typeof multimodalReferenceUsageSchema>;

export const referenceSlotBindingSchema = z.object({
  slotIndex: z.number().int().positive(),
  slotToken: z.string(), // e.g., "@图片1", "@音频1"
  assetId: z.string(),
  usage: multimodalReferenceUsageSchema,
  label: z.string().optional(),
  durationSeconds: z.number().optional(),
});

export type ReferenceSlotBindingV1 = z.infer<typeof referenceSlotBindingSchema>;

export const promptLayerRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sourcePrompt: z.string(),
  preparedPrompt: z.string(),
  submittedPrompt: z.string(),
  compilerVersion: z.string(),
  compilerHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  modelId: vendorModelIdSchema,
  referenceSlots: z.array(referenceSlotBindingSchema).default([]),
  soundPolicy: soundPolicySchema.optional(),
  issues: z.array(z.custom<PromptIssue>()).default([]),
  createdAt: z.number().int().positive(),
});

export type PromptLayerRecordV1 = z.infer<typeof promptLayerRecordSchema>;
