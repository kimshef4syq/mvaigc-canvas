import { resolveAiTextResult } from '@/features/canvas/application/aiText/helpers';

/**
 * The `data` patch for a 文本节点 whose content should be shown in a JSON card.
 * Empty/blank content means "do not touch the card" (no meaningless empty
 * patch), so the caller can use it as a guard.
 */
export function applyJsonCardTextPatch(
  content: string
): { rawContent: string; parsedJson: unknown | null; parseError: string | null } | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = resolveAiTextResult(trimmed);
  if (resolved.kind === 'json') {
    return {
      rawContent: resolved.rawContent || trimmed,
      parsedJson: resolved.parsedJson ?? null,
      parseError: resolved.parseError ?? null,
    };
  }
  // Not JSON: keep the raw text so the card can show it as-is, and surface why
  // it is not shown as a table.
  return { rawContent: trimmed, parsedJson: null, parseError: '内容不是合法 JSON' };
}

export function resolveJsonCardTextContent(data: { content?: unknown }): string {
  return typeof data.content === 'string' ? data.content.trim() : '';
}
