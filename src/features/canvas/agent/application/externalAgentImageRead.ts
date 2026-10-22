import { buildCanvasAssetCatalog } from '@/features/canvas/application/canvasAssetCatalog';
import { imageUrlToDataUrl } from '@/features/canvas/application/imageData';
import { useCanvasStore } from '@/stores/canvasStore';

/** A bounded preview for MCP vision; full image bytes never enter receipts or activity logs. */
export async function readExternalCanvasImage(assetId: string) {
  const asset = buildCanvasAssetCatalog(useCanvasStore.getState().nodes).find((item) => item.id === assetId);
  if (!asset || asset.kind !== 'image') throw new Error('The requested canvas image no longer exists.');
  const dataUrl = await imageUrlToDataUrl(asset.previewUrl || asset.url);
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The canvas image could not be decoded.');
  const canvas = document.createElement('canvas');
  let edge = 1280;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image previews are unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
    if (data && data.length <= 180_000) {
      return {
        metadata: { assetId: asset.id, nodeId: asset.nodeId, title: asset.title,
          width: canvas.width, height: canvas.height, preview: true },
        canvasImage: { mimeType: 'image/jpeg' as const, data },
      };
    }
    edge = Math.floor(edge * 0.65);
  }
  throw new Error('The image preview exceeds the MCP output limit.');
}
