import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import '@/i18n';
import { CanvasNodeImage, shouldOpenViewer } from './CanvasNodeImage';

describe('shouldOpenViewer', () => {
  const base = { openViewerOnClick: false, disableViewer: false, defaultPrevented: false };

  it('click opens only when openViewerOnClick is on', () => {
    expect(shouldOpenViewer('click', { ...base, openViewerOnClick: true })).toBe(true);
    expect(shouldOpenViewer('click', base)).toBe(false);
  });

  it('doubleClick opens only when openViewerOnClick is off', () => {
    expect(shouldOpenViewer('doubleClick', base)).toBe(true);
    expect(shouldOpenViewer('doubleClick', { ...base, openViewerOnClick: true })).toBe(false);
  });

  it('viewer disabled or event already handled blocks both triggers', () => {
    expect(shouldOpenViewer('click', { ...base, openViewerOnClick: true, disableViewer: true })).toBe(false);
    expect(shouldOpenViewer('doubleClick', { ...base, defaultPrevented: true })).toBe(false);
  });
});

describe('CanvasNodeImage', () => {
  it('renders a viewer-enabled thumbnail', () => {
    const markup = renderToStaticMarkup(createElement(CanvasNodeImage, {
      src: 'local-media://a.jpg',
      alt: '图1',
      viewerSourceUrl: 'local-media://a.jpg',
      viewerImageList: ['local-media://a.jpg'],
      openViewerOnClick: true,
    }));
    expect(markup).toContain('data-viewer-src="local-media://a.jpg"');
  });
});
