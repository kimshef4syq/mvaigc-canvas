import { enforceWorkflowConfirmations } from '../domain/workflowConfirmation';
import {
  type ProductionPlanV1,
  type ProductionStageV1,
  type ProductionWorkItemV1,
  productionPlanSchema,
} from '../domain/productionPlan';
import {
  type DramaSeriesScope,
  type DramaShotSpec,
  type DramaAnchorSpec,
  buildDramaSeriesStageOutline,
  sortDramaAnchorsByDependency,
} from '../domain/dramaSeries';

export interface CreateDramaSeriesPlanInput {
  projectId: string;
  planId?: string;
  prompt: string;
  scope?: Partial<DramaSeriesScope>;
  sourceIds?: string[];
  targetNodeIds?: string[];
}

export function createDramaSeriesPlan(input: CreateDramaSeriesPlanInput): ProductionPlanV1 {
  const planId = input.planId || `plan-drama-${Date.now()}`;
  const now = Date.now();
  const targetNodeIds = input.targetNodeIds || [];
  const sourceIds = input.sourceIds || [];

  const episodeScope = input.scope?.episodeScope || '待确认集数';
  const hasExistingScript = input.scope?.hasExistingScript ?? (sourceIds.length > 0 || /已有剧本|提供剧本|上传剧本/i.test(input.prompt));
  const skipKeyframes = input.scope?.storyboardStyle === 'skip' || /跳过宫格|不生成宫格/i.test(input.prompt);
  const productionMode = input.scope?.productionMode || 'live-action';
  const aspectRatio = input.scope?.aspectRatio || '9:16';
  const bgmPolicy = input.scope?.bgmPolicy || 'off';
  const subtitlePolicy = input.scope?.subtitlePolicy || 'off';

  const stageOutline = buildDramaSeriesStageOutline({
    hasExistingScript,
    skipKeyframes,
  });

  const firstStageId = stageOutline[0].id;
  let initialStage: ProductionStageV1;

  if (firstStageId === 'script') {
    initialStage = {
      id: 'script',
      order: 0,
      name: '剧本',
      revision: 1,
      goal: `根据故事前提编写${episodeScope}剧本文档，锁定场次、逐字对白与冲突反转`,
      dependsOn: [],
      status: 'ready',
      review: { beforeExecution: [], afterExecution: [] },
      executionLocks: {
        aspectRatio,
        durationRange: [60, 120],
      },
      workItems: [
        {
          id: `item-script-${planId}`,
          name: `${episodeScope}剧本文档`,
          kind: 'document',
          inputRefs: targetNodeIds,
          requiredCapabilities: [],
          attempts: 0,
          status: 'pending',
          payload: {
            episodeScope,
            originalPrompt: input.prompt,
          },
          supersededOutputs: [],
        },
      ],
      currentOutputs: [],
      supersededOutputs: [],
    };
  } else {
    initialStage = {
      id: 'production-plan',
      order: 0,
      name: '制作计划',
      revision: 1,
      goal: `制定${episodeScope}制作计划文档，锁定基础锁项、资产清单与视觉媒介`,
      dependsOn: [],
      status: 'ready',
      review: { beforeExecution: [], afterExecution: [] },
      executionLocks: {
        aspectRatio,
        soundPolicy: { bgmPolicy, subtitlePolicy, productionMode },
      },
      workItems: [
        {
          id: `item-plan-doc-${planId}`,
          name: `制作计划 — ${episodeScope}`,
          kind: 'document',
          inputRefs: [...sourceIds, ...targetNodeIds],
          requiredCapabilities: [],
          attempts: 0,
          status: 'pending',
          payload: {
            episodeScope,
            productionMode,
            aspectRatio,
            bgmPolicy,
            subtitlePolicy,
          },
          supersededOutputs: [],
        },
      ],
      currentOutputs: [],
      supersededOutputs: [],
    };
  }

  return enforceWorkflowConfirmations(productionPlanSchema.parse({
    schemaVersion: 1,
    id: planId,
    projectId: input.projectId,
    revision: 1,
    workflow: {
      id: 'drama-series',
      confirmationPolicy: 'staged-v1',
      variant: productionMode,
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['drama-episode-video'],
      targetEpisodeScope: input.scope?.episodeScope,
      targetNodeIds,
    },
    sourceIds,
    decisions: [
      { key: 'targetEpisodeScope', value: input.scope?.episodeScope, source: input.scope?.episodeScope ? 'user' : 'default', scope: 'global', timestamp: now },
      { key: 'productionMode', value: productionMode, source: input.scope?.productionMode ? 'user' : 'default', scope: 'global', timestamp: now },
      { key: 'aspectRatio', value: aspectRatio, source: input.scope?.aspectRatio ? 'user' : 'default', scope: 'global', timestamp: now },
      { key: 'bgmPolicy', value: bgmPolicy, source: input.scope?.bgmPolicy ? 'user' : 'default', scope: 'global', timestamp: now },
      { key: 'subtitlePolicy', value: subtitlePolicy, source: input.scope?.subtitlePolicy ? 'user' : 'default', scope: 'global', timestamp: now },
    ],
    stageOutline,
    stages: [initialStage],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }));
}

