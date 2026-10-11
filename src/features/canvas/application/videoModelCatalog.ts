import { useMemo } from 'react';
import { getComfyUIVideoCapabilities, isLocalH3Workflow, parseComfyUIConfig } from '@/features/canvas/infrastructure/comfyuiGateway';

import {
  AGNES_PROVIDER_DEFAULTS,
  isVideoCustomProvider,
  useCustomProvidersStore,
  type CustomProviderConfig,
} from '@/stores/customProvidersStore';
import { hasCustomProviderCredential } from '@/features/canvas/application/providerAvailability';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  defaultVideoInputSchemaForProviderKind,
  resolveVideoInputSchemaFromExtraParams,
  type VideoInputSchema,
} from './videoInputSchema';
import {
  DREAMINA_MULTIFRAME_CAPABILITY,
  listDreaminaVideoModels,
  type DreaminaVideoModelCapability,
} from './dreaminaCapabilities';

export interface VideoCatalogEntry {
  id: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  defaultExtraParams?: Record<string, unknown>;
  supportedDurations: string[];
  supportedResolutions: string[];
  supportedAspectRatios: string[];
  /** Per-model reference slot limits declared via `extraParams.perModel`. Absent = not declared. */
  supportedImageCount?: number;
  supportedVideoCount?: number;
  supportedAudioCount?: number;
  inputSchema: VideoInputSchema;
  usable: boolean;
  notReadyReason?: string;
}

export interface VideoModelConfigValue {
  entryId: string;
  duration: string;
  resolution: string;
  aspectRatio?: string;
  extraParams?: Record<string, unknown>;
}

const DEFAULT_DURATIONS = ['4', '8', '12'];
const AGNES_DURATIONS = Array.from({ length: 18 }, (_, index) => String(index + 1));
const DEFAULT_RESOLUTIONS = ['1280x720', '720x1280', '1024x1024'];
const DEFAULT_ASPECT_RATIOS = ['16:9', '9:16', '1:1'];
const AGNES_VIDEO_RESOLUTIONS = [...AGNES_PROVIDER_DEFAULTS.videoResolutions];
const AGNES_DEFAULT_DURATION = '5';
interface DreaminaProviderStatus {
  loggedIn: boolean;
}

function uniqueStrings(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) {
    return fallback;
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    normalized.push(text);
  });
  return normalized.length > 0 ? normalized : fallback;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  const normalized = uniqueStrings(value, []);
  return normalized.length > 0 ? normalized : undefined;
}

export interface PerModelCapabilities {
  durations?: string[];
  resolutions?: string[];
  aspectRatios?: string[];
  images?: number;
  videos?: number;
  audios?: number;
}

/**
 * Read a model's capability override from `extraParams.perModel[modelId]`.
 * Every field is optional; absent or invalid fields are omitted so the caller
 * falls back to the provider-level declaration.
 */
export function resolvePerModelCapabilities(
  provider: CustomProviderConfig,
  modelId: string
): PerModelCapabilities {
  const perModel = provider.extraParams?.perModel;
  if (!perModel || typeof perModel !== 'object' || Array.isArray(perModel)) {
    return {};
  }
  const raw = (perModel as Record<string, unknown>)[modelId];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const result: PerModelCapabilities = {};
  const durations = stringArrayOrUndefined(record.durations);
  if (durations) result.durations = durations;
  const resolutions = stringArrayOrUndefined(record.resolutions);
  if (resolutions) result.resolutions = resolutions;
  const aspectRatios = stringArrayOrUndefined(record.aspectRatios);
  if (aspectRatios) result.aspectRatios = aspectRatios;
  const images = positiveIntegerOrUndefined(record.images);
  if (images !== undefined) result.images = images;
  const videos = positiveIntegerOrUndefined(record.videos);
  if (videos !== undefined) result.videos = videos;
  const audios = positiveIntegerOrUndefined(record.audios);
  if (audios !== undefined) result.audios = audios;
  return result;
}

