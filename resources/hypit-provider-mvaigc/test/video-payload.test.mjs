import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedanceVideoPayload, buildVideoPayload, mvaigcSeedanceTier, mvaigcVideoTier,
  SEEDANCE_VIDEO_MODEL, VIDEO_MODEL,
} from '../dist/provider.js';

const base = { prompt: '一只猫跑过', durationSeconds: 5, referenceImages: [],
  referenceVideos: [], referenceAudioUrls: [] };
const seedanceBase = { ...base, generateAudio: false, webSearch: false, usesPersonReference: false };

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
  assert.equal(body.resolution, '768P', 'the tier must travel in `resolution`');
});

test('both tiers submit mvaigc\'s single H3 model, with the tier in `resolution`', () => {
  // Regression: `minimax_h3_768p` is not in mvaigc's catalogue any more; the
  // proxy copies `model` into `api`/`apiName`, and upstream answers
  // "1147 找不到此API计费单元信息" for that id. The canvas's own working jobs
  // send `minimax_h3` plus an explicit `resolution`.
  assert.equal(VIDEO_MODEL, 'minimax_h3');
  assert.equal(mvaigcVideoTier('768P'), '768P');
  assert.equal(mvaigcVideoTier('2K'), '2K');
  assert.equal(mvaigcVideoTier(undefined), '768P');
  for (const tier of ['768P', '2K']) {
    const payload = buildVideoPayload({ ...base, resolution: tier });
    assert.equal(payload.model, 'minimax_h3', 'the model id never encodes the tier');
    assert.equal(payload.body.resolution, tier, 'the tier is never dropped');
  }
  assert.equal(buildVideoPayload(base).body.resolution, '768P', 'no tier means the 768P default');
});

test('an unknown resolution tier is refused rather than silently downgraded', () => {
  assert.throws(() => buildVideoPayload({ ...base, resolution: '4K' }), /resolution/i);
});

test('Seedance 2.5 is its own model id, with the tier normalized to mvaigc spelling', () => {
  const { model, body } = buildSeedanceVideoPayload({
    ...seedanceBase, resolution: '720p', aspectRatio: '9:16',
    referenceImages: ['data:image/png;base64,AAA'],
    referenceVideos: ['data:video/mp4;base64,BBB'],
  });
  assert.equal(model, SEEDANCE_VIDEO_MODEL);
  assert.equal(model, 'maas_seedance_2_5');
  // Hypit spells tiers lowercase; the canvas and mvaigc use `720P`.
  assert.equal(body.resolution, '720P');
  assert.equal(body.seconds, 5);
  assert.equal(body.audio, false);
  assert.equal(body.aspect_ratio, '9:16');
  assert.deepEqual(body.reference_images, ['data:image/png;base64,AAA']);
  assert.deepEqual(body.reference_videos, ['data:video/mp4;base64,BBB']);
});

test('Seedance tiers: every offered spelling, the 720P default, and 4k refused', () => {
  assert.equal(mvaigcSeedanceTier(undefined), '720P');
  assert.equal(mvaigcSeedanceTier('480p'), '480P');
  assert.equal(mvaigcSeedanceTier('720p'), '720P');
  assert.equal(mvaigcSeedanceTier('1080P'), '1080P');
  // `4k` is a Seedance surface value mvaigc does not sell on this model.
  assert.throws(() => mvaigcSeedanceTier('4k'), /480P|1080P/i);
});

test('Seedance generate-audio follows its port instead of a constant', () => {
  assert.equal(buildSeedanceVideoPayload({ ...seedanceBase, generateAudio: true }).body.audio, true);
  assert.equal(buildSeedanceVideoPayload({ ...seedanceBase, generateAudio: false }).body.audio, false);
});

test('Seedance web search is refused, never dropped silently', () => {
  assert.throws(
    () => buildSeedanceVideoPayload({ ...seedanceBase, webSearch: true }),
    /web search/i,
  );
});

test('Seedance person reference is refused, never dropped silently', () => {
  assert.throws(
    () => buildSeedanceVideoPayload({ ...seedanceBase, usesPersonReference: true }),
    /person-reference/i,
  );
});

test('Seedance frames mode reuses the two-image rewrite', () => {
  const { body } = buildSeedanceVideoPayload({
    ...seedanceBase,
    firstFrameUrl: 'data:image/png;base64,AAA',
    lastFrameUrl: 'data:image/png;base64,BBB',
  });
  assert.equal(body.frames, true);
  assert.deepEqual(body.reference_images, ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);
});
