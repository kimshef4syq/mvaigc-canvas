import { beforeEach, describe, expect, it } from 'vitest';
import { AgentLoopGuard, normalizeToolArguments } from './agentLoopGuard';

describe('AgentLoopGuard argument normalization', () => {
  it('normalizes whitespace, casing, and punctuation in string arguments', () => {
    const fp1 = normalizeToolArguments('prompt_tool', { prompt: '  A beautiful sunset, on the beach!  ' });
    const fp2 = normalizeToolArguments('prompt_tool', { prompt: 'a beautiful sunset on the beach' });
    expect(fp1).toBe(fp2);
  });

  it('rounds floating point durations so tiny differences map to identical fingerprints', () => {
    const fp1 = normalizeToolArguments('video_tool', { duration: 5.01, prompt: 'cat jumping' });
    const fp2 = normalizeToolArguments('video_tool', { duration: 5.0, prompt: 'cat jumping' });
    expect(fp1).toBe(fp2);
  });

  it('ignores ephemeral non-substantive keys like callId, runId, timestamp', () => {
    const fp1 = normalizeToolArguments('canvas_command', { callId: 'call-1', runId: 'run-1', type: 'node.get', input: { id: 'node-1' } });
    const fp2 = normalizeToolArguments('canvas_command', { callId: 'call-2', runId: 'run-2', timestamp: 123456, type: 'node.get', input: { id: 'node-1' } });
    expect(fp1).toBe(fp2);
  });

  it('keeps distinct models, tools, or files distinct', () => {
    const fp1 = normalizeToolArguments('generate', { model: 'kling_v2', prompt: 'hero flying' });
    const fp2 = normalizeToolArguments('generate', { model: 'minimax_h3', prompt: 'hero flying' });
    const fp3 = normalizeToolArguments('generate_other', { model: 'kling_v2', prompt: 'hero flying' });
    expect(fp1).not.toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });
});

describe('AgentLoopGuard trip rules (P198)', () => {
  let guard: AgentLoopGuard;

  beforeEach(() => {
    guard = new AgentLoopGuard();
  });

  it('trips LOOP_GUARD_BLOCKED when same fingerprint appears 3 times in 5 calls', () => {
    const runId = 'test-run-1';
    const tool = 'source_read';
    const args = { sourceId: 'doc-1', offset: 0, limit: 100 };

    // 1st call: allowed
    const r1 = guard.recordCall(runId, tool, args);
    expect(r1.blocked).toBe(false);
    guard.recordResult(runId, tool, args, true);

    // 2nd call: allowed
    const r2 = guard.recordCall(runId, tool, args);
    expect(r2.blocked).toBe(false);
    guard.recordResult(runId, tool, args, true);

    // 3rd call with same args: tripped!
    const r3 = guard.recordCall(runId, tool, args);
    expect(r3.blocked).toBe(true);
    expect(r3.code).toBe('LOOP_GUARD_BLOCKED');
    expect(r3.reason).toContain('LoopGuard blocked');
    expect(r3.advice).toHaveLength(3);
  });

  it('allows distinct calls within the window without tripping', () => {
    const runId = 'test-run-2';
    const tool = 'source_read';

    guard.recordCall(runId, tool, { sourceId: 'doc-1', offset: 0, limit: 100 });
    guard.recordCall(runId, tool, { sourceId: 'doc-1', offset: 100, limit: 100 });
    guard.recordCall(runId, tool, { sourceId: 'doc-2', offset: 0, limit: 100 });
    const r4 = guard.recordCall(runId, tool, { sourceId: 'doc-3', offset: 0, limit: 100 });

    expect(r4.blocked).toBe(false);
  });

  it('trips CONSECUTIVE_FAILURE_BLOCKED after 2 identical failed tool calls', () => {
    const runId = 'test-run-3';
    const tool = 'generation_submit';
    const args = { prompt: 'flawed prompt', model: 'unsupported' };

    // 1st failure
    guard.recordCall(runId, tool, args);
    guard.recordResult(runId, tool, args, false, 'Invalid model configuration');

    // 2nd failure
    guard.recordCall(runId, tool, args);
    guard.recordResult(runId, tool, args, false, 'Invalid model configuration');

    // 3rd attempt with exact same failed parameters is blocked immediately
    const check = guard.check(runId, tool, args);
    expect(check.blocked).toBe(true);
    expect(check.code).toBe('CONSECUTIVE_FAILURE_BLOCKED');
  });

  it('clears state on clear(runId)', () => {
    const runId = 'test-run-4';
    guard.recordCall(runId, 'tool', { x: 1 });
    guard.recordCall(runId, 'tool', { x: 1 });
    guard.clear(runId);

    const check = guard.check(runId, 'tool', { x: 1 });
    expect(check.blocked).toBe(false);
  });
});
