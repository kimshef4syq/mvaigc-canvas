import { describe, expect, it } from 'vitest';
import {
  AD_TVC_VISUAL_TECHNIQUES,
  matchAdTvcTechniques,
} from '../domain/adTvc';
import {
  createAdTvcPlan,
  detectAdTvcCategory,
  detectAdTvcDirection,
  resolveAdTvcAnchors,
  compileAdTvcUnitPrompt,
} from './adTvcWorkflow';

describe('Ad TVC Workflow Application Service (T13)', () => {
  describe('Category & Direction Resolution', () => {
    it('detects auto category and product direction for car commercial', () => {
      const category = detectAdTvcCategory('制作一支新款豪华电动跑车 30 秒 TVC');
      const direction = detectAdTvcDirection('制作一支新款豪华电动跑车 30 秒 TVC');
      expect(category).toBe('auto');
      expect(direction).toBe('product-ad');

      const plan = createAdTvcPlan({
        projectId: 'proj-1',
        prompt: '制作一支新款豪华电动跑车 30 秒 TVC',
      });
      expect(plan.workflow.variant).toBe('auto:product-ad');
    });

    it('detects beauty category and brand direction for cosmetics brand film', () => {
      const category = detectAdTvcCategory('高端护肤精华新品上市品牌片大片');
      const direction = detectAdTvcDirection('高端护肤精华新品上市品牌片大片');
      expect(category).toBe('beauty');
      expect(direction).toBe('brand-ad');

      const plan = createAdTvcPlan({
        projectId: 'proj-1',
        prompt: '高端护肤精华新品上市品牌片大片',
      });
      expect(plan.workflow.variant).toBe('beauty:brand-ad');
    });
  });

  describe('Anchor Resolution & Review Gate Rules', () => {
    it('reuses existing product source images and skips anchor review if no new images generated', () => {
      const resolved = resolveAdTvcAnchors(['source-product-photo-1.png'], false);
      expect(resolved.reuseSources).toEqual(['source-product-photo-1.png']);
      expect(resolved.generateAnchors).toHaveLength(0);
      expect(resolved.requiresUserReview).toBe(false); // No review when purely reusing sources!
    });

    it('generates product anchor and requires review when user provides no product images', () => {
      const resolved = resolveAdTvcAnchors([], true);
      expect(resolved.reuseSources).toHaveLength(0);
      expect(resolved.generateAnchors.map((a) => a.kind)).toContain('product');
      expect(resolved.generateAnchors.map((a) => a.kind)).toContain('character');
      expect(resolved.requiresUserReview).toBe(true); // Must review newly generated anchors!
    });
  });

  describe('20 Visual Techniques & Typography Package Compilation', () => {
    it('catalogs all 20 visual techniques (T01 - T20) and matches them', () => {
      expect(AD_TVC_VISUAL_TECHNIQUES).toHaveLength(20);

      const matched = matchAdTvcTechniques('使用圣像光产品英雄镜头配合微距质感蒙太奇');
      expect(matched.map((m) => m.id)).toContain('T07');
      expect(matched.map((m) => m.id)).toContain('T10');
    });

    it('compiles prompt with techniques, typography package, and native voiceover', () => {
      const prompt = compileAdTvcUnitPrompt({
        sceneDescription: 'A sleek titanium smartwatch rotating in zero gravity',
        techniqueIds: ['T07', 'T14'],
        typography: {
          displayPrimary: 'THE FUTURE OF TIME',
          displaySecondary: 'TITANIUM EDITION',
          textColor: '#FFFFFF',
          letterSpacing: '0.1em',
          motionStyle: 'minimal-fade',
        },
        nativeVoiceoverText: 'Precision engineered for the uncharted.',
      });

      expect(prompt).toContain('Hero product shot, divine rim backlighting');
      expect(prompt).toContain('Industrial blueprint schematic layout');
      expect(prompt).toContain('Display typography: "THE FUTURE OF TIME"');
      expect(prompt).toContain('Audio: [native voiceover spoken clearly: "Precision engineered for the uncharted."');
      expect(prompt.length).toBeLessThanOrEqual(7000);
    });
  });
});
