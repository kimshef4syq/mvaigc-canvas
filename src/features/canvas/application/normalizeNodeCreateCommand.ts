import type { CanvasCommand } from '../domain/canvasCommands';

/** Compatibility at the shared boundary, before preview and execution alike.
 * Preserve conflicting fields so validation rejects them instead of guessing.
 */
export function normalizeNodeCreateCommand(command: CanvasCommand): CanvasCommand {
  if (!command || command.type !== 'node.create' || !command.input
    || typeof command.input !== 'object' || Array.isArray(command.input)) return command;
  const input = command.input as unknown as Record<string, unknown>;
  if (typeof input.type !== 'string') return command;
  if (input.nodeType !== undefined && input.nodeType !== input.type) return command;
  const normalized: Record<string, unknown> = { ...input, nodeType: input.nodeType ?? input.type };
  delete normalized.type;
  return { ...command, input: normalized } as unknown as CanvasCommand;
}
