import { describe, expect, it, vi } from 'vitest';

import {
  drainQueuedGeneration,
  normalizeGenerateCount,
  queuedGenerationCount,
  resolvePanelReferenceImages,
  submitImageNodeGeneration,
  takeNextQueuedGeneration,
  type ImageGenerationPayload,
} from './imageNodeGeneration';

const payload: ImageGenerationPayload = {
  prompt: 'p',
  model: 'm',
  size: '1024x1024',
  aspectRatio: '1:1',
  referenceImages: [],
  extraParams: {},
};

describe('submitImageNodeGeneration', () => {
  it('submits once and marks the node generating for count=1', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-1');
    const updateNodeData = vi.fn();
    const addNode = vi.fn().mockReturnValue('n1');

    await submitImageNodeGeneration({
      nodeId: 'n1', mode: 'overwrite', payload, count: 1,
      deps: { addNode, updateNodeData, submitJob },
    });

    expect(submitJob).toHaveBeenCalledTimes(1);
    expect(updateNodeData).toHaveBeenCalledWith('n1', expect.objectContaining({ isGenerating: true }));
    expect(queuedGenerationCount('n1')).toBe(0);
  });

  it('queues the remaining count-1 requests for later', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-2');
    const updateNodeData = vi.fn();

    await submitImageNodeGeneration({
      nodeId: 'n2', mode: 'overwrite', payload, count: 3,
      deps: { addNode: vi.fn(), updateNodeData, submitJob },
    });

    expect(submitJob).toHaveBeenCalledTimes(1);
    expect(queuedGenerationCount('n2')).toBe(2);
    expect(takeNextQueuedGeneration('n2')).not.toBeNull();
    expect(queuedGenerationCount('n2')).toBe(1);
  });

  it('creates exactly one node in newNode mode and submits into it', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-3');
    const addNode = vi.fn().mockReturnValue('created');
    const updateNodeData = vi.fn();

    await submitImageNodeGeneration({
      nodeId: 'src', mode: 'newNode', payload, count: 1,
      deps: { addNode, updateNodeData, submitJob },
    });

    expect(addNode).toHaveBeenCalledTimes(1);
    expect(updateNodeData).toHaveBeenCalledWith('created', expect.objectContaining({ isGenerating: true }));
  });
});

describe('drainQueuedGeneration', () => {
  it('submits the next queued request and keeps the node generating', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-next');
    const updateNodeData = vi.fn();
    await submitImageNodeGeneration({
      nodeId: 'drain1', mode: 'overwrite', payload, count: 2,
      deps: { addNode: vi.fn(), updateNodeData, submitJob },
    });
    submitJob.mockClear();
    updateNodeData.mockClear();

    const continued = await drainQueuedGeneration('drain1', { submitJob, updateNodeData });

    expect(continued).toBe(true);
    expect(submitJob).toHaveBeenCalledTimes(1);
    expect(updateNodeData).toHaveBeenCalledWith('drain1', { isGenerating: true });
    expect(updateNodeData).toHaveBeenCalledWith('drain1', { generationJobId: 'job-next' });
  });

  it('returns false and does not submit when the queue is empty', async () => {
    const submitJob = vi.fn();
    const updateNodeData = vi.fn();
    const continued = await drainQueuedGeneration('drain-empty', { submitJob, updateNodeData });
    expect(continued).toBe(false);
    expect(submitJob).not.toHaveBeenCalled();
  });
});

describe('resolvePanelReferenceImages', () => {
  const connected = ['/a.png', '/b.png'];

  it('sends no reference images when the prompt has no @图N token', () => {
    expect(resolvePanelReferenceImages('一个男孩', connected)).toEqual([]);
    expect(resolvePanelReferenceImages('', connected)).toEqual([]);
    expect(resolvePanelReferenceImages('风格 #赛博朋克', connected)).toEqual([]);
  });

  it('sends the connected images when the prompt mentions @图N', () => {
    expect(resolvePanelReferenceImages('@图1 一个男孩', connected)).toEqual(connected);
    expect(resolvePanelReferenceImages('保持 @图2 的衣服', connected)).toEqual(connected);
  });

  it('ignores @ preceded by a word character (e.g. an email)', () => {
    expect(resolvePanelReferenceImages('a@图1', connected)).toEqual([]);
  });
});

describe('normalizeGenerateCount', () => {
  it('prefers a valid custom count and clamps to 1..10', () => {
    expect(normalizeGenerateCount('3', 1)).toBe(3);
    expect(normalizeGenerateCount('0', 2)).toBe(1);
    expect(normalizeGenerateCount('99', 2)).toBe(10);
  });

  it('falls back to the preset count when custom is empty or invalid', () => {
    expect(normalizeGenerateCount('', 4)).toBe(4);
    expect(normalizeGenerateCount('abc', 2)).toBe(2);
    expect(normalizeGenerateCount(null, 1)).toBe(1);
  });
});
