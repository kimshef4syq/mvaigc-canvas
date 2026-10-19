import { z } from 'zod';

export const mediaProbeResultSchema = z.object({
  format: z.string(),
  durationSeconds: z.number().nonnegative(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  fps: z.number().positive().optional(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  audioChannels: z.number().int().nonnegative().optional(),
  audioSampleRate: z.number().int().nonnegative().optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
});

export type MediaProbeResult = z.infer<typeof mediaProbeResultSchema>;

export const subtitleCueSchema = z.object({
  id: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  text: z.string().min(1),
});

export type SubtitleCue = z.infer<typeof subtitleCueSchema>;

export const probeOperationSchema = z.object({
  type: z.literal('probe'),
  assetId: z.string().min(1),
});

export const trimOperationSchema = z.object({
  type: z.literal('trim'),
  assetId: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
});

export const concatOperationSchema = z.object({
  type: z.literal('concat'),
  assetIds: z.array(z.string().min(1)).min(2),
  transition: z.enum(['cut', 'dissolve']).default('cut'),
  targetResolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
  keepAudio: z.boolean().default(true),
});

export const scaleOperationSchema = z.object({
  type: z.literal('scale'),
  assetId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const transcodeOperationSchema = z.object({
  type: z.literal('transcode'),
  assetId: z.string().min(1),
  targetFormat: z.enum(['mp4', 'webm', 'mov', 'mp3', 'wav']),
  crf: z.number().int().min(0).max(51).optional(),
});

export const mixOperationSchema = z.object({
  type: z.literal('mix'),
  primaryAssetId: z.string().min(1),
  backgroundAssetId: z.string().min(1),
  primaryVolume: z.number().min(0).max(2).default(1.0),
  backgroundVolume: z.number().min(0).max(2).default(0.3),
  ducking: z.boolean().default(false),
  fadeInSeconds: z.number().nonnegative().default(0),
  fadeOutSeconds: z.number().nonnegative().default(0),
});

export const fadeOperationSchema = z.object({
  type: z.literal('fade'),
  assetId: z.string().min(1),
  fadeInSeconds: z.number().nonnegative().default(0),
  fadeOutSeconds: z.number().nonnegative().default(0),
});

export const extractAudioOperationSchema = z.object({
  type: z.literal('extract-audio'),
  assetId: z.string().min(1),
  format: z.enum(['mp3', 'wav', 'aac']).default('mp3'),
});

export const burnSubtitlesOperationSchema = z.object({
  type: z.literal('burn-subtitles'),
  videoAssetId: z.string().min(1),
  subtitles: z.array(subtitleCueSchema).min(1),
  fontName: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontColor: z.string().optional(),
});

export const overlayApprovedTextOperationSchema = z.object({
  type: z.literal('overlay-approved-text'),
  videoAssetId: z.string().min(1),
  text: z.string().min(1).max(300),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  position: z.enum(['bottom', 'center', 'top']).default('bottom'),
});

export const mediaPostprocessOperationSchema = z.discriminatedUnion('type', [
  probeOperationSchema,
  trimOperationSchema,
  concatOperationSchema,
  scaleOperationSchema,
  transcodeOperationSchema,
  mixOperationSchema,
  fadeOperationSchema,
  extractAudioOperationSchema,
  burnSubtitlesOperationSchema,
  overlayApprovedTextOperationSchema,
]);

export type MediaPostprocessOperation = z.infer<typeof mediaPostprocessOperationSchema>;

export const mediaPostprocessReceiptSchema = z.object({
  receiptId: z.string().min(1),
  operationType: z.string().min(1),
  inputAssetIds: z.array(z.string()),
  outputAssetId: z.string().min(1),
  probe: mediaProbeResultSchema,
  measuredDurationSeconds: z.number().nonnegative(),
  rollbackToken: z.string().optional(),
  createdAt: z.number().int().positive(),
});

export type MediaPostprocessReceipt = z.infer<typeof mediaPostprocessReceiptSchema>;

/**
 * Parses SRT or WebVTT content into normalized subtitle cues.
 */
export function parseSrtOrVtt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  let currentId = '';
  let currentTimeLine = '';
  let currentTextLines: string[] = [];

  function parseTime(timeStr: string): number {
    const parts = timeStr.trim().split(':');
    if (parts.length === 3) {
      const hours = parseFloat(parts[0]);
      const minutes = parseFloat(parts[1]);
      const secondsParts = parts[2].replace(',', '.');
      const seconds = parseFloat(secondsParts);
      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      const minutes = parseFloat(parts[0]);
      const secondsParts = parts[1].replace(',', '.');
      const seconds = parseFloat(secondsParts);
      return minutes * 60 + seconds;
    }
    return parseFloat(timeStr) || 0;
  }

  function flushCue() {
    if (currentTimeLine && currentTextLines.length > 0) {
      const [startStr, endStr] = currentTimeLine.split('-->');
      if (startStr && endStr) {
        const start = parseTime(startStr);
        const end = parseTime(endStr);
        cues.push({
          id: currentId || `cue-${cues.length + 1}`,
          startSeconds: Math.round(start * 1000) / 1000,
          endSeconds: Math.round(end * 1000) / 1000,
          text: currentTextLines.join('\n').trim(),
        });
      }
    }
    currentId = '';
    currentTimeLine = '';
    currentTextLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      flushCue();
      continue;
    }

    if (line === 'WEBVTT') continue;

    if (line.includes('-->')) {
      currentTimeLine = line;
    } else if (!currentTimeLine && !currentId && /^\d+$/.test(line)) {
      currentId = line;
    } else {
      currentTextLines.push(line);
    }
  }

  flushCue();
  return cues;
}

/**
 * Formats normalized subtitle cues into standard SRT format.
 */
export function formatSrt(cues: SubtitleCue[]): string {
  function formatTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const millis = Math.floor((totalSeconds % 1) * 1000);
    const pad = (n: number, w: number = 2) => String(n).padStart(w, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
  }

  return cues
    .map((cue, idx) => {
      return `${idx + 1}\n${formatTime(cue.startSeconds)} --> ${formatTime(cue.endSeconds)}\n${cue.text}`;
    })
    .join('\n\n');
}

/**
 * Validates subtitle cues against temporal and text integrity rules.
 */
export function validateSubtitles(cues: SubtitleCue[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (cues.length === 0) {
    errors.push('字幕条目列表不能为空。');
    return { valid: false, errors };
  }

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.startSeconds < 0) {
      errors.push(`字幕序号 ${cue.id}：起始时间 (${cue.startSeconds}s) 不能为负数。`);
    }
    if (cue.endSeconds <= cue.startSeconds) {
      errors.push(`字幕序号 ${cue.id}：结束时间 (${cue.endSeconds}s) 必须大于起始时间 (${cue.startSeconds}s)。`);
    }
    if (cue.endSeconds > 7200) {
      errors.push(`字幕序号 ${cue.id}：时间超出最大范围（7200s）。`);
    }
    if (!cue.text.trim()) {
      errors.push(`字幕序号 ${cue.id}：文本内容不能为空。`);
    }

    if (i > 0) {
      const prev = cues[i - 1];
      if (cue.startSeconds < prev.endSeconds) {
        errors.push(`字幕序号 ${cue.id} 与上一条 ${prev.id} 存在时间重叠 (${cue.startSeconds}s < ${prev.endSeconds}s)。`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Voice reference duration constraint per §11.6 and audio profile:
 * Reference audio MUST be measured to be strictly greater than 2.0 seconds.
 * Failing to meet > 2.0s cannot be rounded up and must be rejected.
 */
export function validateVoiceReferenceDuration(measuredSeconds: number): {
  valid: boolean;
  error?: string;
} {
  if (typeof measuredSeconds !== 'number' || !Number.isFinite(measuredSeconds) || measuredSeconds <= 0) {
    return { valid: false, error: '语音参考音频时长测量无效。' };
  }

  if (measuredSeconds <= 2.0) {
    return {
      valid: false,
      error: `语音参考音频实测时长必须严格大于 2.0 秒，当前实测为 ${measuredSeconds.toFixed(2)} 秒，严禁四舍五入或伪造有效时长。`,
    };
  }

  return { valid: true };
}
