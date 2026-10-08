import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import '@/i18n';
import { VideoNodeToolbar } from './VideoNodeToolbar';

describe('VideoNodeToolbar', () => {
  it('renders preview + capture-frame buttons without throwing', () => {
    const markup = renderToStaticMarkup(createElement(VideoNodeToolbar, {
      onPreview: vi.fn(),
      onCaptureFrame: vi.fn(),
    }));
    expect(markup).toContain('data-testid="video-preview"');
    expect(markup).toContain('data-testid="video-capture-frame"');
  });

  it('renders the three frame options when the menu is open', () => {
    const markup = renderToStaticMarkup(createElement(VideoNodeToolbar, {
      onPreview: vi.fn(),
      onCaptureFrame: vi.fn(),
      frameMenuOpen: true,
    }));
    expect(markup).toContain('data-testid="video-capture-first"');
    expect(markup).toContain('data-testid="video-capture-current"');
    expect(markup).toContain('data-testid="video-capture-last"');
  });
});
