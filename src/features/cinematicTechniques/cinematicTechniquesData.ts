import bundled from './bundledCinematicTechniques.json';

export interface CinematicTechnique {
  id: string;
  slug: string;
  name: string;
  poster: string;
  video: string | null;
  still: string | null;
  prompt: string | null;
  definition: string | null;
}

export interface CinematicCategory {
  id: string;
  name: string;
  items: CinematicTechnique[];
}

interface CinematicTechniquesBundle {
  generatedAt: string;
  source: string;
  categories: CinematicCategory[];
}

export const CINEMATIC_CATEGORIES: CinematicCategory[] =
  (bundled as CinematicTechniquesBundle).categories;

export const CINEMATIC_TECHNIQUE_COUNT = CINEMATIC_CATEGORIES.reduce(
  (sum, category) => sum + category.items.length,
  0
);

export function filterCinematicCategories(
  categories: CinematicCategory[],
  query: string,
  activeCategoryId: string | null
): CinematicCategory[] {
  const scoped = activeCategoryId
    ? categories.filter((category) => category.id === activeCategoryId)
    : categories;

  const needle = query.trim().toLowerCase();
  if (!needle) {
    return scoped;
  }

  return scoped
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        return (
          item.name.toLowerCase().includes(needle)
          || (item.prompt ?? '').toLowerCase().includes(needle)
          || (item.definition ?? '').toLowerCase().includes(needle)
        );
      }),
    }))
    .filter((category) => category.items.length > 0);
}
