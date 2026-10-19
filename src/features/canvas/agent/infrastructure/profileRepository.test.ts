import { describe, expect, it } from 'vitest';

import {
  getProfileCatalog,
  getProfileEntry,
  readProfile,
  resolveLegacyProfileReference,
  searchProfiles,
} from './profileRepository';

describe('Profile Repository Infrastructure', () => {
  it('retrieves full catalog and individual entries', () => {
    const catalog = getProfileCatalog();
    expect(catalog).toHaveLength(202);

    const entry = getProfileEntry('01-Agents-智能体人设与编排/media-agent');
    expect(entry).toBeDefined();
    expect(entry?.title).toBe('Role');
    expect(entry?.sourceHash).toHaveLength(64);
  });

  describe('searchProfiles', () => {
    it('defaults to 8 items with pagination support', () => {
      const page1 = searchProfiles();
      expect(page1.items).toHaveLength(8);
      expect(page1.total).toBe(202);
      expect(page1.nextCursor).toBe('8');

      const page2 = searchProfiles({ cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(8);
      expect(page2.nextCursor).toBe('16');
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('clamps limit between 1 and 20', () => {
      const clampedHigh = searchProfiles({ limit: 100 });
      expect(clampedHigh.items).toHaveLength(20);

      const clampedLow = searchProfiles({ limit: 0 });
      expect(clampedLow.items).toHaveLength(1);
    });

    it('filters by query across id, title, and intents', () => {
      const results = searchProfiles({ query: 'kling' });
      expect(results.total).toBeGreaterThan(0);
      expect(results.items.some((item) => item.id.includes('kling'))).toBe(true);
    });

    it('filters by kind and runtime policy', () => {
      const roles = searchProfiles({ kind: 'role' });
      expect(roles.total).toBeGreaterThanOrEqual(6);
      expect(roles.items.every((item) => item.kind === 'role')).toBe(true);

      const workflows = searchProfiles({ kind: 'workflow' });
      expect(workflows.total).toBeGreaterThan(0);
      expect(workflows.items.every((item) => item.kind === 'workflow')).toBe(true);
    });

    it('filters by intent, stage, and modality', () => {
      const drama = searchProfiles({ intent: 'drama-series' });
      expect(drama.total).toBeGreaterThanOrEqual(10);

      const video = searchProfiles({ modality: 'video' });
      expect(video.total).toBeGreaterThan(0);
    });
  });

  describe('readProfile', () => {
    it('reads a registered profile with correct metadata, hash, and content', async () => {
      const result = await readProfile({
        id: '01-Agents-智能体人设与编排/media-agent',
      });

      expect(result.id).toBe('01-Agents-智能体人设与编排/media-agent');
      expect(result.sourceHash).toHaveLength(64);
      expect(result.totalCharacters).toBeGreaterThan(0);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.cursor).toBe(0);
    });

    it('supports chunked pagination with cursor and character limits', async () => {
      const chunk1 = await readProfile({
        id: '01-Agents-智能体人设与编排/media-agent',
        cursor: 0,
        limitCharacters: 200,
      });

      expect(chunk1.content.length).toBe(200);
      expect(chunk1.nextCursor).toBe(200);
      expect(chunk1.isEof).toBe(false);

      const chunk2 = await readProfile({
        id: '01-Agents-智能体人设与编排/media-agent',
        cursor: 200,
        limitCharacters: 200,
      });

      expect(chunk2.content.length).toBe(200);
      expect(chunk2.cursor).toBe(200);
      expect(chunk1.content).not.toBe(chunk2.content);
    });

    it('validates revision hash when specified', async () => {
      const entry = getProfileEntry('01-Agents-智能体人设与编排/media-agent')!;

      // Matching prefix succeeds
      const valid = await readProfile({
        id: '01-Agents-智能体人设与编排/media-agent',
        revision: entry.sourceHash.slice(0, 8),
      });
      expect(valid.sourceHash).toBe(entry.sourceHash);

      // Mismatched revision throws error
      await expect(
        readProfile({
          id: '01-Agents-智能体人设与编排/media-agent',
          revision: 'invalid_sha256_prefix',
        })
      ).rejects.toThrow('Profile revision mismatch');
    });

    it('throws error for non-whitelisted profile ids', async () => {
      await expect(
        readProfile({
          id: '../../../etc/passwd',
        })
      ).rejects.toThrow('Profile not found in catalog');
    });
  });

  describe('resolveLegacyProfileReference', () => {
    it('resolves <workflowsDir>/drama-series/... legacy path to catalog ID', () => {
      const res = resolveLegacyProfileReference('<workflowsDir>/drama-series/01-Stage-Plan.md');
      expect(res.resolved).toBe(true);
      expect(res.catalogId).toBe('03-DramaSeries-短剧微电影完整流程/reference/production-plan');
    });

    it('resolves vendors/... legacy path to vendor profile in 02-Vendors', () => {
      const res = resolveLegacyProfileReference('vendors/01-MiniMax-Hailuo-T2V-Directives.md');
      expect(res.resolved).toBe(true);
      expect(res.catalogId).toBe('02-Vendors-模型生成提示词与参数/minimax');
    });

    it('reports failure with reason for non-existent legacy references', () => {
      const res = resolveLegacyProfileReference('unknown/non-existent-template.md');
      expect(res.resolved).toBe(false);
      expect(res.reason).toContain('未能在语义目录中找到');
    });
  });
});