function resolveModelDescription(
  provider: CustomProviderConfig,
  modelId: string
): string | undefined {
  const descriptions = provider.extraParams?.modelDescriptions;
  if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions)) {
    return undefined;
  }
  const value = (descriptions as Record<string, unknown>)[modelId];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function buildVideoModelCatalog(
  customProviders: readonly CustomProviderConfig[],
  agnesApiKey = '',
  dreaminaStatus?: DreaminaProviderStatus | null
): VideoCatalogEntry[] {
  const entries: VideoCatalogEntry[] = [];
  for (const provider of customProviders) {
    if (!isVideoCustomProvider(provider)) {
      continue;
    }

    const models = provider.models.length > 0 ? provider.models : ['sora-2'];
    const supportedDurations = uniqueStrings(
      provider.extraParams?.supportedDurations,
      DEFAULT_DURATIONS
    );
    const supportedResolutions = uniqueStrings(
      provider.supportedResolutions ?? provider.extraParams?.supportedResolutions,
      DEFAULT_RESOLUTIONS
    );
    const supportedAspectRatios = uniqueStrings(
      provider.extraParams?.supportedRatios,
      DEFAULT_ASPECT_RATIOS
    );
    const hasBaseUrl = Boolean(provider.baseUrl?.trim());
    const hasCredential = hasCustomProviderCredential(provider);
    let comfyCapabilities: ReturnType<typeof getComfyUIVideoCapabilities> | undefined;
    let comfyError = '';
    if (provider.apiStyle === 'comfyui') {
      try {
        const config = parseComfyUIConfig(provider);
        comfyCapabilities = getComfyUIVideoCapabilities(config);
        if (config.bindings.duration && !isLocalH3Workflow(config.workflow)) {
          comfyCapabilities.supportedDurations = uniqueStrings(provider.extraParams?.supportedDurations, comfyCapabilities.supportedDurations);
        }
        if (config.bindings.resolution) comfyCapabilities.supportedResolutions = uniqueStrings(provider.supportedResolutions, comfyCapabilities.supportedResolutions);
        if (config.bindings.aspectRatio) comfyCapabilities.supportedAspectRatios = uniqueStrings(provider.extraParams?.supportedRatios, comfyCapabilities.supportedAspectRatios);
      }
      catch (error) { comfyError = error instanceof Error ? error.message : String(error); }
    }
    const usable = hasBaseUrl && hasCredential && !comfyError;

    for (const modelId of models) {
      const perModel = resolvePerModelCapabilities(provider, modelId);
      const inputSchema = resolveVideoInputSchemaFromExtraParams(provider.extraParams, modelId);
      const defaults = provider.extraParams?.defaultRequestParams;
      const imageMode = defaults && typeof defaults === 'object' && !Array.isArray(defaults)
        ? (defaults as Record<string, unknown>).imageMode
        : undefined;
      const defaultExtraParams = typeof imageMode === 'string' && inputSchema.imageModes?.some((mode) => mode === imageMode)
        ? { imageMode }
        : undefined;
      entries.push({
        id: `custom:${provider.id}:${modelId}`,
        providerId: provider.id,
        providerLabel: provider.label,
        modelId,
        modelLabel: resolveModelDescription(provider, modelId) ?? modelId,
        supportedDurations: perModel.durations ?? supportedDurations,
        supportedResolutions: perModel.resolutions ?? supportedResolutions,
        supportedAspectRatios: perModel.aspectRatios ?? supportedAspectRatios,
        ...(perModel.images !== undefined ? { supportedImageCount: perModel.images } : {}),
        ...(perModel.videos !== undefined ? { supportedVideoCount: perModel.videos } : {}),
        ...(perModel.audios !== undefined ? { supportedAudioCount: perModel.audios } : {}),
        inputSchema,
        ...(defaultExtraParams ? { defaultExtraParams } : {}),
        ...(comfyCapabilities ?? {}),
        usable,
        notReadyReason: usable
          ? undefined
          : comfyError || (hasBaseUrl ? '请在「我的配置」里填入 API Key' : '请在「我的配置」里填入 API 根地址'),
      });
    }
  }
  if (agnesApiKey.trim()) {
    for (const [modelId, modelLabel] of [
      [AGNES_PROVIDER_DEFAULTS.models.video20, 'Agnes Video v2.0'],
    ] as const) {
      entries.push({
        id: `agnes:video:${modelId}`,
        providerId: 'agnes',
        providerLabel: 'Agnes',
        modelId,
        modelLabel,
        supportedDurations: AGNES_DURATIONS,
        supportedResolutions: AGNES_VIDEO_RESOLUTIONS,
        supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
        inputSchema: defaultVideoInputSchemaForProviderKind('agnes-video'),
        usable: true,
      });
    }
  }
  if (dreaminaStatus?.loggedIn) {
    const dreaminaProvider = '即梦 CLI';
    const appendDreaminaModels = (
      command: DreaminaVideoModelCapability['command'],
      entryKind: string,
      label: string,
    ) => {
      for (const capability of listDreaminaVideoModels(command)) {
        entries.push({
          id: `dreamina:${entryKind}:${capability.model}`,
          providerId: 'dreamina',
          providerLabel: dreaminaProvider,
          modelId: capability.model,
          modelLabel: `${label} · ${capability.model}`,
          defaultExtraParams: { modelVersion: capability.model },
          supportedDurations: [...capability.durations],
          supportedResolutions: [...capability.resolutions],
          supportedAspectRatios: [...capability.aspectRatios],
          inputSchema: capability.inputSchema,
          usable: true,
        });
      }
    };

    appendDreaminaModels('multimodal2video', 'all-reference-video', '全能参考成片');
    appendDreaminaModels('text2video', 'text-video', '文生视频');
    appendDreaminaModels('image2video', 'image-video', '图生视频');
    appendDreaminaModels('frames2video', 'frames-video', '首尾帧成片');
    entries.push({
      id: 'dreamina:multi-frame-video',
      providerId: 'dreamina',
      providerLabel: dreaminaProvider,
      modelId: 'multi-frame-video',
      modelLabel: '多帧成片 · 智能多图',
      supportedDurations: [...DREAMINA_MULTIFRAME_CAPABILITY.durations],
      supportedResolutions: [...DREAMINA_MULTIFRAME_CAPABILITY.resolutions],
      supportedAspectRatios: [...DREAMINA_MULTIFRAME_CAPABILITY.aspectRatios],
      inputSchema: DREAMINA_MULTIFRAME_CAPABILITY.inputSchema,
      usable: true,
    });
  }
  return entries;
}

