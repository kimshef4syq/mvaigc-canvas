import { referenceVideoHasAudio } from '@/features/canvas/application/referenceVideoAudio';
import type { CustomHttpMultipartBody, GenerateRequest } from '@/commands/ai';
import { resolveImageOutputGeometry } from '@/features/canvas/application/imageOutputGeometry';
import type { VideoInputSchema } from '@/features/canvas/application/videoInputSchema';
import { customProviderMediaType, type CustomProviderConfig } from '@/stores/customProvidersStore';

type JsonRecord = Record<string, unknown>;

export interface ComfyUIInputBinding {
  nodeId: string;
  input: string;
}

export interface ComfyUITextBinding extends ComfyUIInputBinding {
  label?: string;
  /** Blank optional text preserves the workflow's original literal or connection. */
  preserveWhenEmpty?: boolean;
}

export interface ComfyUIBooleanBinding extends ComfyUIInputBinding {
  label?: string;
  defaultValue?: boolean;
}

export interface ComfyUIBindings {
  prompt?: ComfyUIInputBinding;
  texts?: ComfyUITextBinding[];
  booleans?: ComfyUIBooleanBinding[];
  seed?: ComfyUIInputBinding;
  width?: ComfyUIInputBinding;
  height?: ComfyUIInputBinding;
  duration?: ComfyUIInputBinding;
  resolution?: ComfyUIInputBinding;
  aspectRatio?: ComfyUIInputBinding;
  images: ComfyUIInputBinding[];
  audios: ComfyUIInputBinding[];
  videos?: ComfyUIInputBinding[];
}

export type ComfyUIMediaType = 'image' | 'video' | 'audio' | 'gaussian';

export interface ComfyUIConfig {
  workflow: Record<string, JsonRecord>;
  bindings: ComfyUIBindings;
  outputNodeIds: string[];
  pollIntervalMs: number;
  pollTimeoutMs: number;
  mediaType?: ComfyUIMediaType;
  // True when the stored config maps at least one text slot, so auto-detection must not apply.
  textBindingsExplicit: boolean;
  canvasReferencesOnly?: boolean;
}

export interface ComfyUITransport {
  json: (path: string, method: 'GET' | 'POST', body?: unknown) => Promise<unknown>;
  multipart: (path: string, body: CustomHttpMultipartBody) => Promise<unknown>;
  url: (path: string, query: Record<string, string>) => string;
}

export type ComfyUITemplateId = 'text-to-image' | 'image-to-image';

export function createComfyUIWorkflowTemplate(id: ComfyUITemplateId, checkpoint = ''): Pick<ComfyUIConfig, 'workflow' | 'bindings' | 'outputNodeIds'> {
  const workflow: Record<string, JsonRecord> = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'low quality, blurry', clip: ['1', 1] } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed: 0, steps: 24, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: id === 'image-to-image' ? 0.65 : 1,
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: id === 'image-to-image' ? ['5', 0] : ['4', 0],
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { filename_prefix: 'Storyboard', images: ['7', 0] } },
  };
  if (id === 'image-to-image') {
    workflow['4'] = { class_type: 'LoadImage', inputs: { image: '' } };
    workflow['5'] = { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } };
  } else {
    workflow['4'] = { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } };
  }
  return {
    workflow,
    bindings: {
      prompt: { nodeId: '2', input: 'text' },
      seed: { nodeId: '6', input: 'seed' },
      ...(id === 'text-to-image' ? { width: { nodeId: '4', input: 'width' }, height: { nodeId: '4', input: 'height' } } : {}),
      images: id === 'image-to-image' ? [{ nodeId: '4', input: 'image' }] : [],
      audios: [],
    },
    outputNodeIds: ['8'],
  };
}

export function getComfyUITemplateCheckpoint(workflowInput: unknown): string {
  const workflow = asRecord(workflowInput);
  const loader = Object.values(workflow ?? {}).find((node) => nonemptyString(asRecord(node)?.class_type) === 'CheckpointLoaderSimple');
  return nonemptyString(asRecord(asRecord(loader)?.inputs)?.ckpt_name);
}

export function withComfyUITemplateCheckpoint(workflowInput: unknown, checkpoint: string): Record<string, JsonRecord> {
  const workflow = cloneWorkflow(workflowInput);
  const loader = Object.values(workflow).find((node) => nonemptyString(node.class_type) === 'CheckpointLoaderSimple');
  const inputs = asRecord(loader?.inputs);
  if (!inputs) throw new Error('ComfyUI 模板缺少 CheckpointLoaderSimple 节点。');
  inputs.ckpt_name = checkpoint.trim();
  return workflow;
}

export async function listComfyUICheckpoints(transport: ComfyUITransport): Promise<string[]> {
  const names = (payload: unknown): string[] => Array.isArray(payload)
    ? payload.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
    : [];
  try {
    const direct = names(await transport.json('/models/checkpoints', 'GET'));
    if (direct.length > 0) return direct;
  } catch { /* Older ComfyUI versions expose the list only through object_info. */ }
  const info = asRecord(await transport.json('/object_info/CheckpointLoaderSimple', 'GET'));
  const loader = asRecord(info?.CheckpointLoaderSimple);
  const required = asRecord(asRecord(loader?.input)?.required);
  const choices = required?.ckpt_name;
  return names(Array.isArray(choices) ? choices[0] : null);
}

export class ComfyUIExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComfyUIExecutionError';
  }
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_WORKFLOW_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'webm']);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function nonemptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeKey(value: string): boolean {
  return Boolean(value) && !UNSAFE_KEYS.has(value);
}

function parseBinding(value: unknown, label: string): ComfyUIInputBinding | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = asRecord(value);
  const nodeId = nonemptyString(raw?.nodeId);
  const input = nonemptyString(raw?.input);
  if (!safeKey(nodeId) || !safeKey(input)) {
    throw new Error(`ComfyUI ${label} 映射需要有效的节点 ID 和输入字段名。`);
  }
  return { nodeId, input };
}

function parseBindingList(value: unknown, label: string): ComfyUIInputBinding[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`ComfyUI ${label}映射必须是数组。`);
  return value.map((entry, index) => {
    const binding = parseBinding(entry, `${label} ${index + 1}`);
    if (!binding) throw new Error(`ComfyUI ${label} ${index + 1} 映射不能为空。`);
    return binding;
  });
}

