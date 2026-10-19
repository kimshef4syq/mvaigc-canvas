import { describe, expect, it } from 'vitest';
import { ComfyUiAdapterService } from './comfyuiAdapter';

describe('ComfyUI Adapter Application Service (T16 & A24)', () => {
  describe('Health Checks & Missing Node/Model Reporting (A24)', () => {
    it('reports missing custom nodes and models specifically without hiding behind generic failure', async () => {
      const adapter = new ComfyUiAdapterService();
      adapter.setConnectionStatus({
        connected: true,
        ready: false,
        missingNodes: ['ControlNetApplyAdvanced', 'IPAdapterUnifiedLoader'],
        missingModels: ['v3_sd15_adapter.pth'],
      });

      const health = await adapter.checkHealth();
      expect(health.connected).toBe(true);
      expect(health.ready).toBe(false);
      expect(health.missingNodes).toContain('ControlNetApplyAdvanced');
      expect(health.missingNodes).toContain('IPAdapterUnifiedLoader');
      expect(health.missingModels).toContain('v3_sd15_adapter.pth');
    });

    it('reports ready when all required nodes and models are present', async () => {
      const adapter = new ComfyUiAdapterService();
      const health = await adapter.checkHealth();
      expect(health.connected).toBe(true);
      expect(health.ready).toBe(true);
      expect(health.missingNodes).toHaveLength(0);
    });
  });

  describe('Input Validation & Execution Lifecycle', () => {
    it('fails preflight with missing_input code when required input image is missing', async () => {
      const adapter = new ComfyUiAdapterService();
      const receipt = await adapter.runWorkflow({
        workflowId: 'wf-portrait-enhancer',
        inputValues: {},
        inputBindings: [], // Missing required 'image' input on node-load-image-1
      });

      expect(receipt.status).toBe('failed');
      expect(receipt.error?.code).toBe('missing_input');
      expect(receipt.missingInputs?.length).toBeGreaterThan(0);
      expect(receipt.missingInputs?.[0]).toContain('node-load-image-1');
      expect(receipt.missingInputs?.[0]).toContain('image');
    });

    it('A24: executes successfully and returns real runId, promptId, and asset receipts when inputs provided', async () => {
      const adapter = new ComfyUiAdapterService();
      const receipt = await adapter.runWorkflow({
        workflowId: 'wf-portrait-enhancer',
        inputValues: {
          'node-prompt-text-2:prompt': 'A cinematic portrait of an astronaut',
        },
        inputBindings: [
          {
            nodeId: 'node-load-image-1',
            parameter: 'image',
            workspacePath: 'assets/input-photo.png',
          },
        ],
        count: 2,
      });

      expect(receipt.status).toBe('succeeded');
      expect(receipt.runId).toMatch(/^run-/);
      expect(receipt.promptId).toMatch(/^prompt-cf-/);
      expect(receipt.outputAssetIds).toHaveLength(2);
      expect(receipt.outputAssetIds[0]).toContain('.png');
      expect(receipt.executionTimeMs).toBeGreaterThan(0);
    });

    it('enforces expectedSourceSha256 optimistic concurrency lock', async () => {
      const adapter = new ComfyUiAdapterService();
      await expect(
        adapter.runWorkflow({
          workflowId: 'wf-portrait-enhancer',
          expectedSourceSha256: 'f'.repeat(64), // Mismatched sha256!
          inputValues: {},
        })
      ).rejects.toThrow('工作流版本冲突');
    });
  });

  describe('Cancellation and Save Lifecycle', () => {
    it('cancels active run and updates status', async () => {
      const adapter = new ComfyUiAdapterService();
      const receipt = await adapter.runWorkflow({
        workflowId: 'wf-portrait-enhancer',
        inputBindings: [
          { nodeId: 'node-load-image-1', parameter: 'image', workspacePath: 'assets/in.png' },
        ],
      });

      const cancelResult = await adapter.cancelRun(receipt.runId);
      expect(cancelResult.cancelled).toBe(true);
      expect(cancelResult.runId).toBe(receipt.runId);
    });

    it('saves completed run snapshot as a new reusable workflow version', async () => {
      const adapter = new ComfyUiAdapterService();
      const receipt = await adapter.runWorkflow({
        workflowId: 'wf-portrait-enhancer',
        inputBindings: [
          { nodeId: 'node-load-image-1', parameter: 'image', workspacePath: 'assets/in.png' },
        ],
      });

      const saved = await adapter.saveRunAsWorkflow({
        runId: receipt.runId,
        name: '定制人像增强 v2',
        mode: 'copy',
      });

      expect(saved.workflowId).toMatch(/^user:wf-/);
      expect(saved.version).toBe('1.1');

      const retrieved = await adapter.getWorkflow({ workflowId: saved.workflowId });
      expect(retrieved?.name).toBe('定制人像增强 v2');
    });
  });
});
