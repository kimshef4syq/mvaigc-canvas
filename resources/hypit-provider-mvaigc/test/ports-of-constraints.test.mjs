import test from 'node:test';
import assert from 'node:assert/strict';
import { portsOfConstraints } from '../dist/provider.js';

// This guard exists because the SDK types mappingSupportsRequest's parameter as
// `unknown`: handing it an EndpointRequest instead of its `constraints` compiled
// fine and then refused every request, with no error anywhere.

test('reads ports from a constraints object', () => {
  const ports = portsOfConstraints({ ports: { prompt: ['a cat'] } });
  assert.deepEqual(ports, { prompt: ['a cat'] });
});

test('throws when handed the request object itself instead of its constraints', () => {
  // An EndpointRequest has { capability, returns, constraints } and no `ports`.
  const request = { capability: {}, returns: {}, constraints: { ports: { prompt: ['a cat'] } } };
  assert.throws(() => portsOfConstraints(request), /constraints/i);
});

test('throws on a constraint object with no ports', () => {
  assert.throws(() => portsOfConstraints({}), /ports/i);
});
