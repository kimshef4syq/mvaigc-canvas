import { enforceWorkflowConfirmations } from '../domain/workflowConfirmation';
import {
  type ProductionPlanV1,
  type ProductionStageV1,
  type ProductionWorkItemV1,
  productionPlanSchema,
} from '../domain/productionPlan';
import {
  type MvDirectionMode,
  type MvStyleSystem,
  type MvClipGroup,
  buildMvStageOutline,
  partitionMvClipGroups,
} from '../domain/musicVideo';

export interface CreateMusicVideoPlanInput {
  projectId: string;
  planId?: string;
  prompt: string;
  directionMode?: MvDirectionMode;
  styleSystem?: MvStyleSystem;
  musicSourceId?: string;
  targetNodeIds?: string[];
}

export function createMusicVideoPlan(input: CreateMusicVideoPlanInput): ProductionPlanV1 {
  const planId = input.planId || `plan-mv-${Date.now()}`;
  const now = Date.now();
  const directionMode = input.directionMode;
  const styleSystem = input.styleSystem;
  const sourceIds = input.musicSourceId ? [input.musicSourceId] : [];
  const targetNodeIds = input.targetNodeIds || [];

  const stageOutline = buildMvStageOutline();

  const briefWorkItem: ProductionWorkItemV1 = {
    id: `item-mv-intent-${planId}`,
    name: 'MV 创意方向与媒介规划',
    kind: 'document',
    inputRefs: [...sourceIds, ...targetNodeIds],
    requiredCapabilities: [],
    attempts: 0,
    status: 'pending',
    payload: {
      directionMode,
      styleSystem,
      originalPrompt: input.prompt,
      musicSourceId: input.musicSourceId,
    },
    supersededOutputs: [],
  };

  const initialStage: ProductionStageV1 = {
    id: 'intent',
    order: 0,
    name: '确定 MV 方向',
    revision: 1,
    goal: '先确定歌曲与参考素材来源，再由用户确认 MV 创意方向、风格、时长和画幅',
    dependsOn: [],
    status: 'ready',
    review: { beforeExecution: [], afterExecution: [] },
    executionLocks: {
      concurrencyLimit: 1, // MV requires serial generation
    },
    workItems: [briefWorkItem],
    currentOutputs: [],
    supersededOutputs: [],
  };

  return enforceWorkflowConfirmations(productionPlanSchema.parse({
    schemaVersion: 1,
    id: planId,
    projectId: input.projectId,
    revision: 1,
    workflow: {
      id: 'mv',
      confirmationPolicy: 'staged-v1',
      variant: directionMode ?? 'pending-intake',
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['music-video'],
      targetNodeIds,
    },
    sourceIds,
    decisions: [
      ...(directionMode ? [{ key: 'directionMode', value: directionMode, source: 'user' as const, scope: 'global', timestamp: now }] : []),
      ...(styleSystem ? [{ key: 'styleSystem', value: styleSystem, source: 'user' as const, scope: 'global', timestamp: now }] : []),
      { key: 'concurrencyLimit', value: 1, source: 'workflow', scope: 'global', timestamp: now },
    ],
    stageOutline,
    stages: [initialStage],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }));
}

export function authorMvShotPlan(
  plan: ProductionPlanV1,
  totalMusicDurationSeconds: number,
  customGroups?: MvClipGroup[]
): ProductionStageV1 {
  const groups = customGroups ?? partitionMvClipGroups(totalMusicDurationSeconds);

  // Validate gapless continuity & duration sum
  let expectedStart = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (Math.abs(group.startSeconds - expectedStart) > 0.05) {
      throw new Error(`MV 镜头组 ${group.id} 存在时间缺口：预期起始 ${expectedStart}s，实际起始 ${group.startSeconds}s`);
    }
    if (group.durationSeconds < 4.0 || group.durationSeconds > 15.0) {
      throw new Error(`MV 镜头组 ${group.id} 时长 (${group.durationSeconds}s) 超出 [4s, 15s] 范围`);
    }
    expectedStart = group.endSeconds;
  }

  const calculatedTotal = Math.round(groups.reduce((acc, g) => acc + g.durationSeconds, 0) * 1000) / 1000;
  if (Math.abs(calculatedTotal - totalMusicDurationSeconds) > 0.1) {
    throw new Error(`MV 分组总时长 (${calculatedTotal}s) 与主音乐实测时长 (${totalMusicDurationSeconds}s) 不一致`);
  }

  const workItems: ProductionWorkItemV1[] = [
    {
      id: `item-mv-shot-plan-doc-${plan.id}`,
      name: 'MV 导演分镜表',
      kind: 'document',
      inputRefs: [],
      requiredCapabilities: [],
      attempts: 0,
      status: 'pending',
      payload: {
        totalMusicDurationSeconds,
        groupCount: groups.length,
        groups,
      },
      supersededOutputs: [],
    },
  ];

  return {
    id: 'shot-plan',
    order: 4,
    name: '导演分镜规划',
    revision: 1,
    goal: `物化导演分镜文档，锁定全部 ${groups.length} 组无缝时间切片（4–15 秒）与镜头细节`,
    dependsOn: ['production-plan', 'assets'],
    status: 'ready',
    review: {
      beforeExecution: [],
      afterExecution: [
        {
          id: `review-shot-plan-${plan.id}`,
          label: 'MV 导演分镜与音乐卡点审阅',
          status: 'pending',
          contentHash: 'sha256:' + '0'.repeat(64),
        },
      ],
    },
    executionLocks: {
      concurrencyLimit: 1,
    },
    workItems,
    currentOutputs: [],
    supersededOutputs: [],
  };
}

export function compileMvClipPrompt(
  group: MvClipGroup,
  style: MvStyleSystem
): string {
  const styleDirectives: Record<MvStyleSystem, string> = {
    'cyberpunk-neon': 'Cyberpunk neon aesthetics, electric magenta and cyan illumination, volumetric rain reflections, futuristic holographic typography',
    'vintage-film': '16mm vintage film stock, authentic Kodak grain, warm analog color palette, cinematic gate weave',
    'y2k-futurism': 'Y2K cyber futurism, liquid chrome typography, iridescent metallic textures, fisheye lens distortion',
    'monochrome-minimal': 'High-contrast monochrome minimal style, stark chiaroscuro lighting, razor-sharp architectural geometry',
    'surreal-dream': 'Surreal dreamscape, floating zero-gravity objects, ethereal soft volumetric fog, pastel chromatic gradients',
  };

  const shotsNarrative = group.shots
    .map((s, idx) => `Beat ${idx + 1} (${s.durationSeconds}s): ${s.shotSize} shot, ${s.cameraMovement}, ${s.action}${s.lyricsSnippet ? `, lip-syncing: "${s.lyricsSnippet}"` : ''}`)
    .join('. ');

  const prompt = [
    `MV Sequence Group ${group.groupIndex + 1} (${group.startSeconds}s - ${group.endSeconds}s, total ${group.durationSeconds}s)`,
    styleDirectives[style],
    shotsNarrative,
    'Continuous fluid motion, musical beat synchronization, cinematic 2K master quality',
  ].join('. ');

  return prompt.length > 7000 ? prompt.slice(0, 6997) + '...' : prompt;
}
