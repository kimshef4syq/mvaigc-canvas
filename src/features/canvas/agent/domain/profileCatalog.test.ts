import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  filterProfilesByIntent,
  filterProfilesByModality,
  filterProfilesByPolicy,
  filterProfilesByStage,
  findProfileById,
  parseProfileCatalog,
  profileCatalogEntrySchema,
  resolveCanonicalProfile,
} from './profileCatalog';

const projectRoot = resolve(import.meta.dirname, '../../../../..');
const catalogPath = resolve(projectRoot, 'src/generated/profile-catalog.json');
const rawCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

describe('Profile Catalog Domain & Schema', () => {
  it('parses and validates all 202 entries in the generated catalog', () => {
    const catalog = parseProfileCatalog(rawCatalog);
    expect(catalog).toHaveLength(202);

    const categories = new Set(catalog.map((entry) => entry.category));
    expect(categories.size).toBeGreaterThanOrEqual(9);
    expect(categories.has('01-Agents-智能体人设与编排')).toBe(true);
    expect(categories.has('02-Vendors-模型生成提示词与参数')).toBe(true);
    expect(categories.has('03-DramaSeries-短剧微电影完整流程')).toBe(true);
    expect(categories.has('04-AdTVC-商业广告与品牌大片流程')).toBe(true);
    expect(categories.has('05-MV-音乐卡点与歌词视频流程')).toBe(true);
    expect(categories.has('06-GeneralVideo-通用视频制作流程')).toBe(true);
    expect(categories.has('06-KOC-带货与口播种草流程')).toBe(true);
    expect(categories.has('07-SharedPipelines-共享资产与后期管线')).toBe(true);
    expect(categories.has('08-Failures-防翻车与负向避坑知识库')).toBe(true);
    expect(categories.has('09-Contracts-画布纪律与语义契约')).toBe(true);
  });

  it('rejects entries with invalid fields or missing required properties', () => {
    const invalidEntry = {
      id: 'test/invalid',
      sourcePath: 'resources/agent-profiles/test.md',
      title: 'Invalid',
      category: '01-Agents',
      kind: 'unknown-kind', // invalid enum
      sourceHash: 'abc', // invalid length
      utf8Bytes: -1, // invalid negative
      characterCount: 10,
      activation: { intents: [], stages: [], modalities: [], exclusions: [] },
      dependencies: [],
      originalTools: [],
      requiredCapabilities: [],
      runtimePolicy: 'on-demand',
      coverage: { knowledge: 'pending', execution: 'pending', evidenceIds: [] },
    };

    const result = profileCatalogEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it('finds existing profiles by id and returns undefined for missing ids', () => {
    const catalog = parseProfileCatalog(rawCatalog);
    const mediaAgent = findProfileById(catalog, '01-Agents-智能体人设与编排/media-agent');
    expect(mediaAgent).toBeDefined();
    expect(mediaAgent?.kind).toBe('role');
    expect(mediaAgent?.runtimePolicy).toBe('on-demand');

    const missing = findProfileById(catalog, 'non-existent-profile');
    expect(missing).toBeUndefined();
  });

  it('resolves canonical profile for versioned or alias entries', () => {
    const catalog = parseProfileCatalog(rawCatalog);

    // v3 banana resolves to canonical banana
    const canonicalBanana = resolveCanonicalProfile(
      catalog,
      '02-Vendors-模型生成提示词与参数/v3/banana'
    );
    expect(canonicalBanana).toBeDefined();
    expect(canonicalBanana?.id).toBe('02-Vendors-模型生成提示词与参数/banana');

    // canonical banana resolves to itself
    const selfResolved = resolveCanonicalProfile(
      catalog,
      '02-Vendors-模型生成提示词与参数/banana'
    );
    expect(selfResolved?.id).toBe('02-Vendors-模型生成提示词与参数/banana');

    // seed-audio resolves to seedaudio
    const seedAudioCanonical = resolveCanonicalProfile(
      catalog,
      '02-Vendors-模型生成提示词与参数/seed-audio'
    );
    expect(seedAudioCanonical?.id).toBe('02-Vendors-模型生成提示词与参数/seedaudio');
  });

  it('filters profiles by intent, stage, modality, and runtime policy', () => {
    const catalog = parseProfileCatalog(rawCatalog);

    const dramaProfiles = filterProfilesByIntent(catalog, 'drama-series');
    expect(dramaProfiles.length).toBeGreaterThan(0);

    const commercialStages = filterProfilesByStage(catalog, 'commercial-production');
    expect(commercialStages.length).toBeGreaterThan(0);

    const videoProfiles = filterProfilesByModality(catalog, 'video');
    expect(videoProfiles.length).toBeGreaterThan(0);

    const alwaysOnContracts = filterProfilesByPolicy(catalog, 'always-on');
    expect(alwaysOnContracts.length).toBeGreaterThan(0);
    expect(
      alwaysOnContracts.some((entry) => entry.id.includes('canvas-discipline'))
    ).toBe(true);

    const indexOnly = filterProfilesByPolicy(catalog, 'index-only');
    expect(indexOnly.length).toBeGreaterThan(0);
  });
});
