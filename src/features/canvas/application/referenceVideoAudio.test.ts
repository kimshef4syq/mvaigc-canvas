import { describe, expect, it } from 'vitest';
import videos from '../infrastructure/fixtures/referenceVideoAudio.json';
import { referenceVideoHasAudio } from './referenceVideoAudio';

describe('reference video audio tracks', () => {
  it('distinguishes an absent audio track from a silent AAC track in real FFmpeg MP4 files', () => {
    expect(referenceVideoHasAudio(videos.silent)).toBe(false);
    expect(referenceVideoHasAudio(videos.audio)).toBe(true);
  });
  it('keeps unknown or damaged formats distinct from a confirmed absent audio track', () => {
    expect(referenceVideoHasAudio('data:video/webm;base64,AAAA')).toBeUndefined();
    expect(referenceVideoHasAudio('data:video/mp4;base64,AAAA')).toBeUndefined();
    expect(referenceVideoHasAudio(videos.audio.slice(0, -16))).toBeUndefined();
    expect(referenceVideoHasAudio('/local/video.mp4')).toBeUndefined();
  });
});
