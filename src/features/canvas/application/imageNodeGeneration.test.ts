import { describe, expect, it, vi } from 'vitest';

import {
  queuedGenerationCount,
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
