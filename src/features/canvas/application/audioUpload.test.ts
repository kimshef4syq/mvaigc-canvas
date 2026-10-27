import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ persist: vi.fn(), isTauri: vi.fn() }));
vi.mock('@/commands/image', () => ({ persistAudioSource: mocks.persist }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.isTauri }));
vi.mock('./imageData', () => ({ resolveImageDisplayUrl: (source: string) => source }));
import { prepareAudioNodeDataFromFile } from './audioUpload';

const inlineSource = `data:audio/mpeg;base64,${'A'.repeat(1024 * 1024)}`;
beforeEach(() => {
  mocks.persist.mockReset().mockResolvedValue('file:///cache/audio/song.mp3');
  mocks.isTauri.mockReturnValue(true);
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('FileReader', class {
    result = inlineSource;
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  vi.stubGlobal('document', { createElement: () => ({
    duration: 123,
    onloadedmetadata: undefined as undefined | (() => void),
    removeAttribute() {}, load() {},
    set src(_value: string) { queueMicrotask(() => this.onloadedmetadata?.()); },
  }) });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:metadata');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('audio upload storage', () => {
  it('persists desktop audio before returning node data and keeps bytes out of canvas state', async () => {
    const data = await prepareAudioNodeDataFromFile(new File(['audio'], 'song.mp3', { type: 'audio/mpeg' }));
    expect(mocks.persist).toHaveBeenCalledWith(inlineSource);
    expect(data).toMatchObject({ audioUrl: 'file:///cache/audio/song.mp3', localAudioUrl: 'file:///cache/audio/song.mp3',
      sourceFileName: 'song.mp3', durationSeconds: 123 });
    expect(JSON.stringify(data).length).toBeLessThan(1000);
    expect(JSON.stringify(data)).not.toContain('base64');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:metadata');
  });
  it('reports persistence failure rather than silently storing a large desktop payload', async () => {
    mocks.persist.mockRejectedValue(new Error('disk full'));
    await expect(prepareAudioNodeDataFromFile(new File(['audio'], 'song.mp3'))).rejects.toThrow('disk full');
  });
  it('preserves browser upload support when no native storage is available', async () => {
    mocks.isTauri.mockReturnValue(false);
    const data = await prepareAudioNodeDataFromFile(new File(['audio'], 'song.mp3'));
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(data.audioUrl).toBe(inlineSource);
  });
});
