import { persistVideoSource } from '@/commands/image';
import { persistImageLocally, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { VideoNodeData } from '@/features/canvas/domain/canvasNodes';

const DEFAULT_VIDEO_ASPECT_RATIO = '16:9';
const VIDEO_METADATA_TIMEOUT_MS = 8000;
const VIDEO_THUMBNAIL_TIMEOUT_MS = 8000;
const VIDEO_THUMBNAIL_MAX_DIMENSION = 512;

interface VideoFileMetadata {
  aspectRatio: string;
  durationSeconds: number | null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read video file'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      result ? resolve(result) : reject(new Error('Failed to read video file'));
    };
    reader.readAsDataURL(file);
  });
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function formatVideoAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DEFAULT_VIDEO_ASPECT_RATIO;
  }

  const divisor = greatestCommonDivisor(width, height);
  const ratioWidth = Math.max(1, Math.round(width / divisor));
  const ratioHeight = Math.max(1, Math.round(height / divisor));
  return `${ratioWidth}:${ratioHeight}`;
}

function readVideoSourceMetadata(source: string): Promise<VideoFileMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let isDone = false;
    const displaySource = resolveImageDisplayUrl(source);

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    const finish = (metadata: VideoFileMetadata) => {
      if (isDone) {
        return;
      }
      isDone = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(metadata);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
        durationSeconds: null,
      });
    }, VIDEO_METADATA_TIMEOUT_MS);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null;
      finish({
        aspectRatio: formatVideoAspectRatio(video.videoWidth, video.videoHeight),
        durationSeconds: duration,
      });
    };
    video.onerror = () => {
      finish({
        aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
        durationSeconds: null,
      });
    };
    video.src = displaySource;
  });
}

function readVideoFileMetadata(file: File): Promise<VideoFileMetadata> {
  const objectUrl = URL.createObjectURL(file);
  return readVideoSourceMetadata(objectUrl).finally(() => {
    URL.revokeObjectURL(objectUrl);
  });
}

// A video node shows its first frame as the poster so the canvas is readable at
// a glance after a reload. `thumbnailUrl` is a persisted media value (see
// projectMedia), so the frame is written to a local image file, not kept as an
// inline data URL. Best-effort: a null result just leaves the node without a
// poster.
export async function captureVideoThumbnail(source: string): Promise<string | null> {
  const video = document.createElement('video');
  const displaySource = resolveImageDisplayUrl(source);

  try {
    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      const finish = (error?: Error) => {
        if (isDone) {
          return;
        }
        isDone = true;
        window.clearTimeout(timeoutId);
        error ? reject(error) : resolve();
      };
      const timeoutId = window.setTimeout(
        () => finish(new Error('Video thumbnail capture timed out')),
        VIDEO_THUMBNAIL_TIMEOUT_MS
      );

      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = () => finish();
      video.onerror = () => finish(new Error('Failed to load video for thumbnail'));
      video.src = displaySource;
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      return null;
    }

    const scale = Math.min(1, VIDEO_THUMBNAIL_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await persistImageLocally(canvas.toDataURL('image/jpeg', 0.85));
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function fileNameFromSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const pathname = decodeURIComponent(parsed.pathname || '');
    return pathname.split(/[\\/]/).filter(Boolean).pop() || null;
  } catch {
    return trimmed.split(/[\\/]/).filter(Boolean).pop() || null;
  }
}

function buildUploadedVideoNodeData(
  localVideoUrl: string,
  metadata: VideoFileMetadata,
  sourceFileName: string | null,
  thumbnailUrl: string | null
): Partial<VideoNodeData> {
  return {
    videoUrl: localVideoUrl,
    localVideoUrl,
    thumbnailUrl,
    aspectRatio: metadata.aspectRatio,
    durationSeconds: metadata.durationSeconds,
    sourceFileName,
    sourceType: 'upload',
    sourcePrompt: '',
    sourceReferenceCount: 0,
    generatedFileName: null,
    generatedNamingMode: 'default',
    generatedSequence: null,
    generatedDateStamp: null,
    isGenerating: false,
    generationStartedAt: null,
    generationElapsedMs: null,
    generationJobId: null,
    generationProviderId: null,
    generationClientSessionId: null,
    generationError: null,
    generationErrorDetails: null,
    generationRetryResultUrl: null,
    generationRetryRequestedAt: null,
  };
}

export async function prepareVideoNodeDataFromFile(file: File): Promise<Partial<VideoNodeData>> {
  const metadataPromise = readVideoFileMetadata(file);
  const localVideoUrl = await readFileAsDataUrl(file).then((dataUrl) => persistVideoSource(dataUrl));
  const [metadata, thumbnailUrl] = await Promise.all([
    metadataPromise,
    captureVideoThumbnail(localVideoUrl),
  ]);

  return buildUploadedVideoNodeData(localVideoUrl, metadata, file.name, thumbnailUrl);
}

export async function prepareVideoNodeDataFromSource(
  source: string,
  sourceFileName?: string | null
): Promise<Partial<VideoNodeData>> {
  const localVideoUrl = await persistVideoSource(source);
  const [metadata, thumbnailUrl] = await Promise.all([
    readVideoSourceMetadata(localVideoUrl),
    captureVideoThumbnail(localVideoUrl),
  ]);
  return buildUploadedVideoNodeData(
    localVideoUrl,
    metadata,
    sourceFileName?.trim() || fileNameFromSource(source),
    thumbnailUrl
  );
}