function parseBindings(value: unknown): ComfyUIBindings {
  const raw = asRecord(value) ?? {};
  const texts = raw.texts === undefined ? [] : raw.texts;
  if (!Array.isArray(texts)) throw new Error('ComfyUI 文本槽映射必须是数组。');
  const booleans = raw.booleans;
  if (booleans !== undefined && !Array.isArray(booleans)) throw new Error('ComfyUI 开关映射必须是数组。');
  return {
    prompt: parseBinding(raw.prompt, '提示词'),
    texts: texts.map((entry, index) => {
      const binding = parseBinding(entry, `文本槽 ${index + 1}`);
      if (!binding) throw new Error(`ComfyUI 文本槽 ${index + 1} 映射不能为空。`);
      const label = nonemptyString(asRecord(entry)?.label);
      const preserveWhenEmpty = asRecord(entry)?.preserveWhenEmpty;
      if (preserveWhenEmpty !== undefined && typeof preserveWhenEmpty !== 'boolean') {
        throw new Error(`ComfyUI 文本槽 ${index + 1} preserveWhenEmpty 必须是布尔值。`);
      }
      return { ...binding, ...(label ? { label } : {}),
        ...(preserveWhenEmpty !== undefined ? { preserveWhenEmpty } : {}) };
    }),
    ...(Array.isArray(booleans) ? { booleans: booleans.map((entry, index) => {
      const binding = parseBinding(entry, `开关 ${index + 1}`);
      if (!binding) throw new Error(`ComfyUI 开关 ${index + 1} 映射不能为空。`);
      const rawEntry = asRecord(entry)!;
      if (rawEntry.defaultValue !== undefined && typeof rawEntry.defaultValue !== 'boolean') {
        throw new Error(`ComfyUI 开关 ${index + 1} defaultValue 必须是布尔值。`);
      }
      const label = nonemptyString(rawEntry.label);
      return { ...binding, ...(label ? { label } : {}),
        ...(typeof rawEntry.defaultValue === 'boolean' ? { defaultValue: rawEntry.defaultValue } : {}) };
    }) } : {}),
    seed: parseBinding(raw.seed, '种子'),
    width: parseBinding(raw.width, '宽度'),
    height: parseBinding(raw.height, '高度'),
    duration: parseBinding(raw.duration, '时长'),
    resolution: parseBinding(raw.resolution, '分辨率'),
    aspectRatio: parseBinding(raw.aspectRatio, '画幅比例'),
    images: parseBindingList(raw.images, '参考图'),
    audios: parseBindingList(raw.audios, '参考音频'),
    videos: parseBindingList(raw.videos, '参考视频'),
  };
}

function cloneWorkflow(raw: unknown): Record<string, JsonRecord> {
  const source = asRecord(raw);
  if (!source || Object.keys(source).length === 0) {
    throw new Error('请导入 ComfyUI 的 API 格式工作流 JSON。');
  }
  if (Array.isArray(source.nodes) && Array.isArray(source.links)) {
    throw new Error('当前文件是 ComfyUI 画布格式；请在 ComfyUI 中导出 API 格式工作流。');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(source);
  } catch {
    throw new Error('ComfyUI 工作流不是有效的 JSON 数据。');
  }
  if (serialized.length > MAX_WORKFLOW_BYTES) {
    throw new Error('ComfyUI 工作流超过 8 MiB，请移除内嵌媒体后再导入。');
  }
  const cloned = JSON.parse(serialized) as JsonRecord;
  for (const [nodeId, value] of Object.entries(cloned)) {
    const node = asRecord(value);
    if (!safeKey(nodeId) || !node || !nonemptyString(node.class_type) || !asRecord(node.inputs)) {
      throw new Error(`ComfyUI 节点 ${nodeId} 缺少 class_type 或 inputs；请使用 API 格式。`);
    }
  }
  return cloned as Record<string, JsonRecord>;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(max, Math.max(min, Math.floor(number)))
    : fallback;
}

export function isComfyUIProvider(cfg: Pick<CustomProviderConfig, 'apiStyle'>): boolean {
  return cfg.apiStyle === 'comfyui';
}

export function parseComfyUIConfig(cfg: CustomProviderConfig): ComfyUIConfig {
  const raw = asRecord(cfg.extraParams?.comfyui);
  if (!raw) throw new Error('ComfyUI 配置缺少 API 工作流。');
  const outputNodeIds = raw.outputNodeIds === undefined ? [] : raw.outputNodeIds;
  if (!Array.isArray(outputNodeIds) || outputNodeIds.some((item) => !safeKey(nonemptyString(item)))) {
    throw new Error('ComfyUI 输出节点 ID 必须是有效字符串数组。');
  }
  const workflow = cloneWorkflow(raw.workflow);
  for (const nodeId of outputNodeIds) {
    if (!Object.prototype.hasOwnProperty.call(workflow, nodeId)) {
      throw new Error(`ComfyUI 输出节点 ${nodeId} 不在工作流中。`);
    }
  }
  const bindings = parseBindings(raw.bindings);
  // Decided from the stored config, before any inference below, so auto-detection can never override
  // a slot the user mapped explicitly.
  const textBindingsExplicit = Boolean(bindings.prompt) || Boolean(bindings.texts?.length);
  // A config that maps no text slot at all still resolves the workflow's unambiguous prompt node,
  // so `bindings` alone describes the effective slots for `effectiveTextSlots` callers. Detected
  // multi-slot results stay out of the stored shape; `effectiveBindings` merges them at runtime.
  const unbound = !textBindingsExplicit;
  return {
    workflow,
    mediaType: customProviderMediaType(cfg) === 'gaussian' ? 'gaussian' : customProviderMediaType(cfg) === 'audio' ? 'audio' : customProviderMediaType(cfg) === 'video' ? 'video' : 'image',
    textBindingsExplicit,
    canvasReferencesOnly: raw.canvasReferencesOnly === true,
    bindings: {
      ...bindings,
      prompt: bindings.prompt ?? (unbound ? suggestComfyUIBindings(workflow).prompt : undefined),
    },
    outputNodeIds: outputNodeIds as string[],
    pollIntervalMs: boundedNumber(raw.pollIntervalMs, 1500, 500, 10000),
    pollTimeoutMs: boundedNumber(raw.pollTimeoutMs, 10 * 60 * 1000, 5000, 30 * 60 * 1000),
  };
}

function nodeInputs(workflow: Record<string, JsonRecord>, nodeId: string): JsonRecord {
  const inputs = asRecord(workflow[nodeId]?.inputs);
  if (!inputs) throw new Error(`ComfyUI 工作流中找不到节点 ${nodeId}。`);
  return inputs;
}

