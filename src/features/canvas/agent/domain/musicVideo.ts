import { z } from 'zod';
import { type StageOutlineItem } from './productionPlan';

export const mvDirectionModeSchema = z.enum([
  'narrative_story',
  'visual_aesthetic',
]);
export type MvDirectionMode = z.infer<typeof mvDirectionModeSchema>;

export const mvStyleSystemSchema = z.enum([
  'cyberpunk-neon',
  'vintage-film',
  'y2k-futurism',
  'monochrome-minimal',
  'surreal-dream',
]);
export type MvStyleSystem = z.infer<typeof mvStyleSystemSchema>;

export const mvShotSpecSchema = z.object({
  id: z.string().min(1),
  durationSeconds: z.number().positive(),
  shotSize: z.string().min(1),
  cameraMovement: z.string().min(1),
  action: z.string().min(1),
  lyricsSnippet: z.string().optional(),
  visualFocus: z.string().optional(),
});

export type MvShotSpec = z.infer<typeof mvShotSpecSchema>;

export const mvClipGroupSchema = z.object({
  id: z.string().min(1),
  groupIndex: z.number().int().nonnegative(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  durationSeconds: z.number().min(4.0).max(15.0), // Hard cap: 4s to 15s
  shots: z.array(mvShotSpecSchema).min(1),
});

export type MvClipGroup = z.infer<typeof mvClipGroupSchema>;

export function buildMvStageOutline(): StageOutlineItem[] {
  return [
    { id: 'intent', order: 0, name: '确定 MV 方向' },
    { id: 'music-prep', order: 1, name: '确定主音乐' },
    { id: 'production-plan', order: 2, name: '制作计划与时间轴' },
    { id: 'assets', order: 3, name: '角色与场景锚点' },
    { id: 'shot-plan', order: 4, name: '导演分镜规划' },
    { id: 'visual-gen', order: 5, name: '视频生成' },
    { id: 'post', order: 6, name: '后期合成与音轨覆盖' },
  ];
}

/**
 * Calculates continuous sequential clip groups matching exact music duration.
 * Enforces:
 * 1. Each group is between 4.0s and 15.0s.
 * 2. Continuous without any gaps: group[i].startSeconds === group[i-1].endSeconds.
 * 3. Sum of durations strictly equals totalMusicDurationSeconds.
 */
export function partitionMvClipGroups(totalMusicDurationSeconds: number): MvClipGroup[] {
  if (totalMusicDurationSeconds < 4.0) {
    throw new Error(`主音乐实测时长 (${totalMusicDurationSeconds}s) 过短，MV 制作至少需要 4 秒。`);
  }

  const groups: MvClipGroup[] = [];
  let remaining = totalMusicDurationSeconds;
  let currentStart = 0;
  let index = 0;

  while (remaining > 0) {
    let groupDuration: number;

    if (remaining <= 15.0) {
      if (remaining >= 4.0) {
        groupDuration = remaining;
      } else {
        // Last slice would be < 4s, borrow from previous group
        if (groups.length > 0) {
          const prev = groups[groups.length - 1];
          const needed = 4.0 - remaining;
          prev.durationSeconds = Math.round((prev.durationSeconds - needed) * 1000) / 1000;
          prev.endSeconds = Math.round((prev.startSeconds + prev.durationSeconds) * 1000) / 1000;
          currentStart = prev.endSeconds;
          groupDuration = 4.0;
        } else {
          groupDuration = remaining;
        }
      }
    } else {
      // Chunk into ~10-12s groups
      groupDuration = remaining >= 24.0 ? 12.0 : Math.round((remaining / 2) * 1000) / 1000;
      if (groupDuration > 15.0) groupDuration = 15.0;
    }

    groupDuration = Math.round(groupDuration * 1000) / 1000;
    const currentEnd = Math.round((currentStart + groupDuration) * 1000) / 1000;

    groups.push({
      id: `mv-group-${index + 1}`,
      groupIndex: index,
      startSeconds: currentStart,
      endSeconds: currentEnd,
      durationSeconds: groupDuration,
      shots: [
        {
          id: `shot-${index + 1}-1`,
          durationSeconds: groupDuration,
          shotSize: 'medium',
          cameraMovement: 'dynamic tracking',
          action: `MV Beat visual sequence for group ${index + 1}`,
        },
      ],
    });

    currentStart = currentEnd;
    remaining = Math.round((totalMusicDurationSeconds - currentStart) * 1000) / 1000;
    index++;
  }

  return groups;
}
