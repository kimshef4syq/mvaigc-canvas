import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ModelBrandMenu } from './ModelBrandMenu';
import type { ModelBrandGroup } from '@/features/canvas/application/modelGroups';

interface TestModel {
  id: string;
  brand?: string;
  brandOrder?: number;
  brandTag?: string;
  modelLabel: string;
  usable: boolean;
  notReadyReason?: string;
}

const groups: ModelBrandGroup<TestModel>[] = [
  {
    brand: 'GPT',
    tag: 'Recommend',
    models: [
      { id: 'a', modelLabel: 'GPT-Image-2.5-Pro', usable: true, brand: 'GPT' },
      { id: 'b', modelLabel: 'GPT-Image-2.5-Fast', usable: true, brand: 'GPT' },
    ],
  },
  {
    brand: 'Nano-Banana',
    tag: 'New',
    models: [{ id: 'c', modelLabel: 'Nano-Banana-Pro', usable: true, brand: 'Nano-Banana' }],
  },
];

const baseProps = {
  groups,
  activeId: 'a',
  openBrand: null as string | null,
  onOpenBrandChange: vi.fn(),
  onPick: vi.fn(),
};

describe('ModelBrandMenu', () => {
  it('lists one row per vendor with its badge', () => {
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, baseProps));
    expect(markup).toContain('data-testid="model-brand-gpt"');
    expect(markup).toContain('data-testid="model-brand-nano-banana"');
    expect(markup).toContain('GPT');
    expect(markup).toContain('荐');
    expect(markup).toContain('New');
  });

  it('renders no flyout while no vendor is open', () => {
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, baseProps));
    expect(markup).not.toContain('data-testid="model-brand-flyout"');
    expect(markup).not.toContain('GPT-Image-2.5-Pro');
  });

  it('renders the open vendor’s models in a side flyout', () => {
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      ...baseProps,
      openBrand: 'GPT',
    }));
    expect(markup).toContain('data-testid="model-brand-flyout"');
    expect(markup).toContain('GPT-Image-2.5-Pro');
    expect(markup).toContain('GPT-Image-2.5-Fast');
    expect(markup).not.toContain('Nano-Banana-Pro');
  });

  it('marks the active model and disables models the caller rules out', () => {
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      ...baseProps,
      openBrand: 'GPT',
      isDisabled: (model: TestModel) => model.id === 'b',
      disabledReason: () => '仅文生/首尾帧',
    }));
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('disabled');
    expect(markup).toContain('仅文生/首尾帧');
  });
});

describe('ModelBrandMenu flyout alignment', () => {
  const props = {
    groups: [
      { brand: 'Seedance', tag: 'New', models: [{ id: 's1', modelLabel: 'Seedance-2.5', usable: true }] },
      { brand: 'WAN', tag: 'Recommend', models: [{ id: 'w1', modelLabel: 'WAN-3.0', usable: true }] },
      { brand: 'Veo', models: [{ id: 'v1', modelLabel: 'Veo-3.1', usable: true }] },
    ],
    activeId: 's1',
    onOpenBrandChange: vi.fn(),
    onPick: vi.fn(),
  };

  it('anchors the flyout to the hovered vendor row, not the bottom of the list', () => {
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      ...props,
      openBrand: 'Seedance',
    }));
    // Seedance is the FIRST row: a bottom-anchored flyout would push its models
    // down beside the last row, which is what made the alignment look wrong.
    expect(markup).not.toContain('bottom-0');
    expect(markup).toContain('top-0');
  });
});

describe('ModelBrandMenu legibility', () => {
  it('uses a readable font size rather than 11px micro type', () => {
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      groups: [{ brand: 'GPT', models: [{ id: 'a', modelLabel: 'GPT-Image-2', usable: true }] }],
      activeId: 'a',
      openBrand: 'GPT',
      onOpenBrandChange: vi.fn(),
      onPick: vi.fn(),
    }));
    expect(markup).not.toContain('text-[11px]');
    expect(markup).toContain('text-[13px]');
  });
});
