import { z } from 'zod';
import { type StageOutlineItem } from './productionPlan';

export const kocContentFormatSchema = z.enum([
  'on-camera',
  'hands-only',
  'product-only',
]);
export type KocContentFormat = z.infer<typeof kocContentFormatSchema>;

export const kocPlatformSchema = z.enum([
  'xiaohongshu',
  'douyin',
  'tiktok',
  'kuaishou',
  'general',
]);
export type KocPlatform = z.infer<typeof kocPlatformSchema>;

export interface KocHookCandidate {
  id: string;
  type: 'pain-contrast' | 'surprise-review' | 'comparison' | 'pitfall-warning' | 'immersive-unbox';
  title: string;
  hookOpening3s: string;
}

export interface KocPersonaCandidate {
  id: string;
  name: string;
  style: string;
  tagline: string;
}

export const KOC_DEFAULT_HOOK_TEMPLATES: KocHookCandidate[] = [
  { id: 'hook-1', type: 'pain-contrast', title: '痛点反差钩子', hookOpening3s: '千万别乱买！如果早点知道这个细节，我就不会白花冤枉钱了……' },
  { id: 'hook-2', type: 'surprise-review', title: '惊喜实测钩子', hookOpening3s: '实测 7 天！本来以为是智商税，结果用完直接被狠狠惊艳到了！' },
  { id: 'hook-3', type: 'comparison', title: '保姆级对比钩子', hookOpening3s: '同价位横评对比！到底哪个才是真正的性价比天花板？看这篇就够了！' },
  { id: 'hook-4', type: 'pitfall-warning', title: '避坑提醒钩子', hookOpening3s: '听劝！买之前先看这 3 点，90% 的人都踩过这个大坑！' },
  { id: 'hook-5', type: 'immersive-unbox', title: '沉浸开箱钩子', hookOpening3s: '嘘……沉浸式开箱！刚到手的新装备，第一视角撕膜体验有多爽？' },
];

export const KOC_DEFAULT_PERSONA_CANDIDATES: KocPersonaCandidate[] = [
  { id: 'persona-1', name: '理性硬核测评博主', style: '客观克制、数据说话、讲究成分与真实体验', tagline: '不吹不黑，只聊真实上手细节' },
  { id: 'persona-2', name: '手残党/普通人课代表', style: '亲切邻家、情绪饱满、代入真实生活困扰与解决喜悦', tagline: '我能学会的，大家肯定都能用好' },
  { id: 'persona-3', name: '挑剔品质生活家', style: '追求质感、细节控、注重审美与日常情绪价值', tagline: '真正提升生活幸福感的好物分享' },
];

export function buildKocStageOutline(options: {
  needAssets?: boolean;
  needPost?: boolean;
}): StageOutlineItem[] {
  const stages: StageOutlineItem[] = [
    { id: 'brief', order: 0, name: '提案简报' },
  ];

  let order = 1;
  if (options.needAssets) {
    stages.push({
      id: 'assets',
      order: order++,
      name: '博主与产品锚点',
      condition: '需生成创作者形象锚点或生活化产品锚点',
    });
  }

  stages.push({
    id: 'production',
    order: order++,
    name: '原生种草视频生成',
  });

  if (options.needPost) {
    stages.push({
      id: 'post',
      order: order++,
      name: '剪辑合成与收尾',
      condition: '多片段拼接、混入背景音乐或烧录字幕',
    });
  }

  return stages;
}
