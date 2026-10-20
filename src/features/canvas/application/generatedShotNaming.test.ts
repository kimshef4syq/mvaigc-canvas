import { describe, expect, it } from 'vitest';
import { resolveNextGeneratedMediaSequence, resolveGeneratedShotTitle } from './generatedMediaNaming';
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';

describe('shot naming', () => {
  it('counts videos rendered on AI nodes, including concurrently started videos', () => {
    const nodes = [
      { id: 'a', type: CANVAS_NODE_TYPES.aiVideo, data: { generatedSequence: 1, isGenerating: true } },
      { id: 'b', type: CANVAS_NODE_TYPES.video, data: { generatedSequence: 2 } },
    ] as CanvasNode[];
    expect(resolveNextGeneratedMediaSequence('video', nodes)).toBe(3);
  });
  it('keeps authored storyboard order even when shot five completes before shot one', () => {
    expect(resolveGeneratedShotTitle('英雄定格', 5, 'video_001')).toBe('第05镜 · 英雄定格');
    expect(resolveGeneratedShotTitle('第01镜 · 旋钮锁合', 1, 'video_002')).toBe('第01镜 · 旋钮锁合');
    expect(resolveGeneratedShotTitle('稳定放汽', undefined, 'video_003')).toBe('稳定放汽');
    expect(resolveGeneratedShotTitle('AI 视频', undefined, 'video_004')).toBe('video_004');
  });
});
