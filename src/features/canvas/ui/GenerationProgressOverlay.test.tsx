import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationProgressOverlay } from './GenerationProgressOverlay';
import { CanvasVideoPlayer } from './CanvasVideoPlayer';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => vi.useRealTimers());

describe('video generation progress', () => {
  it('fills the whole node left to right using elapsed generation time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(31000);
    const html = renderToStaticMarkup(<GenerationProgressOverlay startedAt={1000} durationMs={60000} />);
    expect(html).toContain('absolute inset-0');
    expect(html).toContain('origin-left');
    expect(html).toContain('scaleX(0.5)');
    expect(html).toContain('pointer-events-none');
  });
  it('reserves completion for the provider even after the estimate has elapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    expect(renderToStaticMarkup(<GenerationProgressOverlay startedAt={1000} durationMs={10000} />)).toContain('scaleX(0.96)');
  });
});

describe('canvas video playback', () => {
  it('uses isolated accessible controls instead of the WebView native scrubber', () => {
    const html = renderToStaticMarkup(<CanvasVideoPlayer src="test.mp4" />);
    // Only the control strip may suppress canvas dragging/selection. A video
    // image click must bubble to React Flow so the AI editing toolbar opens.
    const beforeVideo = html.slice(0, html.indexOf('<video'));
    const video = html.match(/<video[^>]*>/)?.[0] ?? '';
    expect(beforeVideo).not.toContain('nodrag');
    expect(beforeVideo).not.toContain('data-canvas-no-marquee');
    expect(video).toContain('cursor-grab');
    expect(video).not.toContain('nodrag');
    expect(html.slice(html.indexOf('</video>'))).toContain('nodrag nopan nowheel');
    expect(html).toContain('data-canvas-no-marquee="true"');
    expect(html).toContain('role="slider"');
    expect(html).not.toMatch(/<video[^>]*\scontrols/);
  });
});
