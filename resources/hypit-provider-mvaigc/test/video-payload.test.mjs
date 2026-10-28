import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPayload, mvaigcVideoModelForTier } from '../dist/provider.js';

const base = { prompt: '一只猫跑过', durationSeconds: 5, referenceImages: [],
  referenceVideos: [], referenceAudioUrls: [] };

test('maps Hypit ports onto mvaigc field names', () => {
  const { body } = buildVideoPayload({ ...base, resolution: '768P', aspectRatio: '16:9',
    referenceImages: ['data:image/png;base64,AAA'],
    referenceVideos: ['data:video/mp4;base64,BBB'],
    referenceAudioUrls: ['data:audio/mpeg;base64,CCC'] });
  assert.equal(body.prompt, '一只猫跑过');
  assert.equal(body.seconds, 5, 'duration must be renamed to seconds');
  assert.deepEqual(body.reference_images, ['data:image/png;base64,AAA']);
  assert.deepEqual(body.reference_videos, ['data:video/mp4;base64,BBB']);
  assert.deepEqual(body.reference_audios, ['data:audio/mpeg;base64,CCC']);
  // minimax-h3 declares no generate-audio port, so audio is a mapping constant.
  assert.equal(body.audio, false);
  assert.equal(body.aspect_ratio, '16:9');
});

test('768P and 2K select different mvaigc model ids', () => {
  assert.equal(mvaigcVideoModelForTier('768P'), 'minimax_h3_768p');
  assert.equal(mvaigcVideoModelForTier('2K'), 'minimax_h3');
  assert.equal(mvaigcVideoModelForTier(undefined), 'minimax_h3_768p');
  assert.equal(buildVideoPayload({ ...base, resolution: '2K' }).model, 'minimax_h3');
  assert.equal(buildVideoPayload({ ...base, resolution: '768P' }).model, 'minimax_h3_768p');
});

test('an unknown resolution tier is refused rather than silently downgraded', () => {
  assert.throws(() => buildVideoPayload({ ...base, resolution: '4K' }), /resolution/i);
});