function setInput(
  workflow: Record<string, JsonRecord>,
  binding: ComfyUIInputBinding,
  value: unknown,
): void {
  const inputs = nodeInputs(workflow, binding.nodeId);
  if (!Object.prototype.hasOwnProperty.call(inputs, binding.input)) {
    throw new Error(`ComfyUI 节点 ${binding.nodeId} 没有输入字段 ${binding.input}。`);
  }
  inputs[binding.input] = value;
}

function findInput(
  workflow: Record<string, JsonRecord>,
  classPattern: RegExp,
  input: string,
): ComfyUIInputBinding | undefined {
  const matches = Object.entries(workflow).filter(([, node]) =>
    classPattern.test(nonemptyString(node.class_type))
    && Object.prototype.hasOwnProperty.call(asRecord(node.inputs) ?? {}, input)
  );
  return matches.length === 1 ? { nodeId: matches[0][0], input } : undefined;
}

const LOCAL_H3_NODE = /^MiniMaxH3(?:ImageToVideo|ReferenceToVideo)$/;
const LOCAL_H3_GEOMETRY_NODE = /^(?:MiniMaxH3(?:ImageToVideo|ReferenceToVideo)|EmptyMiniMaxH3LatentAV)$/;
const H3_SIZES: Record<string, [number, number]> = {
  '16:9': [1344, 768], '9:16': [768, 1344], '1:1': [768, 768],
  '4:3': [1024, 768], '3:4': [768, 1024],
};

export function isLocalH3Workflow(workflowInput: unknown): boolean {
  return Object.values(asRecord(workflowInput) ?? {}).some((node) => LOCAL_H3_NODE.test(nonemptyString(asRecord(node)?.class_type)));
}

const TEXT_INPUT_FIELDS = ['target_text', 'text', 'style', 'lyrics', 'instruct', 'ref_text', 'prompt'];
// Fields a switch/forwarding node exposes so a link can be followed through it.
const TEXT_TRACE_FIELDS = ['value', 'text', 'style', 'lyrics'];
const TEXT_LITERAL_NODE = /^(?:PrimitiveString|PrimitiveStringMultiline|JjkText|Text|CR Text|String|CR Prompt Text)$/i;
const TEXT_FIELD_LABELS: Record<string, string> = {
  target_text: '目标文本',
  text: '目标文本',
  instruct: '音色描述',
  style: '曲风',
  lyrics: '歌词',
  ref_text: '参考文本',
};
const MAX_TEXT_TRACE_HOPS = 12;

function linkTarget(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const nodeId = value[0];
  return typeof nodeId === 'string' || typeof nodeId === 'number' ? String(nodeId) : null;
}

// Follows a link through forwarding nodes until it reaches the node holding the literal string.
function literalTextSlot(
  workflow: Record<string, JsonRecord>,
  startNodeId: string,
): ComfyUIInputBinding | null {
  const visited = new Set<string>();
  let nodeId = startNodeId;
  for (let hop = 0; hop < MAX_TEXT_TRACE_HOPS; hop += 1) {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    const node = asRecord(workflow[nodeId]);
    const inputs = asRecord(node?.inputs);
    if (!node || !inputs) return null;
    if (TEXT_LITERAL_NODE.test(nonemptyString(node.class_type))) {
      const literal = Object.entries(inputs).find(([, value]) => typeof value === 'string');
      return literal ? { nodeId, input: literal[0] } : null;
    }
    const next = TEXT_TRACE_FIELDS.map((field) => linkTarget(inputs[field])).find((id) => id !== null);
    if (!next) return null;
    nodeId = next;
  }
  return null;
}

// Field-driven detection: a bindable slot is always a literal node reached through a consumer's text field.
// Inline literals stay with the workflow, and a field name that resolves to unrelated slots is dropped as
// ambiguous rather than guessed at.
function suggestTextSlots(workflow: Record<string, JsonRecord>): ComfyUITextBinding[] {
  const hits: { field: string; slot: ComfyUIInputBinding }[] = [];
  for (const node of Object.values(workflow)) {
    const inputs = asRecord(node.inputs);
    if (!inputs || TEXT_LITERAL_NODE.test(nonemptyString(node.class_type))) continue;
    for (const field of TEXT_INPUT_FIELDS) {
      const target = linkTarget(inputs[field]);
      const slot = target ? literalTextSlot(workflow, target) : null;
      if (slot) hits.push({ field, slot });
    }
  }
  const slotsPerField = new Map<string, Set<string>>();
  for (const { field, slot } of hits) {
    const keys = slotsPerField.get(field) ?? new Set<string>();
    keys.add(textSlotKey(slot));
    slotsPerField.set(field, keys);
  }
  const slots: ComfyUITextBinding[] = [];
  const seen = new Set<string>();
  for (const { field, slot } of hits) {
    if ((slotsPerField.get(field)?.size ?? 0) > 1) continue;
    const key = textSlotKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ ...slot, label: TEXT_FIELD_LABELS[field] ?? key });
  }
  return slots;
}

/** Recognize YuE2's ABC planning branch by connections rather than exported node IDs. */
function suggestABCBindings(workflow: Record<string, JsonRecord>) {
  const texts: ComfyUITextBinding[] = [];
  const booleans: ComfyUIBooleanBinding[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type !== 'YuE2GenerateMusic') continue;
    const inputs = asRecord(node.inputs);
    let upstream = linkTarget(inputs?.abc);
    const visited = new Set<string>();
    for (let hop = 0; upstream && hop < MAX_TEXT_TRACE_HOPS; hop++) {
      if (visited.has(upstream)) break;
      visited.add(upstream);
      const source = workflow[upstream];
      const sourceInputs = asRecord(source?.inputs);
      if (source?.class_type === 'PreviewAny') {
        upstream = linkTarget(sourceInputs?.source);
        continue;
      }
      if (source?.class_type === 'ComfySwitchNode') {
        const booleanNodeId = linkTarget(sourceInputs?.switch);
        const plannerNodeId = linkTarget(sourceInputs?.on_true);
        const booleanNode = booleanNodeId ? workflow[booleanNodeId] : undefined;
        const booleanInputs = asRecord(booleanNode?.inputs);
        if (booleanNodeId && booleanNode?.class_type === 'PrimitiveBoolean'
          && booleanInputs && Object.prototype.hasOwnProperty.call(booleanInputs, 'value')
          && plannerNodeId && workflow[plannerNodeId]?.class_type === 'YuE2GenerateABC') {
          texts.push({ nodeId, input: 'abc', label: 'ABC 乐谱（可选）', preserveWhenEmpty: true });
          if (!booleans.some(binding => binding.nodeId === booleanNodeId)) {
            booleans.push({ nodeId: booleanNodeId, input: 'value', label: 'ABC planning（自动规划）',
              defaultValue: typeof booleanInputs.value === 'boolean' ? booleanInputs.value : false });
          }
        }
      }
      break;
    }
  }
  return { texts, booleans };
}

