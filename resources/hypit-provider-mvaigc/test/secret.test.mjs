import test from 'node:test';
import assert from 'node:assert/strict';
import { secretFor } from '../dist/provider.js';

// The proxy needs `Bearer <account>:<password>`. The secret is revealed per
// request on `context.credentials`; a CredentialRef's `key` is only the store's
// lookup name. Sending that name produced `Bearer mvaigc.local` and a 401, and
// no test caught it because they all injected the token directly.

test('reads the revealed secret from the invocation context', () => {
  assert.equal(secretFor({ credentials: { apiKey: { secret: 'user:pass' } } }), 'user:pass');
});

test('a credential reference key is never used as the token', () => {
  // Shaped like a CredentialRef: { store, key } with no `secret`.
  const asRef = { credentials: { apiKey: { store: 'local', key: 'mvaigc.local' } } };
  assert.throws(() => secretFor(asRef), /auth login mvaigc\.local/i);
});

test('missing credentials fail loudly instead of sending an empty bearer', () => {
  assert.throws(() => secretFor({}), /auth login/i);
  assert.throws(() => secretFor({ credentials: {} }), /auth login/i);
  assert.throws(() => secretFor({ credentials: { apiKey: { secret: '' } } }), /auth login/i);
});

test('a value without a colon is refused, because the proxy needs account:password', () => {
  // The proxy splits on ':' and falls through to the Canvas's own stored
  // credentials when it finds none — so a colon-less value would silently bill
  // the wrong account instead of telling the user what to type.
  assert.throws(() => secretFor({ credentials: { apiKey: { secret: 'justapassword' } } }), /<account>:<password>/i);
});

test('an account:password value with a real password is accepted', () => {
  assert.equal(secretFor({ credentials: { apiKey: { secret: 'acct:pw' } } }), 'acct:pw');
});
