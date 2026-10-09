import { describe, expect, it } from 'vitest';

import type { VideoCatalogEntry } from './videoModelCatalog';
import { buildVideoModeTabs, parseDreaminaVideoEntryId } from './videoModeTabs';

function entry(id: string, usable = true): VideoCatalogEntry {
  return {
    id,
    providerId: 'dreamina',
    providerLabel: '即梦 CLI',
    modelId: 'seedance2.0fast',
    modelLabel: 'seedance2.0fast',
    supportedDurations: ['5'],
    supportedResolutions: ['720p'],
    supportedAspectRatios: ['auto'],
    inputSchema: {
      images: { enabled: true, min: 0, max: 1, roles: ['firstFrame'], requireImageHost: false },
      video: { enabled: false, min: 0, max: 0, field: '' },
      audio: { enabled: false, min: 0, max: 0, field: '' },
    },
    usable,
  };
}

describe('parseDreaminaVideoEntryId', () => {
  it('splits the kind from the model id', () => {
    expect(parseDreaminaVideoEntryId('dreamina:all-reference-video:seedance2.0fast'))
      .toEqual({ kind: 'all-reference-video', model: 'seedance2.0fast' });
  });

  it('returns null for non-dreamina ids', () => {
    expect(parseDreaminaVideoEntryId('custom:provider-1:video-model')).toBeNull();
    expect(parseDreaminaVideoEntryId(undefined)).toBeNull();
  });
});

describe('buildVideoModeTabs', () => {
  const catalog = [
    entry('dreamina:text-video:seedance2.0fast'),
    entry('dreamina:image-video:seedance2.0fast'),
    entry('dreamina:frames-video:seedance2.0fast'),
    entry('dreamina:all-reference-video:seedance2.0fast'),
    entry('dreamina:image-video:seedance1.5pro'),
    entry('dreamina:text-video:seedance1.5pro', false),
  ];

  it('returns the four modes of the selected model, in order', () => {
    expect(buildVideoModeTabs(catalog, 'dreamina:image-video:seedance2.0fast').map((tab) => tab.kind))
      .toEqual(['text-video', 'image-video', 'frames-video', 'all-reference-video']);
  });

  it('only includes modes the selected model actually has, and skips unusable ones', () => {
    expect(buildVideoModeTabs(catalog, 'dreamina:image-video:seedance1.5pro').map((tab) => tab.kind))
      .toEqual(['image-video']);
  });

  it('returns no tabs for a non-dreamina entry', () => {
    expect(buildVideoModeTabs(catalog, 'custom:provider-1:video-model')).toEqual([]);
  });
});
