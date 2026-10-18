export type PromptIssueCode = 'negation' | 'on-image-text' | 'plastic-skin' | 'anatomy' | 'audio-sample';

export interface PromptIssue {
  code: PromptIssueCode;
  message: string;
}

export interface PromptLintInput {
  prompt: string;
  modality: 'image' | 'video';
  referenceAudioDurationSeconds?: number;
}

export interface PromptLintResult {
  prompt: string;
  issues: PromptIssue[];
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
  if (input.referenceAudioDurationSeconds !== undefined
    && input.referenceAudioDurationSeconds > 3) {
    issues.push({ code: 'audio-sample', message: '参考音频超过 3 秒；提交前检查模型的参考音频限制。' });
  }
  return { prompt, issues };
}