export function suggestComfyUIBindings(workflowInput: unknown): ComfyUIBindings {
  const workflow = cloneWorkflow(workflowInput);
  const imageNodes = Object.entries(workflow).filter(([, node]) =>
    /^LoadImage$/i.test(nonemptyString(node.class_type))
    && Object.prototype.hasOwnProperty.call(asRecord(node.inputs) ?? {}, 'image')
  );
  const audioNodes = Object.entries(workflow).filter(([, node]) =>
    /^LoadAudio$/i.test(nonemptyString(node.class_type))
    && Object.prototype.hasOwnProperty.call(asRecord(node.inputs) ?? {}, 'audio')
  );
  const prompt = findInput(workflow, LOCAL_H3_NODE, 'prompt') ?? findInput(workflow, /^CLIPTextEncode$/i, 'text');
  const detected = suggestTextSlots(workflow);
  const abc = suggestABCBindings(workflow);
  // The legacy single-prompt rule keeps its slot, and keeps it first, so image/video workflows that
  // only ever had a CLIPTextEncode or H3 prompt write `request.prompt` exactly where they used to.
  const legacySlot = prompt && !detected.some((slot) => textSlotKey(slot) === textSlotKey(prompt)) ? [prompt] : [];
  return {
    prompt,
    // `texts` here is a suggestion, not a stored binding. Callers that persist this result (the settings
    // workbench import path writes it into the bindings JSON) must strip `texts`, otherwise the detected
    // slots become explicit config and permanently disable detection for that provider.
    texts: [...legacySlot, ...detected, ...abc.texts],
    ...(abc.booleans.length ? { booleans: abc.booleans } : {}),
    seed: findInput(workflow, /^(?:KSampler|SelfLiftH3Sampler)$/i, 'seed')
      ?? findInput(workflow, /^(?:KSamplerAdvanced|RandomNoise)$/i, 'noise_seed'),
    width: findInput(workflow, LOCAL_H3_GEOMETRY_NODE, 'width') ?? findInput(workflow, /^EmptyLatentImage$/i, 'width'),
    height: findInput(workflow, LOCAL_H3_GEOMETRY_NODE, 'height') ?? findInput(workflow, /^EmptyLatentImage$/i, 'height'),
    duration: findInput(workflow, LOCAL_H3_GEOMETRY_NODE, 'length')
      ?? findInput(workflow, /^YuE2GenerateMusic$/i, 'max_duration'),
    images: imageNodes.map(([nodeId]) => ({ nodeId, input: 'image' })),
    videos: Object.entries(workflow).filter(([, node]) => node.class_type === 'VHS_LoadVideo'
      && Object.prototype.hasOwnProperty.call(asRecord(node.inputs) ?? {}, 'video'))
      .map(([nodeId]) => ({ nodeId, input: 'video' })),
    audios: audioNodes.map(([nodeId]) => ({ nodeId, input: 'audio' })),
  };
}

export function effectiveTextSlots(bindings: ComfyUIBindings): ComfyUITextBinding[] {
  if (bindings.texts?.length) return bindings.texts;
  return bindings.prompt ? [bindings.prompt] : [];
}

export function textSlotKey(binding: ComfyUIInputBinding): string {
  return `${binding.nodeId}.${binding.input}`;
}

/** Stored bindings merged with the auto-detected ones. Read-only consumers (the audio catalog) need
 *  this because detected slots are never persisted into `bindings`. */
export function effectiveBindings(config: ComfyUIConfig): ComfyUIBindings {
  const suggested = suggestComfyUIBindings(config.workflow);
  const result = { ...suggested };
  for (const key of ['prompt', 'seed', 'width', 'height', 'duration', 'resolution', 'aspectRatio'] as const) {
    if (config.bindings[key]) result[key] = config.bindings[key];
  }
  result.images = config.bindings.images.length ? config.bindings.images : suggested.images;
  result.audios = config.bindings.audios.length ? config.bindings.audios : suggested.audios;
  result.videos = config.bindings.videos?.length ? config.bindings.videos : suggested.videos;
  if (config.canvasReferencesOnly) {
    const slots = canvasReferenceSlots(config.workflow);
    result.images = slots.images;
    result.videos = slots.videos;
  }
  result.booleans = config.bindings.booleans
    ?? (config.mediaType === 'audio' ? suggested.booleans : undefined);
  // Detected slots are only trusted for audio, the one media type whose workflow shape cannot tell a
  // positive prompt from a negative one. Image and video keep the legacy prompt-or-throw behaviour
  // when bindings.texts is empty; explicit text mappings remain the user's responsibility.
  // An explicit prompt or texts mapping suppresses detection entirely.
  const useDetected = config.mediaType === 'audio' && !config.textBindingsExplicit;
  result.texts = useDetected
    ? config.bindings.texts?.length ? config.bindings.texts : suggested.texts
    : config.bindings.texts?.length ? config.bindings.texts : undefined;
  return result;
}

function bindingValue(config: ComfyUIConfig, binding: ComfyUIInputBinding | undefined): unknown {
  if (!binding) return undefined;
  const inputs = nodeInputs(config.workflow, binding.nodeId);
  if (!Object.prototype.hasOwnProperty.call(inputs, binding.input)) {
    throw new Error(`ComfyUI 节点 ${binding.nodeId} 没有输入字段 ${binding.input}。`);
  }
  return inputs[binding.input];
}

export function effectiveBooleanSlots(config: ComfyUIConfig, bindings = effectiveBindings(config)): ComfyUIBooleanBinding[] {
  return (bindings.booleans ?? []).map((slot) => {
    const existing = bindingValue(config, slot);
    return { ...slot, defaultValue: slot.defaultValue ?? (typeof existing === 'boolean' ? existing : false) };
  });
}

