import { describe, expect, it } from 'vitest';
import { findImportReplay } from './externalImportReplay';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
const imported = (id: string, fingerprint = 'hash') => ({ id, position: { x: 0, y: 0 }, type: 'videoNode', data: { videoUrl: null, aspectRatio: '16:9', displayName: 'Imported', canvasImportOperationId: 'task:final', canvasImportFingerprint: fingerprint } }) as CanvasNode;
describe('persistent import batch receipts', () => {
  it('recognizes a completed batch after nodes are restored from disk', () => {
    expect(findImportReplay(JSON.parse(JSON.stringify([imported('a'), imported('b')])), 'task:final', 'hash', 2)).toEqual(['a', 'b']);
  });
  it('does not mistake a new batch for a replay', () => expect(findImportReplay([], 'task:final', 'hash', 2)).toBeNull());
  it('refuses reuse for changed files and partially removed batches', () => {
    expect(() => findImportReplay([imported('a', 'other')], 'task:final', 'hash', 1)).toThrow('different batch');
    expect(() => findImportReplay([imported('a')], 'task:final', 'hash', 2)).toThrow('partially changed');
  });
});