export function useVideoModelCatalog(): VideoCatalogEntry[] {
  const customProviders = useCustomProvidersStore((state) => state.providers);
  const agnesApiKey = useSettingsStore((state) => state.agnesApiKey);
  const dreaminaStatus = useSettingsStore((state) => state.dreaminaStatus);
  return useMemo(
    () => buildVideoModelCatalog(customProviders, agnesApiKey, dreaminaStatus),
    [agnesApiKey, customProviders, dreaminaStatus]
  );
}

export function resolveVideoModelConfig(
  catalog: readonly VideoCatalogEntry[],
  current?: VideoModelConfigValue | null
): VideoModelConfigValue | undefined {
  const currentEntry = current
    ? catalog.find((entry) => entry.id === current.entryId && entry.usable)
    : undefined;
  if (current?.entryId.startsWith('dreamina:') && !currentEntry) {
    return undefined;
  }
  const entry = currentEntry ?? catalog.find((candidate) => candidate.usable);
  if (!entry) {
    return undefined;
  }
  const defaultDuration = entry.providerId === 'agnes' && entry.supportedDurations.includes(AGNES_DEFAULT_DURATION)
    ? AGNES_DEFAULT_DURATION
    : entry.supportedDurations[0] ?? DEFAULT_DURATIONS[0];
  const duration = current?.duration && entry.supportedDurations.includes(current.duration)
    ? current.duration
    : defaultDuration;
  const resolution = current?.resolution && entry.supportedResolutions.includes(current.resolution)
    ? current.resolution
    : entry.supportedResolutions[0] ?? DEFAULT_RESOLUTIONS[0];
  const aspectRatio = current?.aspectRatio && entry.supportedAspectRatios.includes(current.aspectRatio)
    ? current.aspectRatio
    : entry.supportedAspectRatios[0] ?? DEFAULT_ASPECT_RATIOS[0];
  return {
    entryId: entry.id,
    duration,
    resolution,
    aspectRatio,
    extraParams: {
      ...(entry.defaultExtraParams ?? {}),
      ...(current?.extraParams ?? {}),
    },
  };
}
