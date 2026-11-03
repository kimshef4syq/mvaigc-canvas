/** Versioned boundary between the canvas host and the isolated editor. */
export const SUPER_SPLAT_PROTOCOL_VERSION = 1 as const;

export interface CameraView {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface SavedView {
  id: string;
  name: string;
  camera: CameraView;
}

export type EditorCommand =
  | { type: 'initialize' }
  | { type: 'open'; assetId: string; documentId?: string }
  | { type: 'save' }
  | { type: 'getView' }
  | { type: 'setView'; camera: CameraView }
  | { type: 'capture' }
  | { type: 'close' };

export interface EditorRequest {
  protocol: typeof SUPER_SPLAT_PROTOCOL_VERSION;
  requestId: string;
  command: EditorCommand;
}

export type EditorResponse = {
  protocol: typeof SUPER_SPLAT_PROTOCOL_VERSION;
  requestId: string;
} & ({ ok: true; result?: unknown } | { ok: false; error: { code: string; message: string } });

/** Accept messages only from the embedded editor window at its expected origin. */
export function isEditorResponse(event: MessageEvent, source: Window, origin: string): event is MessageEvent<EditorResponse> {
  if (event.source !== source || event.origin !== origin || !event.data || typeof event.data !== 'object') return false;
  const data = event.data as Record<string, unknown>;
  if (data.protocol !== SUPER_SPLAT_PROTOCOL_VERSION || typeof data.requestId !== 'string') return false;
  if (data.ok === true) return true;
  if (data.ok !== false || !data.error || typeof data.error !== 'object') return false;
  const error = data.error as Record<string, unknown>;
  return typeof error.code === 'string' && typeof error.message === 'string';
}
