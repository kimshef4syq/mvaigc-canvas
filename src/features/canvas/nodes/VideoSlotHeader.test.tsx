import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { VideoSlotHeader } from './VideoSlotHeader';
import { videoModeInputSchema } from '@/features/canvas/application/videoModes';

describe('VideoSlotHeader', () => {
  it('frames mode shows first + last frame labels and the swap button', () => {
    const html = renderToStaticMarkup(<VideoSlotHeader schema={videoModeInputSchema('frames')} />);
    expect(html).toContain('video-slot-labels');
    expect(html).toContain('node.aiVideo.slotFirstFrame');
    expect(html).toContain('node.aiVideo.slotLastFrame');
    expect(html).toContain('video-swap-first-last');
  });

  it('frames mode labels stay 首帧/尾帧 regardless of swap (text never flips)', () => {
    const html = renderToStaticMarkup(<VideoSlotHeader schema={videoModeInputSchema('frames')} />);
    const first = html.indexOf('node.aiVideo.slotFirstFrame');
    const last = html.indexOf('node.aiVideo.slotLastFrame');
    expect(first).toBeLessThan(last); // 槽1=首帧，槽2=尾帧，固定不变
  });

  it('image mode shows only the first-frame label, no swap button', () => {
    const html = renderToStaticMarkup(<VideoSlotHeader schema={videoModeInputSchema('image')} />);
    expect(html).toContain('node.aiVideo.slotFirstFrame');
    expect(html).not.toContain('node.aiVideo.slotLastFrame');
    expect(html).not.toContain('video-swap-first-last');
  });

  it('reference mode shows image/video/audio group labels', () => {
    const html = renderToStaticMarkup(<VideoSlotHeader schema={videoModeInputSchema('reference')} />);
    expect(html).toContain('node.aiVideo.slotReferenceImage');
    expect(html).toContain('node.aiVideo.slotReferenceVideo');
    expect(html).toContain('node.aiVideo.slotReferenceAudio');
  });

  it('text mode renders nothing', () => {
    const html = renderToStaticMarkup(<VideoSlotHeader schema={videoModeInputSchema('text')} />);
    expect(html).toBe('');
  });
});
