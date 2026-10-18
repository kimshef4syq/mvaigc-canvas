import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SkinSelector } from './SkinSelector';
import { SKIN_OPTIONS } from '@/features/theme/skinPresets';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'zh',
      changeLanguage: vi.fn(),
    },
  }),
}));

describe('SkinSelector', () => {
  it('renders skin trigger button with current skin details', () => {
    const html = renderToStaticMarkup(<SkinSelector />);
    expect(html).toContain('界面皮肤与风格选择');
    expect(html).toContain('新皮肤');
  });

  it('exposes all 4 skin presets with customized accents', () => {
    expect(SKIN_OPTIONS).toHaveLength(4);
    const ids = SKIN_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(['warm-amber', 'classic', 'cool-frost', 'sunset-glow']);
  });
});
