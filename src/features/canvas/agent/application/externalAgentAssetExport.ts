import { saveAudioSourceToPath, saveImageSourceToPath, saveVideoSourceToPath } from '@/commands/image';
import { buildCanvasAssetCatalog } from '@/features/canvas/application/canvasAssetCatalog';
import { useCanvasStore } from '@/stores/canvasStore';

export interface ExportedCanvasAsset {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  path: string;
}

/**
 * Copies one canvas asset's original bytes into the Hypit project's `imports/`
 * directory and returns the resulting path. Full-resolution originals only:
 * `asset.url` is the persisted original, `asset.previewUrl` is a downscaled
 * thumbnail and is never used here.
 */
export async function exportCanvasAsset(
  assetId: string,
  hypitProjectDir: string | null,
): Promise<ExportedCanvasAsset> {
  if (!hypitProjectDir || !hypitProjectDir.trim()) {
    throw new Error('The Hypit project directory is unavailable. Recreate the Canvas connection from the External Agent panel.');
  }
  const asset = buildCanvasAssetCatalog(useCanvasStore.getState().nodes)
    .find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error('The requested canvas asset no longer exists.');
  const target = `${hypitProjectDir.replace(/[\\/]+$/, '')}/imports/${asset.id}.${defaultExtension(asset.kind, asset.url)}`;
  const saved = asset.kind === 'image'
    ? await saveImageSourceToPath(asset.url, target)
    : asset.kind === 'video'
      ? await saveVideoSourceToPath(asset.url, target)
      : await saveAudioSourceToPath(asset.url, target);
  return { assetId: asset.id, kind: asset.kind, path: saved };
}

function defaultExtension(kind: ExportedCanvasAsset['kind'], url: string): string {
  const fromUrl = url.split('?')[0].split('#')[0].match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  return kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav';
}
