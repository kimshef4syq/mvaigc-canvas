import test from 'node:test';
import assert from 'node:assert/strict';

import { nanoBananaPorts } from '@hypit/nano-banana';
import { minimaxH3Ports } from '@hypit/minimax-h3';
import { seedancePorts } from '@hypit/seedance';
import { assertMappingCoversPorts } from '@hypit/generation';
import { imageMapping, seedanceVideoMapping, videoMapping } from '../dist/provider.js';
import { createMvaigcEndpoints } from '../dist/endpoint.js';

// Against the REAL port tables, not a hand-copied array. The earlier test
// compared two literals in one file, so it could not catch a wrong list — which
// was the actual bug (videoMapping named `generateAudio`, which minimax-h3 does
// not declare).

test('the image mapping satisfies the real nano-banana-pro port table', () => {
  assertMappingCoversPorts(nanoBananaPorts['nano-banana-pro'], imageMapping);
});

test('the video mapping satisfies the real minimax-h3 port table', () => {
  assertMappingCoversPorts(minimaxH3Ports, videoMapping);
});

test('the Seedance mapping satisfies the real seedance-2.5 port table', () => {
  assertMappingCoversPorts(seedancePorts['seedance-2.5'], seedanceVideoMapping);
});

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      headers: { get: (n) => (n.toLowerCase() === 'content-type' ? (next.contentType ?? 'application/json') : null) },
      json: async () => next.json,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  return { calls, fetch };
}
const options = (fetch) => ({ instance: 'i', pool: 'p', baseUrl: 'http://127.0.0.1:8787',
  apiKey: { store: 'local', key: 'mvaigc.local' }, fetch });
const creds = { apiKey: { secret: 'acct:pw' } };
const resources = { get: async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }),
  // The real store echoes the mediaType it is handed; sealGeneratedVideoSet
  // rejects anything that is not video/, so the stub must echo too.
  put: async (_bytes, mediaType) => ({ kind: 'blob', resource: 'res_1', size: 3, mediaType }) };

