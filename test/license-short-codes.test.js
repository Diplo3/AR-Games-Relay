const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortCode, normalizeShortCode, createShortCodeApi } = require('../server/license-short-codes');

test('short license request and activation codes are 25 characters with case and separator tolerance', () => {
  for (const prefix of ['RQ', 'AC']) {
    const code = createShortCode(prefix);
    assert.equal(code.length, 25);
    assert.match(code, new RegExp(`^${prefix}-[0-9A-HJKMNP-TV-Z]{22}$`));
    assert.equal(normalizeShortCode(code.toLowerCase().replace('-', ''), prefix), code);
  }
});

test('short license code checksum rejects accidental typos', () => {
  const code = createShortCode('RQ');
  const replacement = code.endsWith('0') ? '1' : '0';
  const corrupted = `${code.slice(0, -1)}${replacement}`;
  assert.equal(normalizeShortCode(corrupted, 'RQ'), null);
  assert.equal(normalizeShortCode(code, 'AC'), null);
});

test('deleting a customer revokes unredeemed activation codes for that license', async () => {
  let observed;
  const api = createShortCodeApi({
    env: { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', LICENSE_RELAY_ADMIN_KEY: 'x'.repeat(40) },
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return { ok: true, status: 204, text: async () => '' };
    },
  });
  const licenseId = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(await api.revokePendingActivations(licenseId), { revoked: true });
  assert.equal(observed.options.method, 'DELETE');
  assert.match(observed.url, /token_payload->payload->>licenseId=eq\.11111111-2222-4333-8444-555555555555/);
  assert.match(observed.url, /redeemed_at=is\.null/);
});
