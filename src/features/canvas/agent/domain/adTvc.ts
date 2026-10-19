import { z } from 'zod';
import { type StageOutlineItem } from './productionPlan';

export const adTvcCategorySchema = z.enum([
  'appliance',
  'auto',
  'beauty',
  'fashion',
  'food',
  'tech',
]);
export type AdTvcCategory = z.infer<typeof adTvcCategorySchema>;

export const adTvcDirectionSchema = z.enum([
  'brand-ad',
  'product-ad',
  'story-ad',
  'viral-ad',
]);
export type AdTvcDirection = z.infer<typeof adTvcDirectionSchema>;

export interface AdTvcVisualTechnique {
  id: string; // T01 - T20
  name: string;
  summary: string;
  keywords: string[];
  promptDirective: string;
}

export const AD_TVC_VISUAL_TECHNIQUES: AdTvcVisualTechnique[] = [
  { id: 'T01', name: 'Glitch 热成像转场', summary: '热成像色彩分层与故障撕裂切入下一场景', keywords: ['热成像', 'glitch', '故障转场'], promptDirective: 'Thermal glitch transition, chromatic heat-map chromatic split, instantaneous digital scanline shift.' },
  { id: 'T02', name: 'Logo 多维叙事序列', summary: 'Logo 元素解构并融入光影空间', keywords: ['logo序列', 'logo叙事', '品牌标志解构'], promptDirective: 'Multi-dimensional brand mark integration, sculptural emblem interacting with directional volumetric shadows.' },
  { id: 'T03', name: '冷暖色温弧线叙事', summary: '从冷蓝沉静到温暖金光的色温叙事演进', keywords: ['冷暖色温', '色温弧线', '色彩演变'], promptDirective: 'Color temperature narrative arc, transition from clinical cyan blue tone to radiant 3200K golden hour sunlight.' },
  { id: 'T04', name: '闪黑碎片序章', summary: '高频闪黑微碎片镜头建立开场悬念', keywords: ['闪黑', '碎片序章', '黑场闪现'], promptDirective: 'Flash-to-black micro-fragment prologue, rapid rhythmic 3-frame darkness interruptions building anticipation.' },
  { id: 'T05', name: 'HUD 技术叠层', summary: '半透明参数微线条与工业 HUD 数据叠层', keywords: ['hud', '技术叠层', '工业参数', '数据层'], promptDirective: 'Minimalist technological HUD graphic overlay, hairline vectors, technical telemetry callouts, luminescent UI.' },
  { id: 'T06', name: '文案图形化排版', summary: '字体与版式作为画面骨骼参与视觉构图', keywords: ['字体排版', '文案排版', '图形化文字'], promptDirective: 'Architectural typography composition, giant Helvetica Swiss layout integrated seamlessly into physical architecture.' },
  { id: 'T07', name: '圣像光产品英雄镜头', summary: '顶级顶逆光圣像神圣感烘托产品核心质感', keywords: ['圣像光', '英雄镜头', 'hero shot', '逆光高光'], promptDirective: 'Hero product shot, divine rim backlighting, dramatic chiaroscuro contrast, majestic metallic sheen reflection.' },
  { id: 'T08', name: '黑白画面中的单点色彩', summary: '极简单色调中保留唯一的标志性色彩穿刺', keywords: ['单点色彩', '黑白单点', '色彩穿刺'], promptDirective: 'Monochrome black and white atmosphere with single vibrant signature color puncture, razor-sharp focus.' },
  { id: 'T09', name: '聚光灯孤立俯拍', summary: '纯黑背景下垂直 90 度聚光灯雕刻主体', keywords: ['聚光灯', '孤立俯拍', '顶光俯视'], promptDirective: 'Top-down 90-degree zenith view, isolated spotlight circle against pitch black void, tactile surface shadows.' },
  { id: 'T10', name: '微距质感蒙太奇', summary: '极致微距展现工业倒角、织物编织或液体流淌', keywords: ['微距', '质感蒙太奇', '材质微距'], promptDirective: 'Extreme macro texture montage, microscopic focus on brushed titanium chamfer, authentic light refractions.' },
  { id: 'T11', name: 'Logo 自发光激活', summary: '品牌标识内生微弱微光随后迸发流光', keywords: ['自发光', 'logo发光', '微光激活'], promptDirective: 'Internal electroluminescent logo activation, subtle pulsating core glow illuminating surrounding brushed surface.' },
  { id: 'T12', name: '高反差过曝冲击帧', summary: '瞬间过曝闪白切入高能运动高潮', keywords: ['过曝', '冲击帧', '闪白'], promptDirective: 'High-key momentary overexposure impact flash, blinding light blowout resolving into hyper-sharp dynamic movement.' },
  { id: 'T13', name: '碑文式宣言终帧', summary: '纪念碑般沉稳有力的静态终帧呈现口号', keywords: ['终帧', '宣言', '碑文终帧', 'end card'], promptDirective: 'Monumental manifesto end card, heavyweight centered typography, museum-grade composition, eternal stillness.' },
  { id: 'T14', name: '工业说明书式参数版面', summary: '硬核工业设计图纸线框与规格标注', keywords: ['工业说明书', '参数版面', '技术线框'], promptDirective: 'Industrial blueprint schematic layout, precision orthographic wireframe, calibrated dimensional lines.' },
  { id: 'T15', name: '抽象几何到产品形态蜕变', summary: '流体或极简几何形态平滑凝聚为产品实物', keywords: ['形态蜕变', '几何演变', '凝聚成形'], promptDirective: 'Morphing animation from pure abstract chrome geometry into real product silhouette, fluid metallic fusion.' },
  { id: 'T16', name: '液体声波与悬浮声学隐喻', summary: '微重力悬浮水珠随声波共振荡漾', keywords: ['声波', '水珠共振', '悬浮液体'], promptDirective: 'Acoustic ripple visualization, levitating liquid droplets vibrating in microgravity, cymatics frequency wave.' },
  { id: 'T17', name: '表里透视科技链', summary: 'X 射线透视外壳显露精密内部芯片与机械咬合', keywords: ['透视', '内部结构', '科技链', 'x射线'], promptDirective: 'Inside-out transparent exploded view, optical glass transparency revealing interlocking internal micro-mechanisms.' },
  { id: 'T18', name: '物理动力学卡点', summary: '机械部件咬合或水滴坠落与重音精准卡点', keywords: ['卡点', '动力学卡点', '物理卡点'], promptDirective: 'Kinetic physics beat synchronization, mechanical snap lock aligning with intense percussive audio impulse.' },
  { id: 'T19', name: '高速推进与速度感驾驶', summary: '极低机位贴地高速推进，动景模糊纵深', keywords: ['高速推进', '速度感', '贴地飞行'], promptDirective: 'Ultra-low ground clearance tracking shot, relentless forward velocity, kinetic motion blur streaks.' },
  { id: 'T20', name: '感官母题互译链', summary: '自然风声、丝绸拂过与产品触感通感互译', keywords: ['感官互译', '通感', '触感联想'], promptDirective: 'Synesthetic sensory translation chain, tactile silk ripple dissolving into aerodynamic cooling airflow.' },
];

