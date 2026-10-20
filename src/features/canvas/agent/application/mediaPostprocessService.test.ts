import { describe, expect, it, vi } from 'vitest';
import {
  MediaPostprocessService,
} from './mediaPostprocessService';

describe('Media Postprocess Application Service (T11 & A20)', () => {
  it('executes media probe and returns verified streams and metadata', async () => {
    const service = new MediaPostprocessService();
    const receipt = await service.executeOperation({
      type: 'probe',
      assetId: 'asset-video-1',
    });

    expect(receipt.operationType).toBe('probe');
    expect(receipt.outputAssetId).toBe('asset-video-1');
    expect(receipt.probe.hasVideo).toBe(true);
    expect(receipt.probe.hasAudio).toBe(true);
    expect(receipt.probe.width).toBe(1920);
    expect(receipt.probe.height).toBe(1080);
    expect(receipt.measuredDurationSeconds).toBe(10.0);
  });

  it('A20: concatenates multiple videos in specified order and calculates total duration', async () => {
    const service = new MediaPostprocessService();
    const receipt = await service.executeOperation({
      type: 'concat',
      assetIds: ['asset-clip-1', 'asset-clip-2', 'asset-clip-3'],
      transition: 'cut',
      keepAudio: true,
    });

    expect(receipt.operationType).toBe('concat');
    expect(receipt.inputAssetIds).toEqual(['asset-clip-1', 'asset-clip-2', 'asset-clip-3']);
    expect(receipt.measuredDurationSeconds).toBe(15.0); // 3 * 5s
    expect(receipt.rollbackToken).toBeDefined();
    expect(receipt.outputAssetId).toMatch(/^asset-concat-/);
  });

  it('rejects concatenation with fewer than 2 inputs', async () => {
    const service = new MediaPostprocessService();
    await expect(
      service.executeOperation({
        type: 'concat',
        assetIds: ['only-one'],
        transition: 'cut',
        keepAudio: true,
      })
    ).rejects.toThrow('至少需要提供 2 个');
  });

  it('executes video trim and calculates exact duration delta', async () => {
    const service = new MediaPostprocessService();
    const receipt = await service.executeOperation({
      type: 'trim',
      assetId: 'asset-raw-1',
      startSeconds: 2.5,
      endSeconds: 7.8,
    });

    expect(receipt.operationType).toBe('trim');
    expect(receipt.measuredDurationSeconds).toBe(5.3);
    expect(receipt.rollbackToken).toBeDefined();
  });

  it('mixes primary voice and background audio with ducking and volume controls', async () => {
    const service = new MediaPostprocessService();
    const receipt = await service.executeOperation({
      type: 'mix',
      primaryAssetId: 'asset-vo-1',
      backgroundAssetId: 'asset-bgm-1',
      primaryVolume: 1.0,
      backgroundVolume: 0.25,
      ducking: true,
      fadeInSeconds: 1.0,
      fadeOutSeconds: 2.0,
    });

    expect(receipt.operationType).toBe('mix');
    expect(receipt.inputAssetIds).toEqual(['asset-vo-1', 'asset-bgm-1']);
    expect(receipt.outputAssetId).toMatch(/^asset-mixed-/);
  });

  it('executes subtitle burning after validating cues', async () => {
    const service = new MediaPostprocessService();
    const receipt = await service.executeOperation({
      type: 'burn-subtitles',
      videoAssetId: 'asset-video-1',
      subtitles: [
        { id: '1', startSeconds: 0.0, endSeconds: 2.0, text: '第一句台词' },
        { id: '2', startSeconds: 2.2, endSeconds: 5.0, text: '第二句台词' },
      ],
      fontSize: 24,
    });

    expect(receipt.operationType).toBe('burn-subtitles');
    expect(receipt.measuredDurationSeconds).toBeGreaterThanOrEqual(5.0);
    expect(receipt.rollbackToken).toBeDefined();
  });

  it('delegates overlay-approved-text to Tauri invoke when available', async () => {
    const tauriInvoke = vi.fn().mockResolvedValue('native-burned-output.mp4');
    const service = new MediaPostprocessService();

    const receipt = await service.executeOperation(
      {
        type: 'overlay-approved-text',
        videoAssetId: 'local-video.mp4',
        text: '关键信息提示',
        startSeconds: 0.5,
        endSeconds: 3.5,
        position: 'bottom',
      },
      { tauriInvoke }
    );

    expect(tauriInvoke).toHaveBeenCalledWith('burn_video_caption', {
      inputPath: 'local-video.mp4',
      text: '关键信息提示',
      startSeconds: 0.5,
      endSeconds: 3.5,
    });
    expect(receipt.outputAssetId).toBe('native-burned-output.mp4');
  });

  it('reuses cached receipt for identical operations without re-execution (idempotency)', async () => {
    const service = new MediaPostprocessService();
    const op = {
      type: 'scale' as const,
      assetId: 'asset-orig',
      width: 1280,
      height: 720,
    };

    const first = await service.executeOperation(op);
    const second = await service.executeOperation(op);

    expect(first.receiptId).toBe(second.receiptId);
    expect(first.outputAssetId).toBe(second.outputAssetId);
  });

  it('validates voice reference duration measurement strictly', () => {
    const service = new MediaPostprocessService();

    const validCheck = service.measureAndValidateVoiceReference('voice-anchor-1', 3.5);
    expect(validCheck.valid).toBe(true);

    const invalidCheck = service.measureAndValidateVoiceReference('voice-anchor-2', 1.8);
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.error).toContain('必须严格大于 2.0 秒');
  });
});
