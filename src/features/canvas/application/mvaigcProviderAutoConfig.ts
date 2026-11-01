import type { CustomProviderConfig } from '@/stores/customProvidersStore';

/** Stable provider ids so re-saving updates the same entries in place. */
export const MVAIGC_IMAGE_PROVIDER_ID = 'mvaigc-image';
export const MVAIGC_VIDEO_PROVIDER_ID = 'mvaigc-video';

/**
 * The mvaigc.cn catalogue, transcribed from the live site
 * (`imgPlatform/getImgModel` and `videoPlatform/getVideoApi`). The site groups
 * its picker by `apiBrand` and sorts groups by `brandOrder`; the array order
 * below is the same order the site shows, so the first entry of each group is
 * also the first pickable model of that vendor.
 *
 * Resolution/ratio/duration lists are the site's real values, with the model's
 * own default tier moved to the front so a node that has never picked a value
 * lands on the same default the site uses.
 */
interface MvaigcModelSpec {
  /** mvaigc model key sent as `model` / `api`. */
  id: string;
  /** Display name shown in the picker. */
  label: string;
  brand: string;
  brandOrder: number;
  brandTag?: 'Recommend' | 'New' | 'Sale';
  resolutions: string[];
  aspectRatios: string[];
  /** Video only: integer seconds the model accepts. */
  durations?: string[];
  /** Reference slot limits (video only). */
  images?: number;
  videos?: number;
  audios?: number;
  /** Video only: mvaigc scenes the model supports. */
  scenes?: string[];
}

const seconds = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

/**
 * Move a model's default tier to the front: the picker takes
 * `supportedResolutions[0]` for a node that has never chosen a value.
 * Images default to 2K (mvaigc's own default for every image model); video
 * defaults to 720P when offered so a fresh node never lands on the priciest
 * tier, otherwise the site's `defaultResolution`.
 */
function orderedResolutions(resolutions: string[], preferred: string): string[] {
  if (!resolutions.includes(preferred)) return resolutions;
  return [preferred, ...resolutions.filter((value) => value !== preferred)];
}

const imageResolutions = (resolutions: string[]) => orderedResolutions(resolutions, '2K');
const videoResolutions = (resolutions: string[]) =>
  orderedResolutions(resolutions, resolutions.includes('720P') ? '720P' : '1080P');