function canvasReferenceSlots(workflow: Record<string, JsonRecord>): { images: ComfyUIInputBinding[]; videos: ComfyUIInputBinding[] } {
  if (!isLocalH3Workflow(workflow)) throw new Error('仅使用画布参考素材模式目前支持本地 MiniMax H3 工作流。');
  const images: ComfyUIInputBinding[] = [];
  const videos: ComfyUIInputBinding[] = [];
  for (const node of Object.values(workflow)) {
    if (!LOCAL_H3_NODE.test(nonemptyString(node.class_type))) continue;
    for (const [field, value] of Object.entries(asRecord(node.inputs) ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (!/^ref_(?:images|videos|video_audios|audios)\./.test(field)) continue;
      const source = linkTarget(value);
      const image = /^ref_images\.ref_image_\d+$/.test(field);
      const video = /^ref_videos\.ref_video_\d+$/.test(field);
      const videoAudio = /^ref_video_audios\.ref_video_audio_\d+$/.test(field);
      const expected = image ? 'LoadImage' : 'VHS_LoadVideo';
      if ((!image && !video && !videoAudio) || !source || workflow[source]?.class_type !== expected
        || !Array.isArray(value) || value[1] !== (videoAudio ? 2 : 0)) {
        throw new Error(`画布参考槽 ${field} 需直接连接 LoadImage 或 VHS_LoadVideo；请断开独立音频及不支持的参考分支。`);
      }
      if (videoAudio) {
        const index = field.split('_').pop();
        if (linkTarget(asRecord(node.inputs)?.[`ref_videos.ref_video_${index}`]) !== source) {
          throw new Error('参考视频与对应声音必须连接同一个 VHS_LoadVideo 节点。');
        }
      }
      if (image || video) {
        const target = image ? images : videos;
        if (target.some(slot => slot.nodeId === source)) throw new Error('每个画布参考槽需使用独立的加载节点。');
        target.push({ nodeId: source, input: image ? 'image' : 'video' });
      }
    }
  }
  return { images, videos };
}

function pruneUnusedCanvasReferences(workflow: Record<string, JsonRecord>, config: ComfyUIConfig, imageCount: number, videos: string[]): void {
  const videoCount = videos.length;
  const slots = canvasReferenceSlots(workflow);
  const active = new Set([...slots.images.slice(0, imageCount), ...slots.videos.slice(0, videoCount)].map(slot => slot.nodeId));
  const silent = new Set(slots.videos.slice(0, videoCount).filter((_, index) => referenceVideoHasAudio(videos[index]) === false).map(slot => slot.nodeId));
  for (const node of Object.values(workflow)) {
    if (!LOCAL_H3_NODE.test(nonemptyString(node.class_type))) continue;
    const inputs = asRecord(node.inputs)!;
    for (const [field, value] of Object.entries(inputs)) {
      const source = linkTarget(value) ?? '';
      if (/^ref_(?:images|videos|video_audios|audios)\./.test(field) && (!active.has(source)
        || (field.startsWith('ref_video_audios.') && silent.has(source)))) delete inputs[field];
    }
  }
  // Submit only branches reachable from selected outputs, removing unused loaders and their filenames.
  const roots = config.outputNodeIds.length ? config.outputNodeIds : suggestComfyUIOutputNodes(workflow);
  if (!roots.length) throw new Error('仅使用画布参考素材模式需要选择输出节点。');
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id) || !workflow[id]) return;
    reachable.add(id);
    for (const value of Object.values(asRecord(workflow[id].inputs) ?? {})) {
      const upstream = linkTarget(value);
      if (upstream) visit(upstream);
    }
  };
  roots.forEach(visit);
  const unused = [...slots.images.slice(imageCount), ...slots.videos.slice(videoCount)];
  if (unused.some(slot => reachable.has(slot.nodeId))) throw new Error('未传入的参考加载节点仍被其它分支使用，请移除该分支或补齐画布素材。');
  if ([...reachable].some(id => /^(?:LoadImage|VHS_LoadVideo|LoadAudio)$/.test(nonemptyString(workflow[id].class_type)) && !active.has(id))) {
    throw new Error('输出分支含未映射的服务器素材，请移除该分支；仅使用画布参考素材模式不允许回退到服务器文件。');
  }
  for (const id of Object.keys(workflow)) if (!reachable.has(id)) delete workflow[id];
}

export function getComfyUIReferenceRequirements(config: ComfyUIConfig): { min: number; max: number } {
  const images = effectiveBindings(config).images;
  // A server-side filename is usable without a canvas replacement. Empty slots must be supplied in binding order.
  const min = config.canvasReferencesOnly ? 0 : images.reduce((required, binding, index) => nonemptyString(bindingValue(config, binding)) ? required : index + 1, 0);
  return { min, max: images.length };
}

export function getComfyUIAudioReferenceRequirements(config: ComfyUIConfig): { min: number; max: number } {
  const audios = effectiveBindings(config).audios;
  const min = audios.reduce((required, binding, index) => nonemptyString(bindingValue(config, binding)) ? required : index + 1, 0);
  return { min, max: audios.length };
}

export function getComfyUIVideoCapabilities(config: ComfyUIConfig): {
  inputSchema: VideoInputSchema;
  supportedDurations: string[];
  supportedResolutions: string[];
  supportedAspectRatios: string[];
} {
  const bindings = effectiveBindings(config);
  const h3 = isLocalH3Workflow(config.workflow);
  const refs = getComfyUIReferenceRequirements(config);
  const value = (binding: ComfyUIInputBinding | undefined) => bindingValue(config, binding);
  const dimension = `${value(bindings.width)}x${value(bindings.height)}`;
  return {
    inputSchema: {
      imageModes: ['reference'],
      images: { enabled: refs.max > 0, ...refs, roles: ['reference'], requireImageHost: false },
      video: { enabled: config.canvasReferencesOnly === true && (bindings.videos?.length ?? 0) > 0, min: 0,
        max: config.canvasReferencesOnly ? bindings.videos?.length ?? 0 : 0, field: config.canvasReferencesOnly ? 'reference_videos' : '' },
      audio: { enabled: false, min: 0, max: 0, field: '' },
    },
    supportedDurations: h3 && bindings.duration ? Array.from({ length: 11 }, (_, i) => String(i + 5))
      : bindings.duration ? [String(value(bindings.duration))] : ['workflow'],
    supportedResolutions: h3 && bindings.width && bindings.height ? ['768P']
      : bindings.resolution ? [String(value(bindings.resolution))]
        : /^\d+x\d+$/.test(dimension) ? [dimension] : ['workflow'],
    supportedAspectRatios: h3 && bindings.width && bindings.height ? Object.keys(H3_SIZES)
      : bindings.aspectRatio ? [String(value(bindings.aspectRatio))] : ['auto'],
  };
}

