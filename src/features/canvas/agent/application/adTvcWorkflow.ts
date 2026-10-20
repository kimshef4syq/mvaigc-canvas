import {
  type ProductionPlanV1,
  type ProductionStageV1,
  type ProductionWorkItemV1,
  productionPlanSchema,
} from '../domain/productionPlan';
import {
  type AdTvcCategory,
  type AdTvcDirection,
  type AdTvcTypographyPackage,
  buildAdTvcStageOutline,
  matchAdTvcTechniques,
  AD_TVC_VISUAL_TECHNIQUES,
} from '../domain/adTvc';

export interface CreateAdTvcPlanInput {
  projectId: string;
  planId?: string;
  prompt: string;
  category?: AdTvcCategory;
  direction?: AdTvcDirection;
  productSourceIds?: string[];
  targetNodeIds?: string[];
  options?: {
    wantIndependentBgm?: boolean;
    durationSeconds?: number;
  };
}

export function detectAdTvcCategory(text: string): AdTvcCategory {
  const normalized = text.toLowerCase();
  if (/(?:汽车|跑车|suv|驾驶|座驾|电动车)/i.test(normalized)) return 'auto';
  if (/(?:美妆|护肤|面霜|口红|精华|香水)/i.test(normalized)) return 'beauty';
  if (/(?:服装|穿搭|时装|高定|羽绒服|鞋)/i.test(normalized)) return 'fashion';
  if (/(?:食品|饮料|餐饮|咖啡|茶饮|快餐|美食)/i.test(normalized)) return 'food';
  if (/(?:家电|冰箱|洗衣机|空调|吸尘器|电视)/i.test(normalized)) return 'appliance';
  return 'tech'; // Default to 3C / Tech
}

export function detectAdTvcDirection(text: string): AdTvcDirection {
  const normalized = text.toLowerCase();
  if (/(?:品牌片|品牌大片|品牌理念|态度)/i.test(normalized)) return 'brand-ad';
  if (/(?:故事|剧情|微电影式|温情)/i.test(normalized)) return 'story-ad';
  if (/(?:病毒|传播|反转|爆点|洗脑)/i.test(normalized)) return 'viral-ad';
  return 'product-ad'; // Default to product ad
}

export function createAdTvcPlan(input: CreateAdTvcPlanInput): ProductionPlanV1 {
  const planId = input.planId || `plan-tvc-${Date.now()}`;
  const now = Date.now();
  const category = input.category ?? detectAdTvcCategory(input.prompt);
  const direction = input.direction ?? detectAdTvcDirection(input.prompt);
  const productSourceIds = input.productSourceIds || [];
  const targetNodeIds = input.targetNodeIds || [];
  const wantIndependentBgm = input.options?.wantIndependentBgm ?? false;

  const stageOutline = buildAdTvcStageOutline({ hasBgm: wantIndependentBgm });

  const briefWorkItem: ProductionWorkItemV1 = {
    id: `item-tvc-brief-${planId}`,
    name: `需求简报 — [${category} / ${direction}]`,
    kind: 'document',
    inputRefs: [...productSourceIds, ...targetNodeIds],
    requiredCapabilities: [],
    attempts: 0,
    status: 'pending',
    payload: {
      category,
      direction,
      originalPrompt: input.prompt,
      productSourceIds,
      voiceoverPolicy: 'native-in-video', // TVC VO is generated natively in video units
    },
    supersededOutputs: [],
  };

  const initialStage: ProductionStageV1 = {
    id: 'intake-brief',
    order: 0,
    name: '需求简报',
    revision: 1,
    goal: `明确${category}品类与${direction}方向TVC创意目标，锁定产品事实与交付规格`,
    dependsOn: [],
    status: 'ready',
    review: { beforeExecution: [], afterExecution: [] }, // No review for intake
    executionLocks: {
      soundPolicy: {
        mode: 'native-voiceover-in-video',
        independentBgm: wantIndependentBgm ? 'on' : 'off',
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
      id: 'ad-tvc',
      variant: `${category}:${direction}`,
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['commercial-video'],
      targetNodeIds,
    },
    sourceIds: productSourceIds,
    decisions: [
      { key: 'category', value: category, source: 'workflow', scope: 'global', timestamp: now },
      { key: 'direction', value: direction, source: 'workflow', scope: 'global', timestamp: now },
      { key: 'voiceoverPolicy', value: 'native-in-video', source: 'workflow', scope: 'global', timestamp: now },
    ],
    stageOutline,
    stages: [initialStage],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

export function resolveAdTvcAnchors(
  productSourceIds: string[],
  needCharacter: boolean
): {
  reuseSources: string[];
  generateAnchors: Array<{ id: string; name: string; kind: 'product' | 'character' | 'environment' }>;
  requiresUserReview: boolean;
} {
  const reuseSources = [...productSourceIds];
  const generateAnchors: Array<{ id: string; name: string; kind: 'product' | 'character' | 'environment' }> = [];

  // If user provided product images, reuse them without generating new product anchors
  if (productSourceIds.length === 0) {
    generateAnchors.push({
      id: 'anchor-product',
      name: '产品核心视觉锚点',
      kind: 'product',
    });
  }

  if (needCharacter) {
    generateAnchors.push({
      id: 'anchor-model',
      name: '品牌形象模特锚点',
      kind: 'character',
    });
  }

  return {
    reuseSources,
    generateAnchors,
    // Only require user review if we actually generate new anchor images
    requiresUserReview: generateAnchors.length > 0,
  };
}

export function compileAdTvcUnitPrompt(input: {
  sceneDescription: string;
  techniqueIds?: string[];
  typography?: AdTvcTypographyPackage;
  nativeVoiceoverText?: string;
}): string {
  const parts: string[] = [input.sceneDescription.trim()];

  // Apply matched techniques
  if (input.techniqueIds && input.techniqueIds.length > 0) {
    for (const techId of input.techniqueIds) {
      const tech = AD_TVC_VISUAL_TECHNIQUES.find((t) => t.id === techId);
      if (tech) {
        parts.push(tech.promptDirective);
      }
    }
  }

  // Apply typography package
  if (input.typography) {
    const typoParts = [
      `Display typography: "${input.typography.displayPrimary}" in ${input.typography.textColor}`,
      input.typography.displaySecondary ? `secondary: "${input.typography.displaySecondary}"` : '',
      `tracking ${input.typography.letterSpacing}, animation: ${input.typography.motionStyle}`,
    ].filter(Boolean);
    parts.push(`Typography Package: [${typoParts.join(', ')}]`);
  }

  // Native voiceover directive
  if (input.nativeVoiceoverText) {
    parts.push(`Audio: [native voiceover spoken clearly: "${input.nativeVoiceoverText}", synchronized ambient sound, no external music]`);
  } else {
    parts.push('Audio: [native product audio and high-fidelity ambient Foley]');
  }

  const prompt = parts.join(', ');
  // Enforce TVC prompt <= 7000 chars
  return prompt.length > 7000 ? prompt.slice(0, 6997) + '...' : prompt;
}
