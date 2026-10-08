import { describe, expect, it, vi } from 'vitest';

import { submitVideoNodeGeneration, type VideoGenerationPayload } from './videoNodeGeneration';

const payload: VideoGenerationPayload = {
  prompt: 'p',
  model: 'm',
  size: '1280x720',
  aspectRatio: '16:9',
  referenceImages: [],
  extraParams: {},
};

describe('submitVideoNodeGeneration', () => {
  it('overwrite marks the given node generating and submits into it', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-1');
    const updateNodeData = vi.fn();
    const addNode = vi.fn();
    const { targetNodeId } = await submitVideoNodeGeneration({
      nodeId: 'n1',
      mode: 'overwrite',
      payload,
      deps: { addNode, updateNodeData, submitJob },
    });
    expect(targetNodeId).toBe('n1');
    expect(addNode).not.toHaveBeenCalled();
    expect(updateNodeData).toHaveBeenCalledWith('n1', expect.objectContaining({ isGenerating: true }));
    expect(updateNodeData).toHaveBeenCalledWith('n1', { generationJobId: 'job-1' });
  });

  it('newNode creates exactly one video node and submits into it', async () => {
    const submitJob = vi.fn().mockResolvedValue('job-2');
    const addNode = vi.fn().mockReturnValue('created');
    const updateNodeData = vi.fn();
    const { targetNodeId } = await submitVideoNodeGeneration({
      nodeId: 'src',
      mode: 'newNode',
      payload,
      position: { x: 10, y: 20 },
      deps: { addNode, updateNodeData, submitJob },
    });
    expect(addNode).toHaveBeenCalledTimes(1);
    expect(targetNodeId).toBe('created');
    expect(updateNodeData).toHaveBeenCalledWith('created', expect.objectContaining({ isGenerating: true }));
  });
});
