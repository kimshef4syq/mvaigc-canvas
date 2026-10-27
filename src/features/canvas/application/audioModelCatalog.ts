import { useMemo } from 'react';

import {
  effectiveBindings,
  effectiveBooleanSlots,
  effectiveTextSlots,
  getComfyUIAudioReferenceRequirements,
  parseComfyUIConfig,
  type ComfyUITextBinding,
  type ComfyUIBooleanBinding,
} from '@/features/canvas/infrastructure/comfyuiGateway';
import { hasConfiguredCustomProvider } from '@/features/canvas/application/providerAvailability';
import {
  isAudioCustomProvider,
  useCustomProvidersStore,
  type CustomProviderConfig,
} from '@/stores/customProvidersStore';
import {
  useSettingsStore,
  type AudioGenerationSettings,
  type AudioModelConfig,
  type AudioProviderKind,
} from '@/stores/settingsStore';

/**
 * One pickable audio target. Built-in TTS entries keep their persisted
 * `AudioModelConfig` on `audioModel`; ComfyUI entries are derived from
 * `customProvidersStore` at read time and carry their workflow bindings
 * instead. Nothing here is written back to `audioGenerationSettings`.
 */
export interface AudioCatalogEntry {
  id: string;
  kind: 'builtin' | 'comfyui';
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  providerKind: AudioProviderKind;
  enabled: boolean;
  notReadyReason?: string;
  textSlots: ComfyUITextBinding[];
  booleanSlots?: ComfyUIBooleanBinding[];
  audioRefs: { min: number; max: number };
  extraParams: Record<string, unknown>;
  audioModel?: AudioModelConfig;
}

const NO_AUDIO_REFS = { min: 0, max: 0 };

export function buildAudioModelCatalog(
  audioSettings: AudioGenerationSettings,
  providers: readonly CustomProviderConfig[],
): AudioCatalogEntry[] {
  const entries: AudioCatalogEntry[] = audioSettings.models.map((model) => ({
    id: model.id,
    kind: 'builtin',
    providerId: 'builtin',
    providerLabel: '内置',
    modelId: model.id,
    modelLabel: model.name,
    providerKind: model.providerKind,
    enabled: model.enabled,
    textSlots: [],
    audioRefs: { ...NO_AUDIO_REFS },
    extraParams: model.extraParams ?? {},
    audioModel: model,
  }));

  for (const provider of providers) {
    if (
      !isAudioCustomProvider(provider)
      || provider.apiStyle !== 'comfyui'
      || !hasConfiguredCustomProvider(provider)
    ) {
      continue;
    }
    let textSlots: ComfyUITextBinding[] = [];
    let booleanSlots: ComfyUIBooleanBinding[] = [];
    let audioRefs: { min: number; max: number } = { ...NO_AUDIO_REFS };
    let notReadyReason: string | undefined;
    try {
      const config = parseComfyUIConfig(provider);
      // Both derivations stay inside the try: a stored binding can point at a node or input that is
      // not in the workflow, and `parseComfyUIConfig` does not validate binding node ids. Letting
      // that throw would escape this render-time derivation into the node's error boundary, which
      // is exactly the entry-dropping failure the `notReadyReason` path exists to prevent. Assign
      // only after both succeed, so a half-derived entry can never be published.
      const bindings = effectiveBindings(config);
      const derivedSlots = effectiveTextSlots(bindings);
      const derivedBooleanSlots = effectiveBooleanSlots(config, bindings);
      const derivedRefs = getComfyUIAudioReferenceRequirements(config);
      textSlots = derivedSlots;
      booleanSlots = derivedBooleanSlots;
      audioRefs = derivedRefs;
    } catch (error) {
      // A broken workflow must stay visible so the user can see why it cannot run.
      notReadyReason = error instanceof Error ? error.message : String(error);
    }
    for (const modelId of provider.models) {
      entries.push({
        id: `custom:${provider.id}:${modelId}`,
        kind: 'comfyui',
        providerId: provider.id,
        providerLabel: provider.label,
        modelId,
        modelLabel: modelId,
        providerKind: 'comfyui',
        enabled: true,
        ...(notReadyReason ? { notReadyReason } : {}),
        textSlots,
        booleanSlots,
        audioRefs,
        extraParams: { ...(provider.extraParams ?? {}), providerId: provider.id, modelId },
      });
    }
  }
  return entries;
}

export function useAudioModelCatalog(): AudioCatalogEntry[] {
  const audioSettings = useSettingsStore((state) => state.audioGenerationSettings);
  const customProviders = useCustomProvidersStore((state) => state.providers);
  return useMemo(
    () => buildAudioModelCatalog(audioSettings, customProviders),
    [audioSettings, customProviders],
  );
}
