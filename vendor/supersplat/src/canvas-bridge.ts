import { Vec3 } from 'playcanvas';
import type { Events } from './events';
import type { createEditorAPI } from './editor-api';

// Only the embedding parent on the same origin can issue bridge commands.
export function registerCanvasBridge(events: Events, editor: ReturnType<typeof createEditorAPI>) {
    if (window.parent === window) return;
    window.addEventListener('message', async (event) => {
        if (event.source !== window.parent || event.origin !== window.location.origin) return;
        const request = event.data;
        if (!request || request.protocol !== 1 || typeof request.requestId !== 'string') return;
        try {
            const command = request.command;
            let result: unknown;
            switch (command?.type) {
                case 'initialize': result = true; break;
                case 'openUrl': {
                    const url = new URL(command.url);
                    if (url.origin !== window.location.origin) throw new Error('Invalid asset origin');
                    await events.invoke('import', [{ filename: command.filename, url: url.href }], false, { throwOnError: true });
                    result = true; break;
                }
                case 'open': {
                    const file = command.file as File;
                    if (!(file instanceof Blob) || typeof file.name !== 'string') throw new Error('Missing file');
                    if (/\.ssproj$/i.test(file.name)) await events.invoke('doc.load', file);
                    else await events.invoke('import', [{ filename: file.name, contents: file }], false, { throwOnError: true });
                    result = true;
                    break;
                }
                case 'getView': {
                    const state = await editor.inspect.scene();
                    const { position, target, fov } = state.camera;
                    result = { position: [position.x, position.y, position.z], target: [target.x, target.y, target.z], fov };
                    break;
                }
                case 'setView': {
                    const c = command.camera;
                    await editor.viewport.setCamera({ position: new Vec3(...c.position), target: new Vec3(...c.target), fov: c.fov });
                    result = true; break;
                }
                case 'save': {
                    const chunks: Uint8Array[] = [];
                    const stream = {
                        seek: async () => {}, truncate: async () => {}, close: async () => {}, abort: async () => { chunks.length = 0; },
                        write: async (bytes: Uint8Array) => { chunks.push(new Uint8Array(bytes)); }
                    } as unknown as FileSystemWritableFileStream;
                    await events.invoke('doc.canvasSave', stream);
                    result = new Blob(chunks as BlobPart[], { type: 'application/x-supersplat' });
                    break;
                }
                case 'capture': {
                    const chunks: Uint8Array[] = [];
                    const stream = { write: async (bytes: Uint8Array) => { chunks.push(new Uint8Array(bytes)); }, close: async () => {} } as unknown as FileSystemWritableFileStream;
                    const ok = await events.invoke('render.image', { width: 1280, height: 720, transparentBg: false, showDebug: false, format: 'png', projection: 'standard' }, stream);
                    if (!ok) throw new Error('Capture failed');
                    result = new Blob(chunks as BlobPart[], { type: 'image/png' });
                    break;
                }
                default: throw new Error('Unsupported command');
            }
            window.parent.postMessage({ protocol: 1, requestId: request.requestId, ok: true, result }, event.origin);
        } catch (error) {
            window.parent.postMessage({ protocol: 1, requestId: request.requestId, ok: false, error: { code: 'editor_error', message: String(error) } }, event.origin);
        }
    });
}
