import { describe, expect, it } from 'vitest';
import {
  CINEMATIC_CATEGORIES,
  CINEMATIC_TECHNIQUE_COUNT,
  filterCinematicCategories,
} from './cinematicTechniquesData';

const ORIGINAL_CATEGORY_IDS = [
  'camera-movement',
  'framing',
  'camera-angles',
  'lighting',
  'composition',
  'lenses',
  'color',
  'time-and-motion',
  'effects',
  'editing',
  'atmosphere',
  'genre-looks',
  'viral-looks',
];

describe('cinematic techniques data', () => {
  it('keeps the 13 original categories in the site order', () => {
    expect(CINEMATIC_CATEGORIES.map((category) => category.id)).toEqual(ORIGINAL_CATEGORY_IDS);
  });

  it('bundles all 424 techniques', () => {
    expect(CINEMATIC_TECHNIQUE_COUNT).toBe(424);
    expect(CINEMATIC_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0)).toBe(424);
  });

  it('gives every technique a name, poster, prompt and at least one media asset', () => {
    const techniques = CINEMATIC_CATEGORIES.flatMap((category) => category.items);
    for (const technique of techniques) {
      expect(technique.name.trim().length).toBeGreaterThan(0);
      expect(technique.poster).toMatch(/^https:\/\//);
      expect((technique.prompt ?? '').trim().length).toBeGreaterThan(0);
      expect(Boolean(technique.video || technique.still)).toBe(true);
    }
  });
});

describe('filterCinematicCategories', () => {
  it('returns every category when there is no query or category filter', () => {
    expect(filterCinematicCategories(CINEMATIC_CATEGORIES, '', null)).toHaveLength(13);
  });

  it('scopes to a single category', () => {
    const result = filterCinematicCategories(CINEMATIC_CATEGORIES, '', 'lighting');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('lighting');
    expect(result[0].items).toHaveLength(41);
  });

  it('matches names case-insensitively and drops empty categories', () => {
    const result = filterCinematicCategories(CINEMATIC_CATEGORIES, 'dolly zoom', null);
    const names = result.flatMap((category) => category.items.map((item) => item.name));
    expect(names).toContain('Dolly Zoom');
    for (const category of result) {
      expect(category.items.length).toBeGreaterThan(0);
    }
  });

  it('returns nothing when no technique matches', () => {
    expect(filterCinematicCategories(CINEMATIC_CATEGORIES, 'zzzz-no-match', null)).toEqual([]);
  });
});
