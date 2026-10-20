import {
  type ProductionPlanV1,
  type ProductionStageV1,
  type ProductionWorkItemV1,
  productionPlanSchema,
} from '../domain/productionPlan';
import {
  type KocContentFormat,
  type KocPlatform,
  buildKocStageOutline,
  KOC_DEFAULT_HOOK_TEMPLATES,
  KOC_DEFAULT_PERSONA_CANDIDATES,
} from '../domain/kocVideo';

export interface CreateKocPlanInput {
  projectId: string;
  planId?: string;
  prompt: string;
  contentFormat?: KocContentFormat;
  platform?: KocPlatform;
  productSourceIds?: string[];
  creatorImageSourceId?: string;
  targetNodeIds?: string[];
  options?: {
    wantBgm?: boolean;
    wantSubtitles?: boolean;
    durationSeconds?: number;
  };
}

export function detectKocContentFormat(text: string): KocContentFormat {
  if (/(?:仅手部|手部特写|只拍手|开箱特写)/i.test(text)) return 'hands-only';
  if (/(?:仅产品|只拍产品|静物|无人物)/i.test(text)) return 'product-only';
  return 'on-camera'; // Default to on-camera host/creator
}

export function createKocPlan(input: CreateKocPlanInput): ProductionPlanV1 {
  const planId = input.planId || `plan-koc-${Date.now()}`;
  const now = Date.now();
  const format = input.contentFormat ?? detectKocContentFormat(input.prompt);
  const platform = input.platform || 'xiaohongshu';
  const productSourceIds = input.productSourceIds || [];
  const targetNodeIds = input.targetNodeIds || [];

  // Audio & Subtitle Policies (A22)
  // Subtitles: strict explicit opt-in (default off)
  const explicitlyNoSubtitles = /(?:不要\s*(?:加)?\s*字幕|不加\s*字幕|无\s*字幕|关(?:闭)?\s*字幕)/i.test(input.prompt);
  const wantSubtitles = input.options?.wantSubtitles ?? (!explicitlyNoSubtitles && /(?:(?:需要|开启|带|加上|加)\s*字幕)/i.test(input.prompt));
  const explicitlyNoBgm = /(?:不要\s*(?:加)?\s*bgm|不加\s*bgm|无\s*bgm|不要\s*(?:加)?\s*音乐|不加\s*音乐|无配乐|不用\s*音乐)/i.test(input.prompt);
  const wantBgm = input.options?.wantBgm !== undefined ? input.options.wantBgm : !explicitlyNoBgm;

  // Assets need: if on-camera and no existing creator image provided, needAssets = true
  const needAssets = format === 'on-camera' && !input.creatorImageSourceId;
  // Post need: if multi-clip or BGM or subtitles needed
  const needPost = wantBgm || wantSubtitles || (input.options?.durationSeconds ?? 15) > 15;

  const stageOutline = buildKocStageOutline({
    needAssets,
    needPost,
  });

  const briefWorkItem: ProductionWorkItemV1 = {
    id: `item-koc-brief-${planId}`,
    name: `KOC 种草提案简报 — [${format}]`,
    kind: 'document',
    inputRefs: [...productSourceIds, ...targetNodeIds],
    requiredCapabilities: [],
    attempts: 0,
    status: 'pending',
    payload: {
      contentFormat: format,
      platform,
      originalPrompt: input.prompt,
      hookCandidates: KOC_DEFAULT_HOOK_TEMPLATES,
      personaCandidates: format === 'on-camera' ? KOC_DEFAULT_PERSONA_CANDIDATES : [],
      selectedHookId: 'hook-1',
      selectedPersonaId: format === 'on-camera' ? 'persona-1' : undefined,
      wantBgm,
      wantSubtitles,
      audioApproach: 'native-dialogue-in-video', // Hard rule: native in video, no separate TTS
    },
    supersededOutputs: [],
  };

  const initialStage: ProductionStageV1 = {
    id: 'brief',
    order: 0,
    name: '提案简报',
    revision: 1,
    goal: '制定 KOC 种草提案，锁定 5 个 Hook 候选与 3 个博主 Persona，明确原生口播与声音决策',
    dependsOn: [],
    status: 'ready',
    review: { beforeExecution: [], afterExecution: [] },
    executionLocks: {
      aspectRatio: '9:16',
      soundPolicy: {
        voiceoverMode: 'native-in-video',
        bgmMode: wantBgm ? 'instrumental-ducked' : 'off',
        subtitleMode: wantSubtitles ? 'burn-subtitles' : 'off',
      },
    },
    workItems: [briefWorkItem],
    currentOutputs: [],
    supersededOutputs: [],
  };

  return productionPlanSchema.parse({
    schemaVersion: 1,
    id: planId,
    projectId: input.projectId,
    revision: 1,
    workflow: {
      id: 'koc-video',
      variant: format,
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['koc-video'],
      targetNodeIds,
    },
    sourceIds: productSourceIds,
    decisions: [
      { key: 'contentFormat', value: format, source: 'workflow', scope: 'global', timestamp: now },
      { key: 'platform', value: platform, source: 'workflow', scope: 'global', timestamp: now },
      { key: 'wantBgm', value: wantBgm, source: 'workflow', scope: 'global', timestamp: now },
      { key: 'wantSubtitles', value: wantSubtitles, source: 'workflow', scope: 'global', timestamp: now },
      { key: 'audioApproach', value: 'native-dialogue-in-video', source: 'workflow', scope: 'global', timestamp: now },
    ],
    stageOutline,
    stages: [initialStage],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

export interface CreateAudioProductionPlanInput {
  projectId: string;
  planId?: string;
  prompt: string;
  targetNodeIds?: string[];
}

export function createAudioProductionPlan(input: CreateAudioProductionPlanInput): ProductionPlanV1 {
  const planId = input.planId || `plan-audio-${Date.now()}`;
  const now = Date.now();
  const targetNodeIds = input.targetNodeIds || [];

  const stageOutline = [
    { id: 'script-prep', order: 0, name: '旁白与歌词文本准备' },
    { id: 'voice-generation', order: 1, name: '语音生成与音色克隆' },
    { id: 'music-scoring', order: 2, name: '音乐伴奏编排' },
    { id: 'audio-mastering', order: 3, name: '混音母带与响度校准' },
  ];

  const initialStage: ProductionStageV1 = {
    id: 'script-prep',
    order: 0,
    name: '旁白与歌词文本准备',
    revision: 1,
    goal: '准备并校对逐字旁白文本、发音标记与结构分段',
    dependsOn: [],
    status: 'ready',
    review: { beforeExecution: [], afterExecution: [] },
    executionLocks: {},
    workItems: [
      {
        id: `item-audio-script-${planId}`,
        name: '旁白文本台本',
        kind: 'document',
        inputRefs: targetNodeIds,
        requiredCapabilities: [],
        attempts: 0,
        status: 'pending',
        payload: {
          originalPrompt: input.prompt,
        },
        supersededOutputs: [],
      },
    ],
    currentOutputs: [],
    supersededOutputs: [],
  };

  return productionPlanSchema.parse({
    schemaVersion: 1,
    id: planId,
    projectId: input.projectId,
    revision: 1,
    workflow: {
      id: 'audio-production',
      variant: 'canonical',
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['standalone-audio'],
      targetNodeIds,
    },
    sourceIds: [],
    decisions: [],
    stageOutline,
    stages: [initialStage],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}
