import {
  type PromptLayerRecordV1,
  type ReferenceSlotBindingV1,
  type SoundPolicyV1,
  type VendorModelId,
} from '@/features/canvas/agent/domain/modelCard';
import { lintPrompt } from './PromptLinter';
import { computeSha256 } from '@/features/canvas/agent/infrastructure/sourceRepository';

/** Structured prompt assembly for the two video models described in the imported profiles. */
export interface TimedAction {
  startSeconds: number;
  endSeconds: number;
  action: string;
}

export interface MinimaxH3PromptInput {
  durationSeconds: number;
  space: string;
  lighting: string;
  shots?: MinimaxH3Shot[];
  /** Legacy single-shot fields remain supported for saved drafts. */
  camera?: string;
  cameraMotion?: string;
  backgroundMotion?: string;
  actions?: TimedAction[];
  sound?: string;
}

export interface MinimaxH3Shot {
  camera: string;
  cameraMotion: string;
  backgroundMotion: string;
  actions: TimedAction[];
  sound: string;
}

function required(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function validateTimeline(actions: TimedAction[], durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 4 || durationSeconds > 15) {
    throw new Error('Duration must be between 4 and 15 seconds');
  }
  if (!actions.length) throw new Error('At least one action is required');
  let previousEnd = 0;
  for (const action of actions) {
    if (!Number.isFinite(action.startSeconds) || !Number.isFinite(action.endSeconds)
      || action.startSeconds < previousEnd || action.endSeconds <= action.startSeconds
      || action.endSeconds > durationSeconds) {
      throw new Error('Actions must be ordered, non-overlapping, and within the duration');
    }
    required(action.action, 'Action');
    previousEnd = action.endSeconds;
  }
}

export function compileMinimaxH3Prompt(input: MinimaxH3PromptInput): string {
  const shots = input.shots ?? [{
    camera: input.camera ?? '',
    cameraMotion: input.cameraMotion ?? '',
    backgroundMotion: input.backgroundMotion ?? '',
    actions: input.actions ?? [],
    sound: input.sound ?? '',
  }];
  if (shots.length === 0) throw new Error('At least one shot is required');
  validateTimeline(shots.flatMap((shot) => shot.actions), input.durationSeconds);
  if (shots.some((shot) => shot.actions.length === 0)) throw new Error('Each shot needs an action beat');
  return [
    `全局基准：${required(input.space, 'Space')}；${required(input.lighting, 'Lighting')}`,
    ...shots.flatMap((shot, index) => [
      `【镜头${index + 1}】`,
      `景别与机位：${required(shot.camera, `Shot ${index + 1} camera`)}`,
      `镜头运动：${required(shot.cameraMotion, `Shot ${index + 1} camera motion`)}`,
      `主体行为：${shot.actions.map(({ startSeconds, endSeconds, action }) =>
        `${startSeconds}–${endSeconds}秒 ${action.trim()}`).join('；')}`,
      `重要背景运动：${required(shot.backgroundMotion, `Shot ${index + 1} background motion`)}`,
      `台词或声音：${required(shot.sound, `Shot ${index + 1} sound`)}`,
    ]),
  ].join('\n');
}

export interface SeedancePromptInput {
  durationSeconds: number;
  scene: string;
  actions: TimedAction[];
  characterImageSlot?: number;
  dialogueAudioSlot?: number;
  sound?: string;
  timingMode?: 'natural' | 'precise';
}

/** Slots are emitted only for references that actually exist in the request. */
export function compileSeedancePrompt(input: SeedancePromptInput): string {
  validateTimeline(input.actions, input.durationSeconds);
  const [minimum, maximum] = input.durationSeconds <= 6 ? [3, 4]
    : input.durationSeconds <= 10 ? [4, 6] : [5, 7];
  if (input.actions.length < minimum || input.actions.length > maximum) {
    throw new Error(`${input.durationSeconds}s requires ${minimum}-${maximum} action beats`);
  }
  const slots: string[] = [];
  if (input.characterImageSlot !== undefined) {
    if (!Number.isInteger(input.characterImageSlot) || input.characterImageSlot < 1) throw new Error('Invalid image slot');
    slots.push(`角色参考 @图片${input.characterImageSlot}`);
  }
  if (input.dialogueAudioSlot !== undefined) {
    if (!Number.isInteger(input.dialogueAudioSlot) || input.dialogueAudioSlot < 1) throw new Error('Invalid audio slot');
    slots.push(`对白参考 @音频${input.dialogueAudioSlot}`);
  }
  return [
    required(input.scene, 'Scene'),
    slots.join('；'),
    input.actions.map(({ action, startSeconds, endSeconds }, index) =>
      input.timingMode === 'precise'
        ? `${startSeconds}–${endSeconds}秒：${action.trim()}`
        : `${index === 0 ? '先' : index === input.actions.length - 1 ? '最后' : '随后'}${action.trim()}`
    ).join('，'),
    input.sound ? `声音：${input.sound.trim()}` : '',
  ].filter(Boolean).join('\n');
}

export interface KlingPromptInput {
  durationSeconds: number; // 5 or 10
  scene: string;
  cameraMotion: string;
  action: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
}

