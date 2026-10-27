import { describe, expect, it } from 'vitest';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { createAudioInputReferencesSelector } from './audioInputReferences';

function node(id: string, type: CanvasNode['type'], data: Record<string, unknown>): CanvasNode {
  return { id, type, data, position: { x: 0, y: 0 } } as CanvasNode;
}
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

describe('audio input reference subscription', () => {
  it('retains references through dragging, resizing and selection with a large legacy inline MP3', () => {
    const audioUrl = `data:audio/mpeg;base64,${'A'.repeat(8 * 1024 * 1024)}`;
    const select = createAudioInputReferencesSelector('ai');
    const nodes = [node('audio', CANVAS_NODE_TYPES.audio, { audioUrl }), node('ai', CANVAS_NODE_TYPES.aiAudio, {})];
    const edges = [edge('audio', 'ai')];
    const references = select({ nodes, edges });
    expect(references[0].audioUrl).toBe(audioUrl);
    for (let index = 1; index <= 100; index++) {
      expect(select({ nodes: nodes.map(n => ({ ...n, position: { x: index, y: index }, selected: true, width: 400 })),
        edges: edges.map(e => ({ ...e, selected: true })) })).toBe(references);
    }
  });

  it('updates when source content changes, undo restores it, or an edge is removed', () => {
    const select = createAudioInputReferencesSelector('ai');
    const nodes = [node('audio', CANVAS_NODE_TYPES.audio, { audioUrl: 'file:///one.mp3' }), node('ai', CANVAS_NODE_TYPES.aiAudio, {})];
    const edges = [edge('audio', 'ai')];
    const original = select({ nodes, edges });
    const changed = [{ ...nodes[0], data: { ...nodes[0].data, audioUrl: 'file:///two.mp3' } }, nodes[1]] as CanvasNode[];
    expect(select({ nodes: changed, edges })[0].audioUrl).toBe('file:///two.mp3');
    expect(select({ nodes, edges })).toEqual(original);
    expect(select({ nodes, edges: [] })).toEqual([]);
    expect(select({ nodes, edges })).toEqual(original);
  });

  it('ignores unrelated data edits but observes text changes and tag enablement', () => {
    const select = createAudioInputReferencesSelector('ai');
    const nodes = [node('text', CANVAS_NODE_TYPES.textAnnotation, { content: 'one' }),
      node('tag', CANVAS_NODE_TYPES.tag, { enabled: true }), node('ai', CANVAS_NODE_TYPES.aiAudio, {})];
    const edges = [edge('text', 'tag'), edge('tag', 'ai')];
    const first = select({ nodes, edges });
    expect(first[0].content).toBe('one');
    const unrelated = nodes.map(n => n.id === 'ai' ? { ...n, data: { ...n.data, prompt: 'typing' } } : n) as CanvasNode[];
    expect(select({ nodes: unrelated, edges })).toBe(first);
    const edited = nodes.map(n => n.id === 'text' ? { ...n, data: { ...n.data, content: 'two' } } : n) as CanvasNode[];
    expect(select({ nodes: edited, edges })[0].content).toBe('two');
    const disabled = nodes.map(n => n.id === 'tag' ? { ...n, data: { ...n.data, enabled: false } } : n) as CanvasNode[];
    expect(select({ nodes: disabled, edges })).toEqual([]);
  });
});
