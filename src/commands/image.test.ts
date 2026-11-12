import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn<() => boolean>(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
  invoke: vi.fn<(command: string, args?: unknown) => Promise<string>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: tauriMocks.isTauri,
  invoke: tauriMocks.invoke,
  convertFileSrc: tauriMocks.convertFileSrc,
}));

import { loadVideoSourceDataUrl, persistImageSource } from './image';

describe('image persistence runtime routing', () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReset();
    tauriMocks.invoke.mockReset();
  });

  it('keeps a browser data URL for project image-pool persistence without invoking Tauri', async () => {
    tauriMocks.isTauri.mockReturnValue(false);
    const source = 'data:image/png;base64,cGl4ZWxz';

    await expect(persistImageSource(source)).resolves.toBe(source);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it('persists image data through the native command in Tauri', async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.invoke.mockResolvedValue('/saved/snapshot.png');

    await expect(persistImageSource('data:image/png;base64,cGl4ZWxz')).resolves.toBe('/saved/snapshot.png');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('persist_image_source', {
      source: 'data:image/png;base64,cGl4ZWxz',
    });
  });
});


describe('video data URL backend compatibility', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => { tauriMocks.invoke.mockReset(); tauriMocks.convertFileSrc.mockClear(); });

  it('uses the native command when available', async () => {
    tauriMocks.invoke.mockResolvedValue('data:video/mp4;base64,AAAA');
    await expect(loadVideoSourceDataUrl('/local/clip.mp4')).resolves.toBe('data:video/mp4;base64,AAAA');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('load_video_source_data_url', { source: '/local/clip.mp4' });
    expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
  });

  it('falls back to the playback asset protocol only for an older backend', async () => {
    tauriMocks.invoke.mockRejectedValue('Command load_video_source_data_url not found');
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['video'], { type: 'video/mp4' })));
    vi.stubGlobal('fetch', fetchMock);
    let readBlob: Blob | undefined;
    vi.stubGlobal('FileReader', class {
      result = 'data:video/mp4;base64,dmlkZW8=';
      onload?: () => void;
      readAsDataURL(blob: Blob) { readBlob = blob; this.onload?.(); }
    });
    await expect(loadVideoSourceDataUrl('file:///local/my%20clip.mp4')).resolves.toBe('data:video/mp4;base64,dmlkZW8=');
    expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith('/local/my clip.mp4');
    expect(fetchMock).toHaveBeenCalledWith('asset://localhost/local/my clip.mp4');
    expect(readBlob?.type).toBe('video/mp4');
  });

  it('preserves genuine native read failures without attempting another read', async () => {
    tauriMocks.invoke.mockRejectedValue(new Error('Permission denied'));
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(loadVideoSourceDataUrl('/local/clip.mp4')).rejects.toThrow('Permission denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