export function suggestComfyUIOutputNodes(workflowInput: unknown): string[] {
  const workflow = cloneWorkflow(workflowInput);
  return Object.entries(workflow)
    .filter(([, node]) => /(?:SaveGaussianSplat|SaveImage|SaveVideo|SaveAnimated|VideoCombine|SaveAudio|SaveAudioMP3|SaveAudioOpus|SaveAudioAdvanced|PreviewAudio)/i.test(nonemptyString(node.class_type)))
    .map(([nodeId]) => nodeId);
}

export function prepareComfyUIWorkflow(
  config: ComfyUIConfig,
  request: GenerateRequest,
  uploadedNames: string[] = [],
  uploadedAudioNames: string[] = [],
  uploadedVideoNames: string[] = [],
): Record<string, JsonRecord> {
  const workflow = cloneWorkflow(config.workflow);
  const bindings = effectiveBindings(config);
  // Validate every configured input before any upload, including an unused seed/image slot.
  for (const binding of Object.values(bindings)) {
    if (Array.isArray(binding)) binding.forEach((item) => bindingValue(config, item));
    else if (binding) bindingValue(config, binding);
  }
  const textSlots = effectiveTextSlots(bindings);
  // Audio workflows may legitimately have no text input at all; image/video ones still require a slot.
  if (textSlots.length === 0 && config.mediaType !== 'audio' && config.mediaType !== 'gaussian') {
    throw new Error('请选择 ComfyUI 提示词节点及其输入字段。');
  }
  const writeText = (slot: ComfyUITextBinding, value: string) => {
    if (!slot.preserveWhenEmpty || value.trim()) setInput(workflow, slot, value);
  };
  if (textSlots[0]) writeText(textSlots[0], request.prompt);
  const slotValues = asRecord(request.extra_params?.textSlotValues);
  if (slotValues) {
    for (const slot of textSlots) {
      const value = slotValues[textSlotKey(slot)];
      if (typeof value === 'string') writeText(slot, value);
    }
  }

  const booleanValues = asRecord(request.extra_params?.booleanSlotValues);
  for (const slot of effectiveBooleanSlots(config, bindings)) {
    const value = booleanValues?.[textSlotKey(slot)];
    if (value !== undefined && typeof value !== 'boolean') {
      throw new Error(`ComfyUI 开关 ${slot.label ?? textSlotKey(slot)} 必须是布尔值。`);
    }
    setInput(workflow, slot, value ?? slot.defaultValue ?? false);
  }

  const seedValue = Number(request.extra_params?.seed);
  if (bindings.seed && Number.isFinite(seedValue) && request.extra_params?.seed !== undefined) {
    setInput(workflow, bindings.seed, Math.floor(seedValue));
  }
  const h3 = isLocalH3Workflow(workflow);
  const nonImage = config.mediaType === 'video' || config.mediaType === 'audio' || h3;
  if (!config.canvasReferencesOnly && nonImage && (request.reference_videos?.length ?? 0) > 0) {
    throw new Error('ComfyUI 当前只支持画布参考图上传；视频和音频输入请在服务器工作流中配置。');
  }
  if (h3 && bindings.width && bindings.height) {
    const size = nonemptyString(request.size);
    const explicit = /^(\d+)x(\d+)$/i.exec(size);
    if (!explicit && request.aspect_ratio && request.aspect_ratio !== 'auto' && !H3_SIZES[request.aspect_ratio]) {
      throw new Error('本地 MiniMax H3 画幅比例未配置，请选择工作流支持的比例。');
    }
    const requestedDimensions = explicit ? [Number(explicit[1]), Number(explicit[2])]
      : H3_SIZES[request.aspect_ratio ?? ''];
    const workflowWidth = bindingValue(config, bindings.width);
    const workflowHeight = bindingValue(config, bindings.height);
    // Linked dimensions are evaluated by ComfyUI. An automatic canvas must preserve
    // those connections instead of coercing API links to NaN (or replacing them).
    const preserveLinkedDimensions = !requestedDimensions
      && (linkTarget(workflowWidth) !== null || linkTarget(workflowHeight) !== null);
    const [width, height] = requestedDimensions ?? [Number(workflowWidth), Number(workflowHeight)];
    if (!preserveLinkedDimensions && (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32
      || width % 32 !== 0 || height % 32 !== 0 || width * height > 768 * 1344)) {
      throw new Error('本地 MiniMax H3 画幅需为 32 的倍数，且总像素不超过 768×1344。');
    }
    if (!explicit && size && !['768P', 'workflow'].includes(size)) {
      throw new Error('本地 MiniMax H3 使用 768P 工作流画幅，不支持图片 1K/2K 档位。');
    }
    if (!preserveLinkedDimensions) {
      setInput(workflow, bindings.width, width);
      setInput(workflow, bindings.height, height);
    }
  } else if (config.mediaType !== 'audio' && config.mediaType !== 'gaussian' && (bindings.width || bindings.height)) {
    if (nonImage) {
      const pixels = /^(\d+)x(\d+)$/i.exec(request.size ?? '');
      if (pixels) {
        if (bindings.width) setInput(workflow, bindings.width, Number(pixels[1]));
        if (bindings.height) setInput(workflow, bindings.height, Number(pixels[2]));
      }
    } else {
      const geometry = resolveImageOutputGeometry({ aspectRatio: request.aspect_ratio,
        selectedSize: request.extra_params?.resolutionType ?? request.size, defaultTier: '1k' });
      if (!geometry.ok) throw new Error(geometry.error);
      if (geometry.width && bindings.width) setInput(workflow, bindings.width, geometry.width);
      if (geometry.height && bindings.height) setInput(workflow, bindings.height, geometry.height);
    }
  }
  const seconds = request.extra_params?.seconds ?? request.extra_params?.duration;
  if (bindings.duration && seconds !== undefined) {
    const number = Number(seconds);
    if (!Number.isFinite(number) || number <= 0) throw new Error('ComfyUI 时长必须为正数。');
    const frameDuration = h3 && bindings.duration.input === 'length'
      && LOCAL_H3_GEOMETRY_NODE.test(nonemptyString(workflow[bindings.duration.nodeId]?.class_type));
    if (frameDuration && (number < 5 || number > 15)) throw new Error('本地 MiniMax H3 时长范围为 5–15 秒。');
    setInput(workflow, bindings.duration, frameDuration ? Math.ceil((number * 24 - 5) / 17) * 17 + 5 : number);
  }
  if (bindings.resolution && request.size && request.size !== 'workflow') setInput(workflow, bindings.resolution, request.size);
  if (bindings.aspectRatio && request.aspect_ratio && request.aspect_ratio !== 'auto') setInput(workflow, bindings.aspectRatio, request.aspect_ratio);

  const referenceCount = request.reference_images?.length ?? 0;
  const requirements = getComfyUIReferenceRequirements(config);
  if (referenceCount < requirements.min) throw new Error(`工作流至少需要 ${requirements.min} 张画布参考图；请连接参考图或在工作流中填写服务器图片文件名。`);
  if (referenceCount > bindings.images.length) {
    throw new Error(`工作流只有 ${bindings.images.length} 个参考图输入，画布传入 ${referenceCount} 张；请增加 LoadImage 映射或减少参考图。`);
  }
  if (uploadedNames.length !== referenceCount) throw new Error('ComfyUI 参考图上传结果数量不匹配。');
  uploadedNames.forEach((name, index) => setInput(workflow, bindings.images[index], name));

  const audioCount = request.reference_audios?.length ?? 0;
  // Audio slots are only enforced for audio workflows, mirroring the media-type gate on detected text
  // slots: `effectiveBindings` detects `LoadAudio` in any workflow, so an unguarded rule would make an
  // empty audio slot block an image or video workflow that prepared fine before.
  if (config.mediaType === 'audio') {
    if (audioCount > 0 && bindings.audios.length === 0) {
      throw new Error('ComfyUI 工作流没有音频输入槽；请在服务器工作流中添加 LoadAudio 映射。');
    }
    const audioRequirements = getComfyUIAudioReferenceRequirements(config);
    if (audioCount < audioRequirements.min) throw new Error(`工作流至少需要 ${audioRequirements.min} 个参考音频；请连接音频卡片或在工作流中填写服务器音频文件名。`);
    if (audioCount > bindings.audios.length) {
      throw new Error(`工作流只有 ${bindings.audios.length} 个参考音频输入，画布传入 ${audioCount} 个；请增加 LoadAudio 映射或减少参考音频。`);
    }
    if (uploadedAudioNames.length !== audioCount) throw new Error('ComfyUI 参考音频上传结果数量不匹配。');
    uploadedAudioNames.forEach((name, index) => setInput(workflow, bindings.audios[index], name));
  } else if (audioCount > 0) {
    // Never drop supplied audio silently: a workflow that is not audio output cannot consume it.
    throw new Error('该工作流不是音频输出类型，不能传入参考音频。');
  }
  const videoCount = request.reference_videos?.length ?? 0;
  if (config.canvasReferencesOnly) {
    if (videoCount > (bindings.videos?.length ?? 0)) throw new Error('画布参考视频数量超过工作流的视频输入槽数量。');
    if (uploadedVideoNames.length !== videoCount) throw new Error('ComfyUI 参考视频上传结果数量不匹配。');
    uploadedVideoNames.forEach((name, index) => setInput(workflow, bindings.videos![index], name));
    pruneUnusedCanvasReferences(workflow, config, referenceCount, request.reference_videos ?? []);
  }
  return workflow;
}

