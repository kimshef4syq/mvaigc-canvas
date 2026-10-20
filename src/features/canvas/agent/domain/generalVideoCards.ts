import { z } from 'zod';
import { type StageOutlineItem } from './productionPlan';

export const generalVideoDriverSchema = z.enum([
  'narrative',
  'speech',
  'on-camera',
]);

export type GeneralVideoDriver = z.infer<typeof generalVideoDriverSchema>;

export interface GeneralVideoMethodCard {
  id: string;
  name: string;
  category:
    | 'asset'
    | 'directing'
    | 'editing'
    | 'qc'
    | 'screenwriting'
    | 'sound'
    | 'visual-aesthetics'
    | 'text-animation';
  profileId: string;
  summary: string;
  keywords: string[];
  rules: string[];
  promptDirective?: string;
}

export const TEXT_ANIMATION_STYLES = [
  { id: 'typewriter', name: '打字机效果', description: '字形逐字快速打印，光标微闪，伴随轻微机械停顿' },
  { id: 'kinetic-slam', name: '动感冲击', description: '高加速度自深处撞击屏幕中央，带有轻微镜头震颤' },
  { id: 'blur-reveal', name: '高斯模糊渐现', description: '从大半径高斯虚焦中随景深迅速清晰显现' },
  { id: 'neon-flicker', name: '赛博霓虹闪烁', description: '管状发光字体带有微电流震颤和阶段性短路重燃' },
  { id: 'split-drop', name: '上下字符切分', description: '字符自上下两极错位咬合拼合，边缘锐利' },
  { id: 'glitch-slice', name: '故障切片', description: 'RGB 色散分层水平撕裂位移，瞬态电子噪点' },
  { id: 'wave-cascade', name: '波浪级联', description: '字符按正弦波位相依次起伏入场，动作柔顺连贯' },
  { id: 'gradient-sweep', name: '渐变扫光', description: '金属光泽或高反差色带从左至右斜向掠过文字表面' },
  { id: '3d-rotate', name: '空间立体翻转', description: '沿 Y/X 轴进行 3D 透视翻转入场，带有纵深投影' },
  { id: 'elastic-bounce', name: '弹性回弹', description: '带物理阻尼的过冲回弹动画，极具生动张力' },
  { id: 'shadow-pop', name: '阴影骤现', description: '实体字与多层硬边阴影分离错位弹跳' },
  { id: 'minimal-fade', name: '极简微浮现', description: '低透明度至 100% 极微位移优雅淡入，纯粹克制' },
  { id: 'cinematic-tracking', name: '电影宽幅字距展开', description: '缓慢匀速拉开字间距，配合电影宽银幕质感' },
  { id: 'staggered-slide', name: '错落滑入', description: '多行文字按时差阶梯式滑入并精准停靠' },
  { id: 'mask-reveal', name: '几何遮罩展露', description: '通过直线或圆形几何遮罩擦除展露文字' },
  { id: 'counter-roll', name: '滚轮翻页', description: '数字或字母如机械计价器般高速滚动锁定' },
  { id: 'ribbon-unfold', name: '丝带展开', description: '如同织物或柔性光带展开呈现文字' },
  { id: 'stroke-draw', name: '笔触勾勒', description: '矢量文字描边自起点顺畅手绘生成随后填充' },
  { id: 'glitch-shake', name: '颤动抽帧', description: '高频偶发抽帧与位置抖动，营造不稳定现场感' },
  { id: 'stamp-impact', name: '印章砸落', description: '自大比例瞬间按压砸落并留存微弱印泥肌理' },
  { id: 'shimmer-sparkle', name: '星芒闪烁', description: '高光部位点缀微小十字星芒辉光' },
  { id: 'flip-card', name: '翻牌翻转', description: '双面翻牌机械转动切换信息' },
  { id: 'smoke-disperse', name: '烟雾消散', description: '字符边缘溶解为微粒烟雾随气流飘散' },
  { id: 'perspective-tilt', name: '透视倾斜推进', description: '倾斜低机位仰视快速推近，增强空间压迫感' },
] as const;

