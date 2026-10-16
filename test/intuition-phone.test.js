const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRelay } = require('../server');

test('Intuition mobile page is self-contained and uses the shared relay protocol', async t => {
  const html = fs.readFileSync(path.join(__dirname, '../public/ar-games/phone/intuition.html'), 'utf8');
  assert.match(html, /Интуиция/);
  assert.match(html, /Ждём начала/);
  assert.match(html, /intuition\.join/);
  assert.match(html, /intuition\.answer/);
  assert.match(html, /ar-games-intuition/);
  assert.ok(Buffer.byteLength(html) < 80_000, 'phone page stays below 80 KB');
  assert.equal(/<script[^>]+src=/.test(html), false, 'no extra script downloads');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const relay = createRelay();
  t.after(() => relay.close());
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${relay.server.address().port}/ar-games/phone/intuition.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(await response.text(), html);
});
