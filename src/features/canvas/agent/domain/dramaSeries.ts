import { z } from 'zod';
import { type StageOutlineItem } from './productionPlan';

export const dramaProductionModeSchema = z.enum(['live-action', 'anime']);
export type DramaProductionMode = z.infer<typeof dramaProductionModeSchema>;

export const dramaBgmPolicySchema = z.enum(['off', 'provided', 'generate']);
export type DramaBgmPolicy = z.infer<typeof dramaBgmPolicySchema>;

export const dramaSubtitlePolicySchema = z.enum(['off', 'burn-subtitles']);
export type DramaSubtitlePolicy = z.infer<typeof dramaSubtitlePolicySchema>;

export const dramaStoryboardStyleSchema = z.enum(['grid', 'skip']);
export type DramaStoryboardStyle = z.infer<typeof dramaStoryboardStyleSchema>;

export const dramaSeriesScopeSchema = z.object({
  episodeScope: z.string().min(1).default('第1集'),
  hasExistingScript: z.boolean().default(false),
  productionMode: dramaProductionModeSchema.default('live-action'),
  aspectRatio: z.enum(['9:16', '16:9']).default('9:16'),
  bgmPolicy: dramaBgmPolicySchema.default('off'),
  subtitlePolicy: dramaSubtitlePolicySchema.default('off'),
  storyboardStyle: dramaStoryboardStyleSchema.default('skip'),
});

export type DramaSeriesScope = z.infer<typeof dramaSeriesScopeSchema>;

export const dramaBlockingEntrySchema = z.object({
  characterId: z.string().min(1),
  position: z.enum(['stage-left', 'stage-center', 'stage-right', 'foreground', 'background']),
  facingDirection: z.enum(['towards-camera', 'profile-left', 'profile-right', 'back-to-camera']),
  eyeLineTarget: z.string().optional(),
});

export type DramaBlockingEntry = z.infer<typeof dramaBlockingEntrySchema>;

export const dramaShotSpecSchema = z.object({
  shotId: z.string().min(1),
  shotNumber: z.number().int().positive(),
  clipGroupId: z.string().min(1),
  durationSeconds: z.number().positive().max(15.0), // Hard cap: <= 15s per clip group
  shotSize: z.enum(['extreme-wide', 'wide', 'medium', 'medium-close', 'close-up', 'extreme-close']),
  cameraMovement: z.string().min(1),
  blocking: z.array(dramaBlockingEntrySchema).default([]),
  actionDescription: z.string().min(1),
  verbatimDialogue: z.string().default(''), // Verbatim dialogue preservation
  sfxAmbience: z.string().default(''),
});

export type DramaShotSpec = z.infer<typeof dramaShotSpecSchema>;

export const dramaAnchorKindSchema = z.enum(['character', 'prop', 'scene']);
export type DramaAnchorKind = z.infer<typeof dramaAnchorKindSchema>;

export const dramaAnchorSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: dramaAnchorKindSchema,
  dependsOnPropIds: z.array(z.string()).default([]), // Prop dependency precedes character status
  prompt: z.string().min(1),
  aspectRatio: z.string().default('1:1'),
});

export type DramaAnchorSpec = z.infer<typeof dramaAnchorSpecSchema>;

export function buildDramaSeriesStageOutline(scope: {
  hasExistingScript?: boolean;
  skipKeyframes?: boolean;
}): StageOutlineItem[] {
  const stages: StageOutlineItem[] = [];
  let order = 0;

  // 1. Script stage: conditional, ONLY if user does not have an existing script
  if (!scope.hasExistingScript) {
    stages.push({
      id: 'script',
      order: order++,
      name: '剧本',
      condition: '用户未提供剧本时需先编写与确认剧本大纲',
    });
  }

  // 2. Production Plan: always required
  stages.push({
    id: 'production-plan',
    order: order++,
    name: '制作计划',
  });

  // 3. Asset Anchors: characters, props, scenes
  stages.push({
    id: 'asset-anchors',
    order: order++,
    name: '资产锚点',
  });

  // 4. Storyboard: blocking memory + shot breakdown
  stages.push({
    id: 'storyboard',
    order: order++,
    name: '分镜',
  });

  // 5. Scene Keyframes: conditional, omitted when user chooses 'skip'
  if (!scope.skipKeyframes) {
    stages.push({
      id: 'scene-keyframes',
      order: order++,
      name: '宫格关键帧',
      condition: '用户选择生成构图宫格参考',
    });
  }

  // 6. Visual Gen: video generation
  stages.push({
    id: 'visual-gen',
    order: order++,
    name: '视频生成',
  });

  // 7. Post: deterministic assembly & cleanup
  stages.push({
    id: 'post',
    order: order++,
    name: '后期',
  });

  return stages;
}

export function sortDramaAnchorsByDependency(anchors: DramaAnchorSpec[]): DramaAnchorSpec[] {
  const props = anchors.filter((a) => a.kind === 'prop');
  const characters = anchors.filter((a) => a.kind === 'character');
  const scenes = anchors.filter((a) => a.kind === 'scene');

  // Props MUST precede characters who hold or depend on those props!
  return [...props, ...characters, ...scenes];
}