export const GENERAL_VIDEO_METHOD_CARDS: GeneralVideoMethodCard[] = [
  {
    id: 'photoreal-skin',
    name: '真人写实质感',
    category: 'directing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/directing/photoreal-skin',
    summary: '真实人类皮肤质感、毛孔细节、伦勃朗微光，严禁塑料娃娃与过度磨皮',
    keywords: ['皮肤', '写实', '质感', '真人质感', '真实皮肤', '真实质感', 'photoreal'],
    rules: [
      '严禁使用塑料感平滑高光或过度磨皮滤镜',
      '保留皮肤自然肌理、细微毛孔、血管冷暖对比与微表情微颤',
      '运用伦勃朗光或自然侧逆光展现面部轮廓深度',
    ],
    promptDirective: 'Photoreal human skin texture, visible natural pores and fine micro-imperfections, authentic subcutaneous light scattering, Rembrandt directional lighting, subtle facial muscle micro-movement, no plastic oversmoothing, 8k resolution cinematic raw capture.',
  },
  {
    id: 'minimax-h3-shortgroup',
    name: '连续镜头组与景别跃迁',
    category: 'directing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/directing/minimax-h3-shortgroup',
    summary: '以动作连续性为第一优先级组织镜头组；同主体相邻镜头至少跨一个景别，机位角度差在 30° 至 90°',
    keywords: ['镜头组', '分镜组', '景别', '机位角度', '相邻镜头', '运镜', '短镜头'],
    rules: [
      '同主体相邻镜头必须跨越至少一个景别等级（例如从中景直接跃迁到近景/特写），严禁微小机位蠕动',
      '相邻镜头视角变化必须落在 30° 到 90° 之间，保证切点视觉冲击与空间连续性',
      '强化情绪或重要信息时，优先使用近景或特写',
    ],
    promptDirective: 'Continuity-first multi-beat clip: camera shot transitions from medium establishing to intense close-up, perspective delta 45 degrees, preserving strict character action continuity across beats.',
  },
  {
    id: 'dramatic-pause',
    name: '戏剧性停顿',
    category: 'editing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/editing/dramatic-pause',
    summary: '通过关键画面的节制留白、近静默或微定格，为观众创造信息消化与情绪沉淀空间',
    keywords: ['戏剧性停顿', '停顿', '留白', '呼吸感', '沉淀', '定格', '静默'],
    rules: [
      '在叙事转折、重大揭露或高能动作后设置 0.5 到 1.5 秒的情绪留白',
      '利用微定格、呼吸停顿或环境近静默强化情节分量',
      '严禁紧密无缝堆砌内容导致观众信息过载',
    ],
    promptDirective: 'Dramatic pause: deliberate cinematic silence and sustained micro-reaction beat, allowing emotional tension to linger before next cut.',
  },
  {
    id: 'transition-decision-tree',
    name: '转场决策树',
    category: 'editing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/editing/transition-decision-tree',
    summary: '严格根据时空连续性、因果关系与视觉母题决定硬切、匹配剪辑、叠化或声音桥',
    keywords: ['转场', '剪辑转场', '匹配剪辑', '叠化', '声音桥', '硬切'],
    rules: [
      '同场景连续动作优先采用硬切或动作匹配剪辑',
      '跨越时空与主观回忆使用淡入淡出或柔和叠化',
      '利用声音先行（J-cut）或音效延续（L-cut）建立听觉纽带',
    ],
  },
  {
    id: 'duration-reconciliation',
    name: '实测时长对齐',
    category: 'editing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/editing/duration-reconciliation',
    summary: '以最终主音频/实测旁白时长为绝对时间权威，动态调整视觉画面切点与节奏',
    keywords: ['时长对齐', '对齐时长', '旁白时长', '音乐对齐', '音画同步'],
    rules: [
      '实测音频生成结果是下游视觉时长的唯一权威标准，不以初始预计字数秒数臆测',
      '画面时长与音频出现微小偏差时，通过首尾动作裁切或轻微变速对齐，严禁破坏音频完整性',
    ],
  },
  {
    id: 'trim-strategy',
    name: '裁切策略',
    category: 'editing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/editing/trim-strategy',
    summary: '剔除无效前摇、动作静止结尾与多余余量，保留最饱满动作与表情黄金段',
    keywords: ['裁切', '剪头去尾', '前摇', '静止帧', '修剪'],
    rules: [
      '去除生成片段开头的静止启动帧与无效前摇动作',
      '精准截取动作爆发点至收势瞬间，保证镜头切换利落干脆',
    ],
  },
  {
    id: 'live-action-shooting',
    name: '真人实拍质感与调度',
    category: 'directing',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/directing/live-action-shooting',
    summary: '自然身体呼吸感、不经意视线流转、现场真实环境反射与手持微晃机位',
    keywords: ['真人实拍', '实拍感', '生活感', '呼吸感', '手持机位', '自然表现'],
    rules: [
      '加入轻微手持呼吸感晃动与自然失焦瞬间，营造真实纪实感',
      '角色动作要有真实的重力物理感与生理惯性',
    ],
    promptDirective: 'Handheld camera movement with subtle natural organic sway, authentic documentary feel, natural atmospheric light haze, lifelike eye-dart and subtle micro-hesitation.',
  },
  {
    id: 'explainer-narrative',
    name: '科普解说叙事架构',
    category: 'screenwriting',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/screenwriting/explainer-narrative',
    summary: '金字塔信息分层：抛出悬念/痛点 → 具象化拆解 → 视觉证据举证 → 认知升级结论',
    keywords: ['科普', '解说', '教程', '信息分层', '知识视频', '论证'],
    rules: [
      '开篇 3 秒必须建立认知悬念或视觉冲击',
      '画面必须与解说台词形成信息互补举证，而非逐字字面插画',
    ],
  },
  {
    id: 'character-consistency',
    name: '人物跨镜一致性守护',
    category: 'asset',
    profileId: '06-GeneralVideo-通用视频制作流程/reference/assets/character-consistency',
    summary: '锁定核心骨骼特征、标志性配饰与面部识别锚点，防多镜头角色漂移',
    keywords: ['人物一致性', '角色一致', '同一人物', '跨镜头一致', '防漂移'],
    rules: [
      '提取并锁定面部三庭五眼比例、特征性发型、服饰色彩与特征配饰',
      '在每一段生成提示词中正向声明核心锚点，严禁引入未授权变异',
    ],
  },
];

