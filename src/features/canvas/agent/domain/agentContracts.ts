import type { CanvasCommand } from '@/features/canvas/domain/canvasCommands';

/**
 * P199 / P200: Canvas Discipline and Baseline Contract
 */
export interface CanvasDisciplineViolation {
  code:
    | 'ALLOW_DUPLICATE_FORBIDDEN'
    | 'PLACEHOLDER_ID_FORBIDDEN'
    | 'REVISION_MISMATCH'
    | 'REDUNDANT_READ_FORBIDDEN';
  message: string;
}

const PLACEHOLDER_ID_REGEX = /^(?:<[^>]+>|placeholder|null|undefined|plan_id|node_id|stage_id|item_id)$/i;

export function validateCanvasDiscipline(
  command: CanvasCommand,
  context?: { currentRevision?: number; lastCreatedNodeId?: string },
): CanvasDisciplineViolation | null {
  // P199: Never use allowDuplicate: true on generation outputs
  if (command.type === 'generation.submit') {
    const input = command.input as Record<string, unknown>;
    if (input && input.allowDuplicate === true) {
      return {
        code: 'ALLOW_DUPLICATE_FORBIDDEN',
        message: 'Canvas baseline contract violation: generation outputs must never use allowDuplicate: true.',
      };
    }
  }

  // P199: Redundant read check - returning a canvas node id is completion proof,
  // do not call node.list right after a node creation to verify the same write.
  if (command.type === 'node.list' && context?.lastCreatedNodeId) {
    return {
      code: 'REDUNDANT_READ_FORBIDDEN',
      message: `Canvas baseline contract violation: redundant read call 'node.list' right after creating node '${context.lastCreatedNodeId}'. Returning node ID is completion proof.`,
    };
  }

  // P200: Guard against hallucinated, placeholder, or invalid IDs
  const input = command.input as Record<string, unknown> | undefined;
  if (input) {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && (key.endsWith('Id') || key === 'id')) {
        const trimmed = value.trim();
        if (trimmed === '' || PLACEHOLDER_ID_REGEX.test(trimmed)) {
          return {
            code: 'PLACEHOLDER_ID_FORBIDDEN',
            message: `Canvas discipline violation: invalid placeholder or empty ID '${value}' provided for field '${key}'.`,
          };
        }
      }
    }
  }

  return null;
}

/**
 * P202: Semantic Judgment Contract
 * Intent Priority:
 * 1. Explicit user instruction
 * 2. Active reference signals
 * 3. Approved project state
 * 4. Vendor / risk-card defaults
 * Lower priority NEVER overrides higher priority.
 */
export type SemanticPriorityLevel = 1 | 2 | 3 | 4;

export interface SemanticCandidate<T = unknown> {
  level: SemanticPriorityLevel;
  source: 'user_instruction' | 'active_reference' | 'approved_project_state' | 'vendor_risk_defaults';
  property: string;
  value: T;
}

export function resolveSemanticPriority<T>(
  candidates: SemanticCandidate<T>[],
): SemanticCandidate<T>[] {
  const propertyMap = new Map<string, SemanticCandidate<T>>();

  for (const candidate of candidates) {
    const existing = propertyMap.get(candidate.property);
    if (!existing || candidate.level < existing.level) {
      // Lower numerical level indicates higher priority (1 is highest)
      propertyMap.set(candidate.property, candidate);
    }
  }

  return Array.from(propertyMap.values()).sort((a, b) => a.level - b.level);
}

/**
 * P180 - P194: Failure Avoidance and Negative Risk Linter
 */
export interface FailureRiskWarning {
  topic: string;
  severity: 'warning' | 'enhancement';
  description: string;
  action: string;
}

