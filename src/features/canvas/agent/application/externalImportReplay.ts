import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';

/** Persist the receipt on imported media, so retries survive application restart. */
export function findImportReplay(nodes: CanvasNode[], operationId: string, fingerprint: string, expectedCount: number): string[] | null {
  if (!/^[A-Za-z0-9:._-]{1,128}$/.test(operationId)) throw new Error('Import operationId must contain 1–128 letters, digits, colons, dots, underscores or hyphens.');
  const existing = nodes.filter(node => node.data.canvasImportOperationId === operationId);
  if (existing.length === 0) return null;
  if (existing.some(node => node.data.canvasImportFingerprint !== fingerprint)) throw new Error('This import operationId was already used for a different batch.');
  if (existing.length !== expectedCount) throw new Error('The previous imported batch was partially changed; use a new operationId to deliberately import again.');
  return existing.map(node => node.id);
}
