import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPayload, assertSupportedVideoPorts } from '../dist/provider.js';

const base = { prompt: '动起来', durationSeconds: 5, referenceImages: [],
  referenceVideos: [], referenceAudioUrls: [], generateAudio: false };

test('first and last frame become frames mode with a two-item image array', () => {
  const { body } = buildVideoPayload({ ...base,
    firstFrameUrl: 'data:image/png;base64,FIRST',
    lastFrameUrl: 'data:image/png;base64,LAST' });
  assert.equal(body.frames, true);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,FIRST', 'data:image/png;base64,LAST']);
});

test('a lone first frame still uses frames mode', () => {
  const { body } = buildVideoPayload({ ...base, firstFrameUrl: 'data:image/png;base64,FIRST' });
  assert.equal(body.frames, true);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,FIRST']);
});

test('without frames the payload uses reference images and frames is false', () => {
  const { body } = buildVideoPayload({ ...base, referenceImages: ['data:image/png;base64,R'] });
  assert.equal(body.frames, false);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,R']);
});

test('a first frame combined with reference audio is refused', () => {
  // mvaigc's frames mode accepting audio is unverified; refuse rather than
  // send a request that may silently drop the audio.
  assert.throws(() => assertSupportedVideoPorts({ ...base,
    firstFrameUrl: 'data:image/png;base64,FIRST',
    referenceAudioUrls: ['data:audio/mpeg;base64,CCC'] }), /frame.*audio|audio.*frame/i);
});