const IMAGE_MODELS: MvaigcModelSpec[] = [
  {
    id: 'gpt_image2_5_sunburst',
    label: 'GPT-Image-2.5-Pro',
    brand: 'GPT',
    brandOrder: 0,
    brandTag: 'Recommend',
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '21:9'],
  },
  {
    id: 'gpt_image2_5_flare',
    label: 'GPT-Image-2.5-Fast',
    brand: 'GPT',
    brandOrder: 0,
    brandTag: 'Recommend',
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '21:9'],
  },
  {
    id: 'gpt_image2',
    label: 'GPT-Image-2',
    brand: 'GPT',
    brandOrder: 0,
    brandTag: 'Recommend',
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '21:9'],
  },
  {
    id: 'Nano-Banana-2_1',
    label: 'Nano-Banana-2.1',
    brand: 'Nano-Banana',
    brandOrder: 1,
    brandTag: 'New',
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
  {
    id: 'Nano-Banana',
    label: 'Nano-Banana-2',
    brand: 'Nano-Banana',
    brandOrder: 1,
    brandTag: 'New',
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
  {
    id: 'Nano-Banana-Pro',
    label: 'Nano-Banana-Pro',
    brand: 'Nano-Banana',
    brandOrder: 1,
    brandTag: 'New',
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
  {
    id: 'doubao5.0_Pro',
    label: 'Seedream-5.0-Pro',
    brand: 'Seedream',
    brandOrder: 2,
    resolutions: ['2K', '1K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
  {
    id: 'qwen3_0-Pro',
    label: 'Qwen-3.0-Pro',
    brand: 'Qwen',
    brandOrder: 3,
    resolutions: ['2K', '1K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
  {
    id: 'wan2_7_Image',
    label: 'WAN-2.7',
    brand: 'Qwen',
    brandOrder: 3,
    resolutions: ['2K', '1K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
  {
    id: 'wan2_7_Image-pro',
    label: 'WAN-2.7-Pro',
    brand: 'Qwen',
    brandOrder: 3,
    resolutions: ['2K', '1K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  },
];

const ALL_SCENES = ['start2video', 'start-end2video', 'reference2video'];
const FIRST_LAST_SCENES = ['start2video', 'start-end2video'];

const VIDEO_MODELS: MvaigcModelSpec[] = [
  {
    id: 'maas_seedance_2_5',
    label: 'Seedance-2.5',
    brand: 'Seedance',
    brandOrder: 0,
    brandTag: 'New',
    durations: seconds(4, 30),
    resolutions: ['720P', '480P', '1080P'],
    aspectRatios: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 30,
    videos: 10,
    audios: 10,
    scenes: ALL_SCENES,
  },
  {
    id: 'maas_seedance_2',
    label: 'Seedance-2.0',
    brand: 'Seedance',
    brandOrder: 0,
    brandTag: 'New',
    durations: seconds(4, 15),
    resolutions: ['720P', '480P', '1080P'],
    aspectRatios: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 9,
    videos: 3,
    audios: 3,
    scenes: ALL_SCENES,
  },
  {
    id: 'botsmart_seedance_2_fast',
    label: 'Seedance-2.0-Fast',
    brand: 'Seedance',
    brandOrder: 0,
    brandTag: 'New',
    durations: seconds(4, 15),
    resolutions: ['720P', '480P'],
    aspectRatios: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 9,
    videos: 3,
    audios: 3,
    scenes: ALL_SCENES,
  },
  {
    id: 'wan_3_prime',
    label: 'WAN-3.0-Prime(高速版)',
    brand: 'WAN',
    brandOrder: 1,
    brandTag: 'Recommend',
    durations: seconds(2, 30),
    resolutions: ['1080P', '480P', '720P'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 10,
    videos: 5,
    audios: 5,
    scenes: ALL_SCENES,
  },
  {
    id: 'wan_3',
    label: 'WAN-3.0',
    brand: 'WAN',
    brandOrder: 1,
    brandTag: 'Recommend',
    durations: seconds(2, 30),
    resolutions: ['1080P', '480P', '720P'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 10,
    videos: 5,
    audios: 5,
    scenes: ALL_SCENES,
  },
  {
    id: 'happyhorse_1',
    label: 'HappyHorse-1.1',
    brand: 'WAN',
    brandOrder: 1,
    brandTag: 'Recommend',
    durations: seconds(3, 15),
    resolutions: ['720P', '1080P'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 5,
    scenes: ALL_SCENES,
  },
  {
    id: 'minimax_h3',
    label: 'MiniMax-H3',
    brand: 'MiniMax',
    brandOrder: 2,
    durations: seconds(4, 15),
    resolutions: ['2K', '768P'],
    aspectRatios: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 9,
    videos: 3,
    audios: 3,
    scenes: ALL_SCENES,
  },
  {
    id: 'vidu_q4',
    label: 'Vidu-Q4-Preview',
    brand: 'Vidu',
    brandOrder: 3,
    brandTag: 'New',
    durations: seconds(3, 16),
    resolutions: ['1080P', '540P', '720P', '2K', '4K'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    images: 15,
    audios: 3,
    scenes: ALL_SCENES,
  },
  {
    id: 'kling_v3',
    label: 'kling-v3',
    brand: 'Kling',
    brandOrder: 4,
    durations: seconds(3, 15),
    resolutions: ['1080P'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    scenes: FIRST_LAST_SCENES,
  },
  {
    id: 'kling_v3_omni',
    label: 'kling-v3-omni',
    brand: 'Kling',
    brandOrder: 4,
    durations: seconds(3, 15),
    resolutions: ['1080P'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    images: 7,
    scenes: ['reference2video'],
  },
  {
    id: 'veo_3_1',
    label: 'Veo-3.1',
    brand: 'Veo',
    brandOrder: 5,
    durations: ['8'],
    resolutions: ['1080P'],
    aspectRatios: ['16:9', '9:16'],
    images: 3,
    scenes: ALL_SCENES,
  },
  {
    id: 'veo_3_1_fast',
    label: 'Veo-3.1-Fast',
    brand: 'Veo',
    brandOrder: 5,
    durations: ['8'],
    resolutions: ['1080P'],
    aspectRatios: ['16:9', '9:16'],
    scenes: FIRST_LAST_SCENES,
  },
];

function modelBrands(specs: MvaigcModelSpec[]): Record<string, { brand: string; order: number; tag?: string }> {
  return Object.fromEntries(specs.map((spec) => [
    spec.id,
    spec.brandTag
      ? { brand: spec.brand, order: spec.brandOrder, tag: spec.brandTag }
      : { brand: spec.brand, order: spec.brandOrder },
  ]));
}

function modelDescriptions(specs: MvaigcModelSpec[]): Record<string, string> {
  return Object.fromEntries(specs.map((spec) => [spec.id, spec.label]));
}

function perModelCaps(
  specs: MvaigcModelSpec[],
  orderResolutions: (resolutions: string[]) => string[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(specs.map((spec) => [
    spec.id,
    {
      resolutions: orderResolutions(spec.resolutions),
      aspectRatios: spec.aspectRatios,
      ...(spec.durations ? { durations: spec.durations } : {}),
      ...(spec.images !== undefined ? { images: spec.images } : {}),
      ...(spec.videos !== undefined ? { videos: spec.videos } : {}),
      ...(spec.audios !== undefined ? { audios: spec.audios } : {}),
    },
  ]));
}

/**
 * Build the two OSC custom providers that point at the built-in mvaigc proxy.
 * The image provider uses the declarative `asyncTask` poll contract; the video
 * provider uses the separate `video*` poll fields OSC's video gateway reads.
 */
export function buildMvaigcProviders(port: number, credentials: string): CustomProviderConfig[] {
  const baseUrl = `http://127.0.0.1:${port}`;

  const image: CustomProviderConfig = {
    id: MVAIGC_IMAGE_PROVIDER_ID,
    label: 'mvaigc 图片',
    mediaType: 'image',
    baseUrl,
    endpointPath: '/v1/images/generations',
    modelListEndpointPath: '/v1/models',
    httpMethod: 'POST',
    apiKey: credentials,
    apiStyle: 'generic-json',
    responseFormat: 'generic',
    models: IMAGE_MODELS.map((spec) => spec.id),
    supportsWebSearch: false,
    supportedResolutions: ['1K', '2K', '4K'],
    extraParams: {
      supportedRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      modelBrands: modelBrands(IMAGE_MODELS),
      modelDescriptions: modelDescriptions(IMAGE_MODELS),
      perModel: perModelCaps(IMAGE_MODELS, imageResolutions),
      asyncTask: {
        enabled: true,
        taskIdPath: 'id',
        resultEndpointPath: '/v1/tasks/{taskId}',
        resultMethod: 'GET',
        imagePath: 'output[0].url',
        statusPath: 'status',
        pendingValues: ['processing'],
        successValues: ['succeeded'],
        failedValues: ['failed'],
        errorPath: 'error.message',
        intervalMs: 2000,
        timeoutMs: 900000,
      },
    },
    note: '由 mvaigc 设置面板自动生成：本地反代 → mvaigc.cn',
  };

  const video: CustomProviderConfig = {
    id: MVAIGC_VIDEO_PROVIDER_ID,
    label: 'mvaigc 视频',
    mediaType: 'video',
    baseUrl,
    endpointPath: '/v1/videos',
    modelListEndpointPath: '/v1/models',
    httpMethod: 'POST',
    apiKey: credentials,
    apiStyle: 'generic-json',
    responseFormat: 'generic',
    models: VIDEO_MODELS.map((spec) => spec.id),
    supportsWebSearch: false,
    supportedResolutions: ['720P', '1080P'],
    extraParams: {
      supportedRatios: ['16:9', '9:16', '1:1'],
      supportedDurations: [5, 10],
      modelBrands: modelBrands(VIDEO_MODELS),
      modelDescriptions: modelDescriptions(VIDEO_MODELS),
      perModel: perModelCaps(VIDEO_MODELS, videoResolutions),
      modelScenes: Object.fromEntries(VIDEO_MODELS.map((spec) => [spec.id, spec.scenes ?? []])),
      // The local proxy accepts JSON only; without this OSC defaults video
      // providers to multipart and every submit fails with HTTP 415.
      videoRequestBodyMode: 'json',
      videoTaskIdPath: 'id',
      videoStatusEndpointPath: '/v1/tasks/{taskId}',
      videoStatusPath: 'status',
      videoPendingValues: ['processing'],
      videoSuccessValues: ['succeeded'],
      videoFailedValues: ['failed'],
      responseVideoPath: 'output[0].url',
      videoErrorPath: 'error.message',
      videoPollIntervalMs: 2000,
      videoPollTimeoutMs: 900000,
    },
    note: '由 mvaigc 设置面板自动生成：本地反代 → mvaigc.cn',
  };

  return [image, video];
}

interface ProviderStoreActions {
  updateProvider: (id: string, patch: Partial<CustomProviderConfig>) => void;
  addProvider: (provider: CustomProviderConfig) => void;
  hasProvider: (id: string) => boolean;
}

/**
 * Register the mvaigc image/video providers: add them on first save, update
 * them in place afterwards (stable ids), so a port/credential change never
 * accumulates duplicates.
 */
export function applyMvaigcProviders(
  port: number,
  credentials: string,
  actions: ProviderStoreActions,
): void {
  const providers = buildMvaigcProviders(port, credentials);
  providers.forEach((provider) => {
    if (actions.hasProvider(provider.id)) {
      actions.updateProvider(provider.id, provider);
    } else {
      actions.addProvider(provider);
    }
  });
}

/**
 * Refresh the registered providers from the stored credentials on launch, so
 * a catalogue update reaches users who configured mvaigc once and never reopen
 * the settings panel.
 */
export function syncMvaigcProvidersFromSettings(
  settings: { account: string; password: string; port: number },
  actions: ProviderStoreActions,
): void {
  const account = settings.account.trim();
  const password = settings.password.trim();
  if (!account || !password) {
    return;
  }
  applyMvaigcProviders(settings.port, `${account}:${password}`, actions);
}

