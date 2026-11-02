import { isEditorResponse, SUPER_SPLAT_PROTOCOL_VERSION, type EditorCommand } from './protocol';
export function editorRequest(frame: HTMLIFrameElement, command: EditorCommand | { type: 'open'; file: File }, timeout = 120000): Promise<unknown> {
  const target = frame.contentWindow;
  if (!target) return Promise.reject(new Error('编辑器尚未就绪'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('编辑器响应超时')); }, timeout);
    function receive(event: MessageEvent) {
      if (!target || !isEditorResponse(event, target, window.location.origin) || event.data.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error.message));
    }
    window.addEventListener('message', receive);
    target.postMessage({ protocol: SUPER_SPLAT_PROTOCOL_VERSION, requestId, command }, window.location.origin);
  });
}
