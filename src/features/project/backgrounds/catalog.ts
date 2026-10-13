// Add a preset here and its motion in PixelBackground to extend the home gallery.
export const homeBackgrounds = [
  { id: 'assemble', labelKey: 'mainHome.backgroundAssemble', color: '#67b7d1' },
  { id: 'wave', labelKey: 'mainHome.backgroundWave', color: '#88baa2' },
  { id: 'orbit', labelKey: 'mainHome.backgroundOrbit', color: '#cfab78' },
  { id: 'none', labelKey: 'mainHome.backgroundNone', color: '#89919c' },
] as const;

export type HomeBackground = typeof homeBackgrounds[number]['id'];

export function isHomeBackground(value: unknown): value is HomeBackground {
  return homeBackgrounds.some((background) => background.id === value);
}