export function authorDramaAssetStage(
  plan: ProductionPlanV1,
  anchors: DramaAnchorSpec[]
): ProductionStageV1 {
  const sortedAnchors = sortDramaAnchorsByDependency(anchors);

  const workItems: ProductionWorkItemV1[] = sortedAnchors.map((anchor) => ({
    id: `item-anchor-${anchor.id}`,
    name: `${anchor.kind === 'prop' ? '道具' : anchor.kind === 'character' ? '角色' : '场景'}锚点：${anchor.name}`,
    kind: 'image',
    inputRefs: anchor.dependsOnPropIds.map((id) => `item-anchor-${id}`),
    requiredCapabilities: ['generation:image'],
    attempts: 0,
    status: 'pending',
    payload: {
      anchorId: anchor.id,
      anchorKind: anchor.kind,
      prompt: anchor.prompt,
      aspectRatio: anchor.aspectRatio,
    },
    supersededOutputs: [],
  }));

  return {
    id: 'asset-anchors',
    order: plan.stageOutline.find((s) => s.id === 'asset-anchors')?.order ?? 1,
    name: '资产锚点',
    revision: 1,
    goal: '依次生成道具主卡、角色身份卡与场景空间卡，严格遵循道具依赖优先原则',
    dependsOn: ['production-plan'],
    status: 'ready',
    review: {
      beforeExecution: [],
      afterExecution: [
        {
          id: `review-anchors-${plan.id}`,
          label: '资产锚点联合验收（角色一致性、道具锁定与场景透视）',
          status: 'pending',
          contentHash: 'sha256:' + '0'.repeat(64),
        },
      ],
    },
    executionLocks: {},
    workItems,
    currentOutputs: [],
    supersededOutputs: [],
  };
}

export function authorDramaStoryboardStage(
  plan: ProductionPlanV1,
  shots: DramaShotSpec[]
): ProductionStageV1 {
  // Validate all clip groups do not exceed 15s limit
  for (const shot of shots) {
    if (shot.durationSeconds > 15.0) {
      throw new Error(`分镜镜头组 ${shot.shotId} 时长 (${shot.durationSeconds}s) 超出单片段 15 秒硬上限，必须拆组。`);
    }
  }

  const workItems: ProductionWorkItemV1[] = [
    {
      id: `item-blocking-memory-${plan.id}`,
      name: `站位记忆 — ${plan.scope.targetEpisodeScope ?? '第1集'}`,
      kind: 'document',
      inputRefs: [],
      requiredCapabilities: [],
      attempts: 0,
      status: 'pending',
      payload: {
        blockings: shots.map((s) => ({ shotId: s.shotId, blocking: s.blocking })),
      },
      supersededOutputs: [],
    },
    {
      id: `item-storyboard-doc-${plan.id}`,
      name: `分镜列表 — ${plan.scope.targetEpisodeScope ?? '第1集'}`,
      kind: 'document',
      inputRefs: [`item-blocking-memory-${plan.id}`],
      requiredCapabilities: [],
      attempts: 0,
      status: 'pending',
      payload: {
        shots: shots.map((s) => ({
          shotId: s.shotId,
          duration: s.durationSeconds,
          verbatimDialogue: s.verbatimDialogue,
          action: s.actionDescription,
        })),
      },
      supersededOutputs: [],
    },
  ];

  return {
    id: 'storyboard',
    order: plan.stageOutline.find((s) => s.id === 'storyboard')?.order ?? 2,
    name: '分镜',
    revision: 1,
    goal: '物化站位记忆文档与分镜列表，锁定镜级拆解、逐字对白与每组 ≤15 秒时长',
    dependsOn: ['asset-anchors'],
    status: 'ready',
    review: {
      beforeExecution: [],
      afterExecution: [
        {
          id: `review-storyboard-${plan.id}`,
          label: '分镜列表与站位记忆联合审阅',
          status: 'pending',
          contentHash: 'sha256:' + '0'.repeat(64),
        },
      ],
    },
    executionLocks: {},
    workItems,
    currentOutputs: [],
    supersededOutputs: [],
  };
}

export function reworkDramaShot(
  plan: ProductionPlanV1,
  shotId: string,
  updatedPrompt: string
): ProductionPlanV1 {
  const visualGenStage = plan.stages.find((s) => s.id === 'visual-gen');
  if (!visualGenStage) {
    throw new Error('未找到视频生成阶段（visual-gen），无法进行镜头重做');
  }

  const updatedWorkItems = visualGenStage.workItems.map((item) => {
    if (item.id === shotId || item.id === `item-video-${shotId}`) {
      return {
        ...item,
        status: 'pending' as const,
        attempts: item.attempts + 1,
        payload: {
          ...(typeof item.payload === 'object' && item.payload ? item.payload : {}),
          prompt: updatedPrompt,
        },
      };
    }
    return item;
  });

  const updatedStages = plan.stages.map((stage) => {
    if (stage.id === 'visual-gen') {
      return {
        ...stage,
        revision: stage.revision + 1,
        status: 'ready' as const,
        workItems: updatedWorkItems,
      };
    }
    return stage;
  });

  return {
    ...plan,
    revision: plan.revision + 1,
    stages: updatedStages,
    updatedAt: Date.now(),
  };
}
