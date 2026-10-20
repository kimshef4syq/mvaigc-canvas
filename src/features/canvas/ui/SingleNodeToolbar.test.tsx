import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SingleNodeToolbar } from './SingleNodeToolbar';

const fixture = vi.hoisted(() => ({ nodes: [] as { id: string; selected?: boolean }[] }));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
}));
vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

beforeEach(() => { fixture.nodes = []; });
describe('per-node toolbar visibility', () => {
  it('hides both top tools and bottom prompt controls despite explicit isVisible, then restores single selection', () => {
    const render = () => renderToStaticMarkup(<>
      <SingleNodeToolbar isVisible><button>单节点工具</button></SingleNodeToolbar>
      <SingleNodeToolbar isVisible><textarea defaultValue="未提交的提示词" /></SingleNodeToolbar>
    </>);
    fixture.nodes = [{ id: 'first', selected: true }, { id: 'second', selected: false }];
    expect(render()).toContain('单节点工具');
    expect(render()).toContain('未提交的提示词');
    fixture.nodes[1].selected = true;
    expect(render()).toBe('');
    fixture.nodes[0].selected = false;
    expect(render()).toContain('单节点工具');
    expect(render()).toContain('未提交的提示词');
  });
});
