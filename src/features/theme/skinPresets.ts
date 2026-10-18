export type SkinPreset = 'warm-amber' | 'classic' | 'cool-frost' | 'sunset-glow';

export interface SkinOption {
  id: SkinPreset;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  accent: string;
  swatches: [string, string, string];
}

export const SKIN_OPTIONS: SkinOption[] = [
  {
    id: 'warm-amber',
    name: '新皮肤',
    nameEn: 'Obsidian Amber',
    desc: '黑曜琥珀 · 冷暖对撞',
    descEn: 'Obsidian espresso with warm amber caustics & cool rim contrast',
    accent: '#f59e0b',
    swatches: ['#0c0906', '#f59e0b', '#6366f1'],
  },
  {
    id: 'classic',
    name: '原始皮肤',
    nameEn: 'Classic Slate',
    desc: '原版中性 · 经典黑灰',
    descEn: 'Original neutral dark slate with crisp blue accents',
    accent: '#3b82f6',
    swatches: ['#0f0f0f', '#3b82f6', '#94a3b8'],
  },
  {
    id: 'cool-frost',
    name: '极光冷蓝',
    nameEn: 'Glacial Aurora',
    desc: '深海冰青 · 极客冷调',
    descEn: 'Deep glacial cyan with electric sapphire atmospheric glow',
    accent: '#06b6d4',
    swatches: ['#060b13', '#06b6d4', '#38bdf8'],
  },
  {
    id: 'sunset-glow',
    name: '落日熔金',
    nameEn: 'Sunset Crimson',
    desc: '晚霞赤绯 · 浓郁暖金',
    descEn: 'Sunset crimson and molten gold with fiery warmth',
    accent: '#f97316',
    swatches: ['#120708', '#f97316', '#fb7185'],
  },
];
