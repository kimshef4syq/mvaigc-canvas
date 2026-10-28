import type { GenerateRequest } from '@/commands/ai';
import { textSlotKey } from '@/features/canvas/infrastructure/comfyuiGateway';
import type { AudioCatalogEntry } from './audioModelCatalog';

/** Every audio workflow is capped at six minutes: longer renders are slow and memory-hungry, and the
 *  canvas has no use for them. Applied to whichever duration field the workflow binds. */
const AUDIO_MAX_SECONDS = 360;

/** Validate canvas inputs before conversion or upload so references are never silently discarded. */
export function buildComfyUIAudioRequest(
  entry: AudioCatalogEntry,
  values: Record<string, unknown>,
  referenceAudios: string[],
  booleanValues: Record<string, unknown> = {},
): GenerateRequest {
  if (entry.notReadyReason) throw new Error(entry.notReadyReason);
  if (entry.textSlots.length === 0) throw new Error('该工作流没有可绑定的文本输入');
  if (referenceAudios.length > entry.audioRefs.max) {
    throw new Error(`当前工作流只支持 ${entry.audioRefs.max} 个参考音频，已连接 ${referenceAudios.length} 个`);
  }
  if (referenceAudios.length < entry.audioRefs.min) {
    throw new Error(`当前工作流至少需要 ${entry.audioRefs.min} 个参考音频`);
  }
  const textSlotValues = Object.fromEntries(entry.textSlots.map((slot) => {
    const key = textSlotKey(slot);
    return [key, typeof values[key] === 'string' ? values[key] : ''];
  }));
  const booleanSlotValues = Object.fromEntries((entry.booleanSlots ?? []).map((slot) => {
    const key = textSlotKey(slot);
    const value = booleanValues[key];
    if (value !== undefined && typeof value !== 'boolean') throw new Error(`开关 ${slot.label ?? key} 必须是布尔值`);
    return [key, value ?? slot.defaultValue ?? false];
  }));
  return {
    prompt: textSlotValues[textSlotKey(entry.textSlots[0])],
    model: entry.id,
    size: 'workflow',
    aspect_ratio: 'auto',
    reference_audios: referenceAudios,
    extra_params: {
      textSlotValues,
      ...(entry.booleanSlots?.length ? { booleanSlotValues } : {}),
      seconds: AUDIO_MAX_SECONDS,
    },
  };
}
