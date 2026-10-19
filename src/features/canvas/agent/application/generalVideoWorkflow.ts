import {
  type ProductionPlanV1,
  type ProductionStageV1,
  type ProductionWorkItemV1,
  productionPlanSchema,
} from '../domain/productionPlan';
import {
  type GeneralVideoDriver,
  detectGeneralVideoDriver,
  buildGeneralVideoStageOutline,
  matchGeneralVideoMethodCards,
  applyMethodCardToPrompt,
} from '../domain/generalVideoCards';

export interface CreateGeneralVideoPlanInput {
  projectId: string;
  planId?: string;
  prompt: string;
  driver?: GeneralVideoDriver;
  targetNodeIds?: string[];
  options?: {
    hasAssets?: boolean;
    wantStoryboardImages?: boolean;
    wantBgm?: boolean;
    wantCaptions?: boolean;
    multiClip?: boolean;
    episodeScope?: string;
  };
}

export interface GeneralVideoShotSpec {
  id: string;
  order: number;
  shotSize: 'extreme-wide' | 'wide' | 'medium' | 'medium-close' | 'close-up' | 'extreme-close';
  cameraAngle: 'level' | 'low-angle' | 'high-angle' | 'dutch-tilt';
  cameraMove: 'static' | 'pan' | 'tilt' | 'push-in' | 'pull-out' | 'tracking';
  subjectAction: string;
  hasHumanSubject: boolean;
  dialogue?: string;
  sfxAmbience: string;
  voSegmentId?: string;
}

export function createGeneralVideoPlan(input: CreateGeneralVideoPlanInput): ProductionPlanV1 {
  const driver = input.driver ?? detectGeneralVideoDriver(input.prompt);
  const planId = input.planId || `plan-gv-${Date.now()}`;
  const targetNodeIds = input.targetNodeIds || [];
  const options = input.options || {};
  const now = Date.now();

  const stageOutline = buildGeneralVideoStageOutline(driver, options);

  const soundPolicy = driver === 'speech'
    ? { mode: 'vo-post-mix', voiceModel: 'seed-audio-1.0', priority: 'seed-audio-priority' }
    : driver === 'on-camera'
    ? { mode: 'native-voice-ambience', music: 'none' }
    : { mode: 'native-sfx-ambience', music: options.wantBgm ? 'post-mix' : 'none' };

  // Author initial stage: intent-brief
  const briefWorkItem: ProductionWorkItemV1 = {
    id: `item-brief-${planId}`,
    name: '制作简案与视听规划',
    kind: 'document',
    inputRefs: targetNodeIds,
    requiredCapabilities: [],
    attempts: 0,
    status: 'pending',
    payload: {
      driver,
      originalPrompt: input.prompt,
      visualMotif: '自然光影、电影级景深、真实物理质感',
      soundDesign: soundPolicy,
      stageCount: stageOutline.length,
    },
    supersededOutputs: [],
  };

  const initialStage: ProductionStageV1 = {
    id: 'intent-brief',
    order: 0,
    name: '制作简案',
    revision: 1,
    goal: `制定${driver === 'speech' ? '语音驱动解说' : driver === 'on-camera' ? '真人出镜' : '故事与视听叙事'}制作简案`,
    dependsOn: [],
    status: 'ready',
    review: {
      beforeExecution: [],
      afterExecution: [],
    },
    executionLocks: {
      soundPolicy,
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
      id: 'general-video',
      variant: driver,
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['general-video'],
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

export function compileGeneralVideoClipPrompts(
  shots: GeneralVideoShotSpec[],
  driver: GeneralVideoDriver,
  options: {
    modelVendor?: 'MiniMax' | 'Kling' | 'Veo';
    enforcePhotorealSkin?: boolean;
    additionalDirectives?: string[];
  } = {}
): Array<{ shotId: string; prompt: string; cameraDelta: number; soundDirective: string }> {
  const results: Array<{ shotId: string; prompt: string; cameraDelta: number; soundDirective: string }> = [];

  const shotSizeScale: Record<GeneralVideoShotSpec['shotSize'], number> = {
    'extreme-wide': 1,
    'wide': 2,
    'medium': 3,
    'medium-close': 4,
    'close-up': 5,
    'extreme-close': 6,
  };

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const prevShot = i > 0 ? shots[i - 1] : undefined;

    // Shot size jump calculation (at least 1 shot size jump between adjacent shots of same subject)
    let shotSizeJump = 0;
    if (prevShot && shot.hasHumanSubject && prevShot.hasHumanSubject) {
      shotSizeJump = Math.abs(shotSizeScale[shot.shotSize] - shotSizeScale[prevShot.shotSize]);
      if (shotSizeJump < 1) {
        // Enforce shot size delta per H3 profile requirement
        shot.shotSize = shot.shotSize === 'medium' ? 'close-up' : 'medium';
        shotSizeJump = Math.abs(shotSizeScale[shot.shotSize] - shotSizeScale[prevShot.shotSize]);
      }
    }

    // Camera perspective delta: 30° to 90° for adjacent beats
    const cameraDelta = prevShot ? 45 : 0;

    // Construct prompt layers
    const promptParts: string[] = [
      `${shot.shotSize} shot, ${shot.cameraAngle}, camera ${shot.cameraMove}`,
      shot.subjectAction,
      `perspective delta ${cameraDelta} degrees, high temporal consistency`,
    ];

    if (shot.hasHumanSubject && (options.enforcePhotorealSkin || driver === 'on-camera')) {
      promptParts.push(applyMethodCardToPrompt('', 'photoreal-skin'));
    }

    if (options.additionalDirectives) {
      promptParts.push(...options.additionalDirectives);
    }

    let soundDirective = '';
    if (driver === 'speech') {
      soundDirective = 'native event SFX/ambience only, no spoken words or music in native track; VO added in Post';
    } else if (driver === 'on-camera') {
      soundDirective = shot.dialogue
        ? `native spoken voice: "${shot.dialogue}", natural environmental ambience, no music`
        : 'native environmental ambience and movement audio, no music';
    } else {
      soundDirective = shot.dialogue
        ? `native dialogue: "${shot.dialogue}", native Foley and environmental sound, no music on native track`
        : `native atmospheric sound: ${shot.sfxAmbience}, no music on native track`;
    }

    promptParts.push(`Audio: [${soundDirective}]`);

    results.push({
      shotId: shot.id,
      prompt: promptParts.filter(Boolean).join(', '),
      cameraDelta,
      soundDirective,
    });
  }

  return results;
}

export function executeGeneralVideoMethodDirect(input: {
  prompt: string;
  methodCardKeywordOrId: string;
}): {
  appliedCard: string;
  enhancedPrompt: string;
  guidanceRules: string[];
} {
  const cards = matchGeneralVideoMethodCards(input.methodCardKeywordOrId);
  const card = cards[0];

  if (!card) {
    return {
      appliedCard: input.methodCardKeywordOrId,
      enhancedPrompt: input.prompt,
      guidanceRules: ['未找到对应的专用方法卡，按原提示词执行'],
    };
  }

  const enhancedPrompt = card.promptDirective
    ? applyMethodCardToPrompt(input.prompt, card.id)
    : input.prompt;

  return {
    appliedCard: card.name,
    enhancedPrompt,
    guidanceRules: card.rules,
  };
}