export function detectGeneralVideoDriver(query: string): GeneralVideoDriver {
  const text = query.toLowerCase();

  // 1. Speech driven
  if (/(?:科普|教程|讲解|解说|知识|旁白主导|explainer|tutorial|speech|口播解说|讲授)/i.test(text)) {
    return 'speech';
  }

  // 2. On-camera driven
  if (/(?:vlog|第一人称|真人出镜|出镜|采访|面对镜头|镜头前|on-camera|独白)/i.test(text)) {
    return 'on-camera';
  }

  // 3. Default: Narrative driven (story, short film, cinematic, mood, animation)
  return 'narrative';
}

export function buildGeneralVideoStageOutline(
  driver: GeneralVideoDriver,
  options: {
    hasAssets?: boolean;
    wantStoryboardImages?: boolean;
    wantBgm?: boolean;
    wantCaptions?: boolean;
    multiClip?: boolean;
  } = {}
): StageOutlineItem[] {
  const stages: StageOutlineItem[] = [];
  let order = 0;

  // Stage 0: Intent & Brief (all drivers)
  stages.push({
    id: 'intent-brief',
    order: order++,
    name: '制作简案',
  });

  if (driver === 'narrative') {
    // Narrative: intent-brief -> assets? -> storyboard-images? -> visual-gen -> audio? -> post?
    if (options.hasAssets) {
      stages.push({ id: 'assets', order: order++, name: '资产准备', condition: '存在跨镜头复用角色或场景' });
    }
    if (options.wantStoryboardImages) {
      stages.push({ id: 'storyboard-images', order: order++, name: '分镜图生成', condition: '用户选择生成推荐分镜图' });
    }
    stages.push({ id: 'visual-gen', order: order++, name: '视频生成' });
    if (options.wantBgm) {
      stages.push({ id: 'audio', order: order++, name: '配乐准备', condition: '用户选择添加独立配乐' });
    }
    if (options.wantBgm || options.multiClip) {
      stages.push({ id: 'post', order: order++, name: '后期合成', condition: '多片段合并或混音' });
    }
  } else if (driver === 'speech') {
    // Speech: intent-brief -> assets? -> audio -> storyboard-images? -> visual-gen -> post
    if (options.hasAssets) {
      stages.push({ id: 'assets', order: order++, name: '音色与视觉资产', condition: '需要试听音色锚点或人物/场景锚点' });
    }
    // Audio is REQUIRED for speech driver (produces vo_timeline)
    stages.push({ id: 'audio', order: order++, name: '完整旁白配音与时间线' });
    if (options.wantStoryboardImages) {
      stages.push({ id: 'storyboard-images', order: order++, name: '分镜图生成', condition: '用户选择生成推荐分镜图' });
    }
    stages.push({ id: 'visual-gen', order: order++, name: '根据时间线视频生成' });
    // Post is REQUIRED for speech driver (mixes VO over native track)
    stages.push({ id: 'post', order: order++, name: '后期合成与旁白对齐' });
  } else if (driver === 'on-camera') {
    // On-camera: intent-brief -> assets? -> storyboard-images? -> visual-gen -> post?
    if (options.hasAssets) {
      stages.push({ id: 'assets', order: order++, name: '出镜主体与场景资产', condition: '出镜人或服装跨片段复用' });
    }
    if (options.wantStoryboardImages) {
      stages.push({ id: 'storyboard-images', order: order++, name: '分镜图生成', condition: '用户选择生成推荐分镜图' });
    }
    stages.push({ id: 'visual-gen', order: order++, name: '出镜视频生成' });
    if (options.wantCaptions || options.multiClip) {
      stages.push({ id: 'post', order: order++, name: '后期剪辑与字幕', condition: '多段剪辑或用户要求字幕' });
    }
  }

  return stages;
}

