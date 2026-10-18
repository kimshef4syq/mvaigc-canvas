import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let currentMockZoom = 1;

vi.mock('@xyflow/react', () => ({
  BackgroundVariant: { Dots: 'dots' },
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) => {
    return selector({ transform: [0, 0, currentMockZoom] });
  },
  Background: (props: { size: number; gap: number; color: string }) => {
    return createElement('div', {
      'data-testid': 'mock-background',
      'data-size': props.size,
      'data-gap': props.gap,
      'data-color': props.color,
    });
  },
}));

import { CanvasBackground } from './CanvasBackground';

describe('CanvasBackground', () => {
  it('renders with standard crisp size at 100% zoom (zoom = 1)', () => {
    currentMockZoom = 1;
    const markup = renderToStaticMarkup(createElement(CanvasBackground));
    expect(markup).toContain('data-size="2.6"');
    expect(markup).toContain('data-gap="32"');
    expect(markup).toContain('data-color="var(--canvas-grid-dot)"');
  });

  it('adapts dot size when zoomed out to zoom = 0.5 so screen diameter stays at least 1.6px', () => {
    currentMockZoom = 0.5;
    const markup = renderToStaticMarkup(createElement(CanvasBackground));
    // At zoom = 0.5: 1.6 / 0.5 = 3.2
    expect(markup).toContain('data-size="3.2"');
    expect(markup).toContain('data-gap="32"');
  });

  it('widens gap and expands size at far zoom out (zoom = 0.3)', () => {
    currentMockZoom = 0.3;
    const markup = renderToStaticMarkup(createElement(CanvasBackground));
    expect(markup).toContain('data-gap="48"');
    // At zoom = 0.3: 1.6 / 0.3 = 5.333333333333334
    expect(markup).toContain('data-size="5.333333333333334"');
  });

  it('uses widest gap at extreme zoom out (zoom = 0.15)', () => {
    currentMockZoom = 0.15;
    const markup = renderToStaticMarkup(createElement(CanvasBackground));
    expect(markup).toContain('data-gap="64"');
  });
});