export function validateComfyUIRequest(config: ComfyUIConfig, request: GenerateRequest): void {
  const count = request.reference_images?.length ?? 0;
  const audioCount = request.reference_audios?.length ?? 0;
  prepareComfyUIWorkflow(
    config,
    request,
    Array.from({ length: count }, (_, index) => `reference-${index + 1}.png`),
    Array.from({ length: audioCount }, (_, index) => `reference-audio-${index + 1}.mp3`),
    Array.from({ length: request.reference_videos?.length ?? 0 }, (_, index) => `reference-video-${index + 1}.mp4`),
  );
}

function uploadedImageName(payload: unknown): string {
  const record = asRecord(payload);
  const name = nonemptyString(record?.name);
  const subfolder = nonemptyString(record?.subfolder);
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error('ComfyUI 上传图片后未返回有效文件名。');
  }
  if (subfolder.split(/[\\/]/).some((segment) => segment === '..')) {
    throw new Error('ComfyUI 上传图片返回了无效子目录。');
  }
  return subfolder ? `${subfolder}/${name}` : name;
}

export async function submitComfyUIWorkflow(
  config: ComfyUIConfig,
  request: GenerateRequest,
  transport: ComfyUITransport,
): Promise<{ prompt_id: string }> {
  validateComfyUIRequest(config, request);
  for (const source of request.reference_videos ?? []) {
    if (!/^data:video\/(?:mp4|webm|quicktime|x-m4v);base64,[A-Za-z0-9+/=]+$/i.test(source)) {
      throw new Error('ComfyUI 参考视频必须先转换为本地视频 data URL。');
    }
  }
  const uploadedNames: string[] = [];
  for (const [index, source] of (request.reference_images ?? []).entries()) {
    if (!/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(source)) {
      throw new Error('ComfyUI 参考图必须先转换为本地 data URL，不能直接上传远程地址。');
    }
    const mimeType = source.slice(5, source.indexOf(';'));
    const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const response = await transport.multipart('/upload/image', {
      fields: [{ name: 'type', value: 'input' }],
      files: [{ name: 'image', fileName: `canvas-reference-${index + 1}.${extension}`, mimeType, dataUrl: source }],
    });
    uploadedNames.push(uploadedImageName(response));
  }
  const uploadedAudioNames: string[] = [];
  for (const [index, source] of (request.reference_audios ?? []).entries()) {
    if (!/^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(source)) {
      throw new Error('ComfyUI 参考音频必须先转换为本地 data URL，不能直接上传远程地址。');
    }
    const mimeType = source.slice(5, source.indexOf(';'));
    // ComfyUI's upload route only accepts the hardcoded `image` field, and its file type is never checked.
    const extension = mimeType.split('/')[1]?.replace('mpeg', 'mp3') || 'wav';
    const response = await transport.multipart('/upload/image', {
      fields: [{ name: 'type', value: 'input' }],
      files: [{ name: 'image', fileName: `canvas-audio-${index + 1}.${extension}`, mimeType, dataUrl: source }],
    });
    uploadedAudioNames.push(uploadedImageName(response));
  }
  const uploadedVideoNames: string[] = [];
  for (const [index, source] of (request.reference_videos ?? []).entries()) {
    const match = /^data:(video\/(?:mp4|webm|quicktime|x-m4v));base64,([A-Za-z0-9+/=]+)$/i.exec(source);
    if (!match) throw new Error('ComfyUI 参考视频必须先转换为本地视频 data URL。');
    const mimeType = match[1];
    const extension = mimeType.toLowerCase() === 'video/quicktime' ? 'mov' : mimeType.split('/')[1].replace('x-', '');
    const response = await transport.multipart('/upload/image', {
      fields: [{ name: 'type', value: 'input' }],
      files: [{ name: 'image', fileName: `canvas-reference-video-${index + 1}.${extension}`, mimeType, dataUrl: source }],
    });
    uploadedVideoNames.push(uploadedImageName(response));
  }
  const workflow = prepareComfyUIWorkflow(config, request, uploadedNames, uploadedAudioNames, uploadedVideoNames);
  const parsed = asRecord(await transport.json('/prompt', 'POST', { prompt: workflow }));
  const promptId = nonemptyString(parsed?.prompt_id);
  if (!promptId) {
    const detail = nonemptyString(asRecord(parsed?.error)?.message)
      || nonemptyString(parsed?.error)
      || '响应缺少 prompt_id';
    throw new Error(`ComfyUI 工作流提交失败：${detail}`);
  }
  return { prompt_id: promptId };
}

interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

function extensionsFor(mediaType: ComfyUIMediaType): Set<string> {
  if (mediaType === 'gaussian') return new Set(['ply']);
  if (mediaType === 'audio') return AUDIO_EXTENSIONS;
  return mediaType === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS;
}

function outputFile(value: unknown, mediaType: ComfyUIMediaType): ComfyOutputFile | null {
  const record = asRecord(value);
  const filename = nonemptyString(record?.filename);
  if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') return null;
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!extensionsFor(mediaType).has(extension)) return null;
  const subfolder = nonemptyString(record?.subfolder);
  if (subfolder.split(/[\\/]/).some((part) => part === '..')) return null;
  const type = nonemptyString(record?.type) || 'output';
  if (type !== 'output' && type !== 'temp') return null;
  return { filename, subfolder, type };
}

function findOutputFile(
  outputs: JsonRecord,
  nodeIds: string[],
  mediaType: ComfyUIMediaType,
): ComfyOutputFile | null {
  const candidates: ComfyOutputFile[] = [];
  for (const nodeId of nodeIds) {
    const nodeOutput = asRecord(outputs[nodeId]);
    if (!nodeOutput) continue;
    const preferredKeys = mediaType === 'gaussian' ? ['3d', 'files'] : mediaType === 'audio' ? ['audio', 'files']
      : mediaType === 'video' ? ['videos', 'gifs', 'files'] : ['images', 'gifs', 'files'];
    const keys = [
      ...preferredKeys,
      ...Object.keys(nodeOutput).filter((key) => !preferredKeys.includes(key)),
    ];
    for (const key of keys) {
      const files = nodeOutput[key];
      if (!Array.isArray(files)) continue;
      for (const value of files) {
        const file = outputFile(value, mediaType);
        if (file) candidates.push(file);
      }
    }
  }
  return candidates.find((file) => file.type === 'output') ?? candidates[0] ?? null;
}

function historyError(entry: JsonRecord): string | null {
  const status = asRecord(entry.status);
  const state = nonemptyString(status?.status_str ?? entry.status_str).toLowerCase();
  if (state !== 'error' && state !== 'failed') return null;
  const messages = status?.messages;
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  const detail = Array.isArray(last) ? asRecord(last[1]) : null;
  return nonemptyString(detail?.exception_message)
    || nonemptyString(detail?.exception_type)
    || 'ComfyUI 工作流执行失败。';
}

export function inspectComfyUIHistory(
  payload: unknown,
  promptId: string,
  config: ComfyUIConfig,
  mediaType: ComfyUIMediaType,
): { state: 'pending' | 'failed' | 'ready'; file?: ComfyOutputFile; error?: string } {
  const root = asRecord(payload);
  const entry = asRecord(root?.[promptId]) ?? (root?.outputs ? root : null);
  if (!entry) return { state: 'pending' };
  const error = historyError(entry);
  if (error) return { state: 'failed', error };
  const outputs = asRecord(entry.outputs) ?? {};
  const nodeIds = config.outputNodeIds.length > 0
    ? config.outputNodeIds
    : suggestComfyUIOutputNodes(config.workflow);
  const file = findOutputFile(outputs, nodeIds.length > 0 ? nodeIds : Object.keys(outputs), mediaType);
  if (file) return { state: 'ready', file };
  const status = asRecord(entry.status);
  if (status?.completed === true || nonemptyString(status?.status_str).toLowerCase() === 'success') {
    const label = mediaType === 'gaussian' ? '3DGS' : mediaType === 'image' ? '图片' : mediaType === 'audio' ? '音频' : '视频';
    return { state: 'failed', error: `ComfyUI 已完成，但所选输出节点没有 ${label}文件。` };
  }
  return { state: 'pending' };
}

export async function pollComfyUIWorkflow(
  config: ComfyUIConfig,
  promptId: string,
  mediaType: ComfyUIMediaType,
  transport: ComfyUITransport,
): Promise<string> {
  const startedAt = Date.now();
  let first = true;
  while (Date.now() - startedAt < config.pollTimeoutMs) {
    if (!first) await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));
    first = false;
    const payload = await transport.json(`/history/${encodeURIComponent(promptId)}`, 'GET');
    const result = inspectComfyUIHistory(payload, promptId, config, mediaType);
    if (result.state === 'failed') throw new ComfyUIExecutionError(result.error ?? 'ComfyUI 任务失败。');
    if (result.file) {
      return transport.url('/view', {
        filename: result.file.filename,
        subfolder: result.file.subfolder,
        type: result.file.type,
      });
    }
  }
  throw new Error(`ComfyUI 任务 ${promptId} 仍在运行；可稍后从生成任务恢复查询。`);
}

export async function checkComfyUIConnection(transport: ComfyUITransport): Promise<void> {
  try {
    await transport.json('/system_stats', 'GET');
  } catch {
    await transport.json('/queue', 'GET');
  }
}