test('start submits to /v1/videos and checkpoints the task id', async () => {
  const { fetch, calls } = fakeFetch([{ json: { id: 'task-1', status: 'processing' } }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  let checkpointed;
  await video.start({
    need: { constraints: { ports: { prompt: ['一只猫'], duration: [5] } } },
    credentials: creds, resources, checkpoint: async (v) => { checkpointed = v; },
  });
  assert.equal(checkpointed.handle.id, 'task-1');
  assert.match(calls[0].url, /\/v1\/videos$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer acct:pw');
  // The body the proxy actually receives: one `minimax_h3` model plus the tier
  // as a field. `minimax_h3_768p` produced upstream "1147 找不到此API计费单元
  // 信息"; omitting the tier silently became the proxy's 720p default.
  const posted = JSON.parse(calls[0].init.body);
  assert.equal(posted.model, 'minimax_h3');
  assert.equal(posted.resolution, '768P');
});

test('Seedance 2.5 submits its own model id and the normalized tier', async () => {
  const { fetch, calls } = fakeFetch([{ json: { id: 'task-s', status: 'processing' } }]);
  const { seedance } = createMvaigcEndpoints(options(fetch));
  await seedance.start({
    need: { constraints: { ports: {
      prompt: ['把左边的人换成 t02'], duration: [7], resolution: ['720p'], aspectRatio: ['9:16'],
      generateAudio: [true], webSearch: [false],
    } } },
    credentials: creds, resources, checkpoint: async () => {},
  });
  assert.match(calls[0].url, /\/v1\/videos$/);
  const posted = JSON.parse(calls[0].init.body);
  assert.equal(posted.model, 'maas_seedance_2_5');
  assert.equal(posted.resolution, '720P');
  assert.equal(posted.audio, true, 'Seedance generate-audio is a real port');
  assert.equal(posted.seconds, 7);
});

test('poll reports pending then ready with the output url', async () => {
  const { fetch } = fakeFetch([
    { json: { status: 'processing' } },
    { json: { status: 'succeeded', output: [{ url: 'https://cdn.example.com/a.mp4' }] } },
  ]);
  const { video } = createMvaigcEndpoints(options(fetch));
  assert.equal((await video.poll({ handle: { id: 't1' }, credentials: creds })).status, 'pending');
  const ready = await video.poll({ handle: { id: 't1' }, credentials: creds });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.handle.url, 'https://cdn.example.com/a.mp4');
});

test('a failed task surfaces mvaigc own message', async () => {
  const { fetch } = fakeFetch([{ json: { status: 'failed', error: { message: '上游拒绝了请求' } } }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  const failed = await video.poll({ handle: { id: 't1' }, credentials: creds });
  assert.equal(failed.status, 'failed');
  assert.match(failed.failure.message, /上游拒绝了请求/);
});

test('succeeded without an output url fails loudly', async () => {
  const { fetch } = fakeFetch([{ json: { status: 'succeeded', output: [] } }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  await assert.rejects(() => video.poll({ handle: { id: 't1' }, credentials: creds }), /output/i);
});

test('a submit-time HTTP error surfaces mvaigc own message', async () => {
  // The proxy answers failures as {"error":{"message":"…"}} and that message is
  // the only thing that distinguishes a bad credential from a bad model id from
  // insufficient balance. A bare "HTTP 502" leaves the user unable to diagnose.
  const { fetch } = fakeFetch([{ ok: false, status: 502,
    json: { error: { message: 'Provider error: 1147: 找不到此API计费单元信息' } } }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  await assert.rejects(
    () => video.start({
      need: { constraints: { ports: { prompt: ['x'], duration: [5] } } },
      credentials: creds, resources, checkpoint: async () => {},
    }),
    (error) => {
      assert.match(error.message, /1147/, 'the upstream reason must survive');
      assert.match(error.message, /502/, 'the status stays as evidence');
      return true;
    },
  );
});

test('collect refuses a media url that is not HTTPS or loopback', async () => {
  // The url is re-read from persisted handle state and consumed without a
  // credential; a file:/data: scheme would fetch something that is not media.
  const { fetch } = fakeFetch([{ json: {}, contentType: 'video/mp4', ok: true }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  await assert.rejects(
    () => video.collect({ handle: { id: 't1', url: 'file:///etc/passwd' }, credentials: creds, resources }),
    /HTTPS|http/i,
  );
});

test('collect downloads over HTTPS and stores the media', async () => {
  const { fetch } = fakeFetch([{ json: {}, contentType: 'video/mp4', ok: true }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  const done = await video.collect({
    handle: { id: 't1', url: 'https://cdn.example.com/a.mp4' }, credentials: creds, resources });
  assert.equal(done.status, 'completed');
});

test('a non-HTTPS, non-loopback baseUrl is refused before any request exists', () => {
  // The credential is a plaintext account:password attached to every request, so
  // a mistyped or hostile baseUrl would mail the user's password elsewhere. The
  // check runs at construction, so the endpoint never exists to be called.
  const { fetch, calls } = fakeFetch([]);
  assert.throws(
    () => createMvaigcEndpoints({
      instance: 'i', pool: 'p', baseUrl: 'http://evil.example.com',
      apiKey: { store: 'local', key: 'mvaigc.local' }, fetch }),
    /baseUrl must be HTTPS or loopback/i,
  );
  assert.equal(calls.length, 0, 'no request may be sent');
});

test('a task missing from bounded history retains its receipt and never resubmits', async () => {
  const { fetch, calls } = fakeFetch([{ json: { status: 'not_found', error: { message: '任务未找到，保留任务号' } } }]);
  const { video } = createMvaigcEndpoints(options(fetch));
  const failed = await video.poll({ handle: { id: 'old-task' }, credentials: creds });
  assert.equal(failed.failure.code, 'MVAIGC_TASK_NOT_FOUND');
  assert.equal(failed.receipt.id, 'old-task');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/tasks\/old-task$/);
});

test('the actual SDK instance supports valid request constraints and refuses image tier substitution', async () => {
  const { createMvaigcProvider } = await import('../dist/endpoint.js');
  const provider = createMvaigcProvider(options(async () => { throw new Error('supports must not submit'); }));
  const image = provider.offers.find(offer => offer.capability.name === 'nano-banana-pro');
  const video = provider.offers.find(offer => offer.capability.name === 'minimax-h3');
  const seedance = provider.offers.find(offer => offer.capability.name === 'seedance-2.5');
  assert.equal(image.supports({ constraints: { ports: { prompt: ['cat'], resolution: ['2K'], outputFormat: ['png'] } } }).status, 'supported');
  assert.equal(image.supports({ constraints: { ports: { prompt: ['cat'], resolution: ['4K'], outputFormat: ['png'] } } }).status, 'unsupported');
  assert.equal(video.supports({ constraints: { ports: { prompt: ['cat'], duration: [5], resolution: ['768P'] } } }).status, 'supported');

  const seedancePortsFor = (patch) => ({ constraints: { ports: {
    prompt: ['换人'], duration: [7], resolution: ['720p'], aspectRatio: ['9:16'],
    generateAudio: [false], webSearch: [false], ...patch,
  } } });
  assert.equal(seedance.supports(seedancePortsFor({})).status, 'supported');
  // `4k` is a Seedance surface value mvaigc does not sell on this model.
  assert.equal(seedance.supports(seedancePortsFor({ resolution: ['4k'] })).status, 'unsupported');
  // No web-search field exists upstream; refuse rather than drop it after payment.
  assert.equal(seedance.supports(seedancePortsFor({ webSearch: [true] })).status, 'unsupported');
});