export function matchGeneralVideoMethodCards(text: string): GeneralVideoMethodCard[] {
  const normalized = text.toLowerCase();
  const matched: GeneralVideoMethodCard[] = [];

  for (const card of GENERAL_VIDEO_METHOD_CARDS) {
    if (card.keywords.some((kw) => normalized.includes(kw.toLowerCase()))) {
      matched.push(card);
    }
  }

  // Also check 24 text animation styles
  for (const style of TEXT_ANIMATION_STYLES) {
    if (
      normalized.includes(style.id) ||
      normalized.includes(style.name) ||
      (normalized.includes('文字动画') && normalized.includes(style.name.slice(0, 2)))
    ) {
      matched.push({
        id: `text-animation-${style.id}`,
        name: `文字动画：${style.name}`,
        category: 'text-animation',
        profileId: '06-GeneralVideo-通用视频制作流程/reference/visual-aesthetics/typography',
        summary: style.description,
        keywords: [style.id, style.name],
        rules: [`运用${style.name} (${style.description})`],
        promptDirective: `Typography visual motion: ${style.name} (${style.description}), sharp render, perfect legibility.`,
      });
    }
  }

  return matched;
}

export function applyMethodCardToPrompt(prompt: string, cardId: string): string {
  const card = GENERAL_VIDEO_METHOD_CARDS.find((c) => c.id === cardId)
    || matchGeneralVideoMethodCards(cardId)[0];

  if (!card || !card.promptDirective) return prompt;

  return `${prompt.trim()}, ${card.promptDirective}`;
}