export function compileKlingPrompt(input: KlingPromptInput): string {
  if (input.durationSeconds !== 5 && input.durationSeconds !== 10) {
    throw new Error('Kling duration must be 5 or 10 seconds');
  }
  const parts: string[] = [
    `场景环境：${required(input.scene, 'Scene')}`,
    `镜头运动：${required(input.cameraMotion, 'Camera Motion')}`,
    `主体动态：${required(input.action, 'Action')}`,
  ];
  if (input.aspectRatio) {
    parts.push(`画面比例：${input.aspectRatio}`);
  }
  return parts.join('\n');
}

export interface VeoPromptInput {
  durationSeconds?: number;
  visualDescription: string;
  lighting?: string;
  camera?: string;
}

export function compileVeoPrompt(input: VeoPromptInput): string {
  const parts: string[] = [
    required(input.visualDescription, 'Visual description'),
  ];
  if (input.lighting) parts.push(`Lighting: ${input.lighting.trim()}`);
  if (input.camera) parts.push(`Camera: ${input.camera.trim()}`);
  return parts.join(', ');
}

export interface MidjourneyPromptInput {
  subject: string;
  style?: string;
  aspectRatio?: string;
  stylize?: number;
  chaos?: number;
  characterRefUrl?: string;
  styleRefUrl?: string;
}

export function compileMidjourneyPrompt(input: MidjourneyPromptInput): string {
  const parts: string[] = [required(input.subject, 'Subject')];
  if (input.style) parts.push(input.style.trim());
  let prompt = parts.join(', ');
  if (input.characterRefUrl) prompt += ` --cref ${input.characterRefUrl.trim()}`;
  if (input.styleRefUrl) prompt += ` --sref ${input.styleRefUrl.trim()}`;
  if (input.aspectRatio) prompt += ` --ar ${input.aspectRatio.trim()}`;
  if (input.stylize !== undefined) prompt += ` --s ${input.stylize}`;
  if (input.chaos !== undefined) prompt += ` --c ${input.chaos}`;
  return prompt;
}

export interface OfficialMusicPromptInput {
  genre: string;
  mood: string;
  tempoBpm?: number;
  instrumental?: boolean;
  lyrics?: string;
}

export function compileOfficialMusicPrompt(input: OfficialMusicPromptInput): {
  stylePrompt: string;
  lyricsPrompt: string;
} {
  const styleParts = [required(input.genre, 'Genre'), required(input.mood, 'Mood')];
  if (input.tempoBpm) styleParts.push(`${input.tempoBpm} BPM`);
  if (input.instrumental) styleParts.push('instrumental, no vocals');
  return {
    stylePrompt: styleParts.join(', '),
    lyricsPrompt: input.instrumental ? '' : (input.lyrics?.trim() || ''),
  };
}

export interface SeedAudioPromptInput {
  text: string;
  voiceId?: string;
  language?: string;
  speedRatio?: number;
  emotion?: string;
}

export function compileSeedAudioPrompt(input: SeedAudioPromptInput): {
  normalizedText: string;
  voiceId?: string;
  speedRatio: number;
} {
  const text = required(input.text, 'Text');
  return {
    normalizedText: text,
    voiceId: input.voiceId,
    speedRatio: input.speedRatio ?? 1.0,
  };
}

export function bindReferenceSlots(
  prompt: string,
  referenceSlots: ReferenceSlotBindingV1[]
): string {
  for (const slot of referenceSlots) {
    if (!slot.slotToken.startsWith('@') && !slot.slotToken.startsWith('--')) {
      throw new Error(`Invalid reference slot token: ${slot.slotToken}`);
    }
  }
  return prompt;
}

export async function buildPromptLayerRecord(params: {
  sourcePrompt: string;
  preparedPrompt: string;
  modelId: VendorModelId;
  referenceSlots?: ReferenceSlotBindingV1[];
  soundPolicy?: SoundPolicyV1;
  modality?: 'image' | 'video';
}): Promise<PromptLayerRecordV1> {
  const modality = params.modality ?? 'video';
  const lintResult = lintPrompt({
    prompt: params.preparedPrompt,
    modality,
    referenceImageCount: params.referenceSlots?.filter((s) => s.slotToken.startsWith('@图片')).length ?? 0,
    referenceAudioDurationSeconds: params.referenceSlots?.find((s) => s.slotToken.startsWith('@音频'))?.durationSeconds,
  });

  const submittedPrompt = params.preparedPrompt;
  const compilerVersion = 'minimax-design-compiler/1.0';
  const compilerHash = await computeSha256(`${compilerVersion}:${params.modelId}:${submittedPrompt}`);

  return {
    schemaVersion: 1,
    sourcePrompt: params.sourcePrompt,
    preparedPrompt: params.preparedPrompt,
    submittedPrompt,
    compilerVersion,
    compilerHash,
    modelId: params.modelId,
    referenceSlots: params.referenceSlots ?? [],
    soundPolicy: params.soundPolicy,
    issues: lintResult.issues,
    createdAt: Date.now(),
  };
}
