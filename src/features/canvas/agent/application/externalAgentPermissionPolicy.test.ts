import { describe, expect, it } from 'vitest';
import type { ExternalAgentToolRequest } from '../domain/agentModel';
import { externalAgentPermissionDecision, isExternalAgentReadOnly } from './externalAgentPermissionPolicy';

const request = (toolName: ExternalAgentToolRequest['toolName'], args: unknown): ExternalAgentToolRequest => ({
  version: 1, runtime: 'claude', sessionId: 's', turnId: 't', callId: 'c', toolName, arguments: args,
});

describe('assets_import permission', () => {
  it('is never treated as a read-only tool', () => {
    expect(isExternalAgentReadOnly(request('assets_import', { files: [{ path: '/a.mp4' }] }))).toBe(false);
  });

  it('needs confirmation in collaboration mode', () => {
    expect(externalAgentPermissionDecision('collaboration', request('assets_import', { files: [] }))).toBe('confirm');
  });

  it('is denied in analysis mode', () => {
    expect(externalAgentPermissionDecision('analysis', request('assets_import', { files: [] }))).toBe('deny');
  });
});
