import test from 'node:test';
import assert from 'node:assert/strict';

import { nanoBananaPorts } from '@hypit/nano-banana';
import { minimaxH3Ports } from '@hypit/minimax-h3';
import { assertMappingCoversPorts } from '@hypit/generation';
import { imageMapping, videoMapping } from '../dist/provider.js';
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
