import { describe, expect, it } from 'vitest';
import { CANVAS_REGISTERED_COMMAND_TYPES } from '@/features/canvas/application/canvasCommandRegistry';
import {
  assertExternalCanvasToolAllowed,
  buildExternalCanvasMcpManifest,
} from './externalAgentToolManifest';

describe('external Canvas MCP manifest', () => {
  it('projects the existing command registry without privileged process tools', () => {
    const manifest = buildExternalCanvasMcpManifest(['canvas', 'asset-read', 'diagnostics', 'config']);
    const canvas = manifest.tools.find((tool) => tool.name === 'canvas_command');
    const commandTypes = ((canvas?.inputSchema.properties as Record<string, any>).type.enum) as string[];

    expect(commandTypes).toEqual(CANVAS_REGISTERED_COMMAND_TYPES);
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'canvas_command',
      'diagnostics',
      'config_patch',
      'asset_read',
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/\b(shell|bash|filesystem|child_process|fetch|credential|apiKey)\b/i);
    expect(manifest.tools.every((tool) => tool.annotations.openWorldHint === false)).toBe(true);
    const diagnostics = manifest.tools.find((tool) => tool.name === 'diagnostics');
    const operations = ((diagnostics?.inputSchema.properties as Record<string, any>).operation.enum) as string[];
    expect(operations).toContain('application-logs');
  });

  it('only exposes tool kinds selected for the turn and fails closed', () => {
    const manifest = buildExternalCanvasMcpManifest(['canvas']);
    expect(manifest.tools.map((tool) => tool.name)).toEqual(['canvas_command']);
    expect(() => assertExternalCanvasToolAllowed(manifest, 'diagnostics')).toThrow(/not allowed/i);
    expect(() => assertExternalCanvasToolAllowed(manifest, 'shell')).toThrow(/not allowed/i);
  });

  it('exposes knowledge, production, and media-postprocess tools when requested (T18)', () => {
    const manifest = buildExternalCanvasMcpManifest(['canvas', 'knowledge', 'production', 'media-postprocess']);
    const toolNames = manifest.tools.map((t) => t.name);

    expect(toolNames).toContain('canvas_command');
    expect(toolNames).toContain('profile_search');
    expect(toolNames).toContain('profile_read');
    expect(toolNames).toContain('source_read');
    expect(toolNames).toContain('source_inspect');
    expect(toolNames).toContain('production_plan');
    expect(toolNames).toContain('media_postprocess');

    const searchTool = assertExternalCanvasToolAllowed(manifest, 'profile_search');
    expect(searchTool.annotations.readOnlyHint).toBe(true);

    const planTool = assertExternalCanvasToolAllowed(manifest, 'production_plan');
    expect(planTool.annotations.idempotentHint).toBe(true);
  });
  it('exposes assets_import only when the media-import kind is requested', () => {
    const withImport = buildExternalCanvasMcpManifest(['canvas', 'media-import']);
    const importTool = withImport.tools.find((tool) => tool.name === 'assets_import');
    expect(importTool).toBeDefined();
    expect(importTool?.annotations.readOnlyHint).toBe(false);
    expect(importTool?.annotations.openWorldHint).toBe(false);

    const withoutImport = buildExternalCanvasMcpManifest(['canvas']);
    expect(withoutImport.tools.map((tool) => tool.name)).not.toContain('assets_import');
  });
});