export const adTvcTypographyPackageSchema = z.object({
  displayPrimary: z.string().min(1),
  displaySecondary: z.string().optional(),
  utilityText: z.string().optional(),
  brandMark: z.string().optional(),
  textColor: z.string().default('#FFFFFF'),
  letterSpacing: z.string().default('0.05em'),
  motionStyle: z.string().default('minimal-fade'),
});

export type AdTvcTypographyPackage = z.infer<typeof adTvcTypographyPackageSchema>;

export function buildAdTvcStageOutline(options: { hasBgm?: boolean } = {}): StageOutlineItem[] {
  const stages: StageOutlineItem[] = [
    { id: 'intake-brief', order: 0, name: '需求简报' },
    { id: 'visual-research', order: 1, name: '视觉调研' },
    { id: 'anchors', order: 2, name: '锚点' },
    { id: 'storyboard', order: 3, name: '分镜' },
    { id: 'visual-gen', order: 4, name: '视频生成' },
  ];

  let order = 5;
  if (options.hasBgm) {
    stages.push({
      id: 'audio',
      order: order++,
      name: '音乐',
      condition: '独立 BGM 准备',
    });
  }

  stages.push({
    id: 'post',
    order: order++,
    name: '后期',
  });

  return stages;
}

export function matchAdTvcTechniques(text: string): AdTvcVisualTechnique[] {
  const normalized = text.toLowerCase();
  const matched: AdTvcVisualTechnique[] = [];

  for (const tech of AD_TVC_VISUAL_TECHNIQUES) {
    if (
      normalized.includes(tech.id.toLowerCase()) ||
      normalized.includes(tech.name.toLowerCase()) ||
      tech.keywords.some((kw) => normalized.includes(kw.toLowerCase()))
    ) {
      matched.push(tech);
    }
  }

  return matched;
}
