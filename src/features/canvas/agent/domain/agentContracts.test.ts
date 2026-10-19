import { describe, expect, it } from 'vitest';
import type { CanvasCommand } from '@/features/canvas/domain/canvasCommands';
import {
  evaluateDesignScore,
  lintFailureRisks,
  resolveSemanticPriority,
  validateCanvasDiscipline,
} from './agentContracts';

describe('validateCanvasDiscipline (P199 / P200)', () => {
  it('forbids allowDuplicate: true on generation.submit (P199)', () => {
    const cmd: CanvasCommand = {
      type: 'generation.submit',
      version: 1,
      input: { nodeIds: ['node-1'], allowDuplicate: true },
    } as unknown as CanvasCommand;

    const violation = validateCanvasDiscipline(cmd);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('ALLOW_DUPLICATE_FORBIDDEN');
  });

  it('permits valid generation.submit without allowDuplicate', () => {
    const cmd: CanvasCommand = {
      type: 'generation.submit',
      version: 1,
      input: { nodeIds: ['node-1'] },
    } as unknown as CanvasCommand;

    const violation = validateCanvasDiscipline(cmd);
    expect(violation).toBeNull();
  });

  it('forbids redundant node.list right after node creation (P199)', () => {
    const cmd: CanvasCommand = {
      type: 'node.list',
      version: 1,
      input: {},
    } as unknown as CanvasCommand;

    const violation = validateCanvasDiscipline(cmd, { lastCreatedNodeId: 'node-abc' });
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('REDUNDANT_READ_FORBIDDEN');
  });

  it('forbids placeholder and empty IDs in command inputs (P200)', () => {
    const cmd: CanvasCommand = {
      type: 'node.get',
      version: 1,
      input: { id: '<plan_id>' },
    } as unknown as CanvasCommand;

    const violation = validateCanvasDiscipline(cmd);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('PLACEHOLDER_ID_FORBIDDEN');
  });

  it('accepts legitimate real IDs', () => {
    const cmd: CanvasCommand = {
      type: 'node.get',
      version: 1,
      input: { id: 'node-real-uuid-1234' },
    } as unknown as CanvasCommand;

    const violation = validateCanvasDiscipline(cmd);
    expect(violation).toBeNull();
  });
});

describe('resolveSemanticPriority (P202)', () => {
  it('enforces that higher priority levels override lower ones', () => {
    const candidates = [
      { level: 4 as const, source: 'vendor_risk_defaults' as const, property: 'ratio', value: '16:9' },
      { level: 1 as const, source: 'user_instruction' as const, property: 'ratio', value: '9:16' },
      { level: 2 as const, source: 'active_reference' as const, property: 'character_costume', value: 'cyberpunk trench coat' },
      { level: 3 as const, source: 'approved_project_state' as const, property: 'character_costume', value: 'casual hoodie' },
    ];

    const resolved = resolveSemanticPriority(candidates);
    const ratio = resolved.find((c) => c.property === 'ratio');
    const costume = resolved.find((c) => c.property === 'character_costume');

    expect(ratio?.value).toBe('9:16');
    expect(ratio?.source).toBe('user_instruction');

    // active_reference (level 2) overrides approved_project_state (level 3)
    expect(costume?.value).toBe('cyberpunk trench coat');
    expect(costume?.source).toBe('active_reference');
  });
});

describe('lintFailureRisks (P180 - P194)', () => {
  it('warns about close-up hands without anatomical finger constraints (P180)', () => {
    const warnings = lintFailureRisks('特写镜头：少女伸手接过花朵');
    expect(warnings.some((w) => w.topic === 'anatomy-traps')).toBe(true);
  });

  it('flags negative phrasing and advises affirmative alternative (P183)', () => {
    const warnings = lintFailureRisks('A cityscape with no cars and without pedestrians');
    expect(warnings.some((w) => w.topic === 'constraint-negation')).toBe(true);
  });

  it('flags potential unprompted brand name injection (P181)', () => {
    const warnings = lintFailureRisks('A modern store with Nike logo on the wall');
    expect(warnings.some((w) => w.topic === 'brand-injection')).toBe(true);
  });

  it('advises skin pores and micro-texture on photoreal portrait requests (P192)', () => {
    const warnings = lintFailureRisks('超逼真人像写真，极简背景');
    expect(warnings.some((w) => w.topic === 'plastic-skin')).toBe(true);
  });

  it('identifies spoken video audio pipeline requirement (P193)', () => {
    const warnings = lintFailureRisks('主角激动地对着镜头说话，情绪爆发', { modality: 'video' });
    expect(warnings.some((w) => w.topic === 'spoken-video')).toBe(true);
  });

  it('warns on webtoon/comic proportions (P194)', () => {
    const warnings = lintFailureRisks('日漫风格连载短剧条漫分镜');
    expect(warnings.some((w) => w.topic === 'webtoon-proportions')).toBe(true);
  });
});

describe('evaluateDesignScore (P137)', () => {
  it('scores high and passes for compliant layout, typography, and timing', () => {
    const result = evaluateDesignScore({
      typography: { hasClearHierarchy: true, safeMargins: true, fontContrastRatio: 5.5 },
      layout: { elementCount: 4, hasClutter: false, balancedSpacing: true },
      timing: { durationSeconds: 6.0, beatSynced: true },
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it('fails and outputs actionable recommendations when thresholds are violated', () => {
    const result = evaluateDesignScore({
      typography: { hasClearHierarchy: false, safeMargins: false, fontContrastRatio: 2.1 },
      layout: { elementCount: 12, hasClutter: true, balancedSpacing: false },
      timing: { durationSeconds: 22.0, beatSynced: false },
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(70);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});