export function lintFailureRisks(
  prompt: string,
  context?: { modality?: 'image' | 'video'; hasReference?: boolean },
): FailureRiskWarning[] {
  const warnings: FailureRiskWarning[] = [];
  const text = prompt.toLowerCase();

  // P180: anatomy-traps (hands, feet, fingers, close-up)
  if (/(?:手|手指|hands?|fingers?|feet|脚|特写|close-?up|portrait|肖像)/i.test(prompt)) {
    if (!/(?:five fingers|defined fingers|手指分明|五指齐全)/i.test(prompt)) {
      warnings.push({
        topic: 'anatomy-traps',
        severity: 'enhancement',
        description: 'Close-up or visible anatomy detected without finger/proportion constraints.',
        action: 'Include: "five clearly defined fingers, anatomically correct hand proportions, natural finger spacing". Avoid: extra or fused fingers.',
      });
    }
  }

  // P183: constraint-negation (negative constraints like "no cars", "不要...", "无...")
  const negativeMatch = /(?:不要|不能有|别出现|禁止|无|no\s+\w+|without\s+\w+|avoid\s+\w+)/i.exec(prompt);
  if (negativeMatch) {
    warnings.push({
      topic: 'constraint-negation',
      severity: 'warning',
      description: `Negative constraint phrasing "${negativeMatch[0]}" detected. Diffusion models often parse negative words as positive keywords.`,
      action: 'Rephrase negative requirements into affirmative composition statements (e.g. "a pristine empty street at dawn" instead of "no cars, no people").',
    });
  }

  // P181: brand-injection
  if (/(?:logo|brand|coca-cola|apple|nike|adidas|disney|标志|品牌商标)/i.test(prompt)) {
    warnings.push({
      topic: 'brand-injection',
      severity: 'warning',
      description: 'Potential brand, logo, or trademark reference detected.',
      action: 'Ensure brand/logo is explicitly requested by user; avoid unprompted trademark generation to prevent copyright drift.',
    });
  }

  // P192: plastic-skin
  if (/(?:photoreal|realistic portrait|写实肖像|逼真人像|美女人像)/i.test(prompt)) {
    if (!/(?:pores|subsurface|skin texture|细腻毛孔|自然皮肤肌理)/i.test(prompt)) {
      warnings.push({
        topic: 'plastic-skin',
        severity: 'enhancement',
        description: 'Photoreal portrait request may produce artificial, waxy, or plastic doll-like skin.',
        action: 'Add natural micro-texture, fine skin pores, subtle subsurface scattering, and natural facial asymmetry.',
      });
    }
  }

  // P193: spoken-video
  if (context?.modality === 'video' && /(?:speech|dialogue|singing|narration|口播|对白|说话|唱歌)/i.test(prompt)) {
    warnings.push({
      topic: 'spoken-video',
      severity: 'enhancement',
      description: 'Video requires audible speech, singing, or dialogue.',
      action: 'Route through native dialogue-in-video or synchronized audio pipeline rather than unsynced silent video generation.',
    });
  }

  // P194: webtoon-proportions
  if (/(?:webtoon|manga|anime|donghua|comic|条漫|日漫|国漫)/i.test(prompt)) {
    warnings.push({
      topic: 'webtoon-proportions',
      severity: 'enhancement',
      description: 'Stylized comic/webtoon format detected.',
      action: 'Maintain consistent stylized head-to-body ratios, line-weight hierarchy, and clean cel shading across serial panels.',
    });
  }

  return warnings;
}

/**
 * P137: Objective Design Quality Evaluator (design_score)
 */
export interface DesignScoreSpec {
  typography?: {
    hasClearHierarchy: boolean;
    safeMargins: boolean;
    fontContrastRatio: number; // e.g. 4.5 for WCAG AA
  };
  layout?: {
    elementCount: number;
    hasClutter: boolean;
    balancedSpacing: boolean;
  };
  timing?: {
    durationSeconds: number;
    beatSynced: boolean;
  };
}

export interface DesignScoreResult {
  score: number; // 0 - 100
  passed: boolean; // threshold >= 70
  rubrics: {
    typography: number; // max 35
    layout: number; // max 35
    timing: number; // max 30
  };
  issues: string[];
  recommendations: string[];
}

export function evaluateDesignScore(spec: DesignScoreSpec): DesignScoreResult {
  let typographyScore = 35;
  let layoutScore = 35;
  let timingScore = 30;
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Typography scoring (max 35)
  if (spec.typography) {
    if (!spec.typography.hasClearHierarchy) {
      typographyScore -= 12;
      issues.push('Typography lacks clear size/weight visual hierarchy.');
      recommendations.push('Establish a distinct scale: Title >= 2.0x body, Subtitle 1.4x body.');
    }
    if (!spec.typography.safeMargins) {
      typographyScore -= 10;
      issues.push('Text elements violate title-safe margins (min 5% margin from edges).');
      recommendations.push('Inset text at least 5% (54px on 1080p, 108px on 4K) from screen bounds.');
    }
    if (spec.typography.fontContrastRatio < 4.5) {
      typographyScore -= 13;
      issues.push(`Contrast ratio ${spec.typography.fontContrastRatio.toFixed(1)}:1 is below standard 4.5:1.`);
      recommendations.push('Increase luminance contrast between typography and background plate.');
    }
  }

  // Layout scoring (max 35)
  if (spec.layout) {
    if (spec.layout.hasClutter || spec.layout.elementCount > 8) {
      layoutScore -= 18;
      issues.push(`Visual overload: ${spec.layout.elementCount} elements detected in frame.`);
      recommendations.push('Apply subtraction aesthetics: limit simultaneous focal elements to <= 3.');
    }
    if (!spec.layout.balancedSpacing) {
      layoutScore -= 17;
      issues.push('Layout spacing is unbalanced with uneven negative space distribution.');
      recommendations.push('Preserve balanced negative space margins and optical alignment.');
    }
  }

  // Timing scoring (max 30)
  if (spec.timing) {
    if (spec.timing.durationSeconds < 2.0 || spec.timing.durationSeconds > 15.0) {
      timingScore -= 15;
      issues.push(`Clip duration ${spec.timing.durationSeconds}s outside standard bounds (2.0s - 15.0s).`);
      recommendations.push('Clamp clip durations between 2.0s and 15.0s for optimal viewer retention.');
    }
    if (!spec.timing.beatSynced) {
      timingScore -= 15;
      issues.push('Motion transitions and cuts do not synchronize with audio musical beats.');
      recommendations.push('Align cuts and keyframe accents to rhythmic musical downbeats.');
    }
  }

  const finalScore = Math.max(0, typographyScore + layoutScore + timingScore);
  const passed = finalScore >= 70;

  return {
    score: finalScore,
    passed,
    rubrics: {
      typography: Math.max(0, typographyScore),
      layout: Math.max(0, layoutScore),
      timing: Math.max(0, timingScore),
    },
    issues,
    recommendations,
  };
}
