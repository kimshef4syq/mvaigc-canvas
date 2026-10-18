export type PromptIssueCode =
  | 'negation' | 'on-image-text' | 'plastic-skin' | 'anatomy' | 'audio-sample'
  | 'brand-injection' | 'character-refs' | 'cultural-stereotypes'
  | 'era-disambiguation' | 'intent-overreach' | 'medium-drift'
  | 'mood-vocabulary' | 'spoken-video' | 'webtoon-proportions';

export interface PromptIssue {
  code: PromptIssueCode;
  message: string;
}

export interface PromptLintInput {
  prompt: string;
  modality: 'image' | 'video';
  referenceAudioDurationSeconds?: number;
  referenceImageCount?: number;
}

export interface PromptLintResult {
  prompt: string;
  issues: PromptIssue[];
}

export function isMiniMaxDesignVideoModel(model: string): boolean {
  return /minimax[-_]h3|seedance/i.test(model);
}

/**
 * Preflight for the imported Failures profiles. Preserve explicit user constraints:
 * ambiguous negation, exact lettering and hand actions require review rather
 * than an automatic rewrite that can change the requested result.
 */
export function lintPrompt(input: PromptLintInput): PromptLintResult {
  const issues: PromptIssue[] = [];
  let prompt = input.prompt;
  if (/(不要|禁止|不能|不得|没有|无|\b(?:no|without|exclude)\b)/i.test(prompt)) {
    issues.push({ code: 'negation', message: '检查否定约束；可明确描述希望看到的画面状态。' });
  }
  if (input.modality === 'video' && /(文字|字幕|标语|标题|片名|tagline|headline|on.screen text)/i.test(prompt)) {
    issues.push({ code: 'on-image-text', message: '视频中的精确文字建议由后期字幕或图形轨道呈现。' });
  }
  const closeFace = /(人脸|面部|肖像|人像|face|portrait)/i.test(prompt)
    && /(特写|近景|写实|close.up|photoreal)/i.test(prompt);
  if (closeFace && !/(毛孔|皮肤纹理|skin texture|pores)/i.test(prompt)) {
    prompt = `${prompt.trim()}\n自然皮肤纹理、可见的细微毛孔和真实反光。`;
    issues.push({ code: 'plastic-skin', message: '已补充自然皮肤肌理描述。' });
  }
  if (/(手指|指尖|finger)/i.test(prompt) && /(特写|微动作|close.up|micro.motion)/i.test(prompt)) {
    issues.push({ code: 'anatomy', message: '手部特写需明确自然的手指结构和动作。' });
  }
  if (/(品牌标识|品牌logo|\blogo\b)/i.test(prompt) && input.referenceImageCount === 0) {
    issues.push({ code: 'brand-injection', message: '准确品牌标识需要参考图；仅凭文字可能生成错误的标识。' });
  }
  if (/(同一人|同一角色|角色一致|三视图|same character)/i.test(prompt)
    && input.referenceImageCount === 0) {
    issues.push({ code: 'character-refs', message: '跨镜头角色一致性建议绑定角色参考图。' });
  }
  if (/(中国风|中式|日式|和风|韩式|异域风)/i.test(prompt)
    && !/(年代|世纪|朝代|地区|地域|城市|乡村|电影|画报|广告|\d{2,4}年)/i.test(prompt)) {
    issues.push({ code: 'cultural-stereotypes', message: '文化风格可补充时代、地区与媒介来源，减少刻板符号。' });
  }
  if (/(复古|vintage|retro|old school)/i.test(prompt)
    && !/(\d{2,4}年代|\d{4}年|y2k|千禧|民国|维多利亚)/i.test(prompt)) {
    issues.push({ code: 'era-disambiguation', message: '复古风格可明确年代、地区及媒介。' });
  }
  if (/(自由发挥|自行添加|随意添加|add anything|make up details)/i.test(prompt)) {
    issues.push({ code: 'intent-overreach', message: '开放补充可能改变主体或情节，请核对新增内容的边界。' });
  }
  if (/(照片|摄影|photoreal|photo)/i.test(prompt)
    && /(动漫|漫画|插画|anime|illustration)/i.test(prompt)) {
    issues.push({ code: 'medium-drift', message: '同时出现摄影与绘画媒介，请明确最终画面的主要媒介。' });
  }
  if (/(高级感|治愈感|氛围感|premium vibe|healing vibe)/i.test(prompt)
    && !/(光线|灯光|色彩|配色|材质|纹理|构图|留白|lighting|texture|palette)/i.test(prompt)) {
    issues.push({ code: 'mood-vocabulary', message: '抽象氛围词可补充光线、材质或构图等可观察特征。' });
  }
  if (input.modality === 'video' && /(对白|旁白|说话|演唱|dialogue|voiceover)/i.test(prompt)
    && !/(说话人|音色|语气|语言|环境音|静音|声音|speaker|voice|sound)/i.test(prompt)) {
    issues.push({ code: 'spoken-video', message: '对白视频建议明确说话人、语气和声音环境。' });
  }
  if (/(韩漫|国漫|漫剧|webtoon|manga)/i.test(prompt)
    && !/(头身比|身材比例|head heights|proportions)/i.test(prompt)) {
    issues.push({ code: 'webtoon-proportions', message: '连续漫剧镜头建议锁定角色头身比例。' });
  }
  if (input.referenceAudioDurationSeconds !== undefined
    && input.referenceAudioDurationSeconds > 3) {
    issues.push({ code: 'audio-sample', message: '参考音频超过 3 秒；提交前检查模型的参考音频限制。' });
  }
  return { prompt, issues };
}
