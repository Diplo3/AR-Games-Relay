const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRelay } = require('../server');

test('Kto Blizhe QR target and its scripts are served from the public phone directory', async t => {
  const relay = createRelay();
  t.after(() => relay.close());
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + relay.server.address().port;
  const target = '/ar-games/phone/kto-blizhe.html?room=QATEST01';
  const response = await fetch(origin + target);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.equal(html, fs.readFileSync(path.join(__dirname, '../public/ar-games/phone/kto-blizhe.html'), 'utf8'));
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    const resource = await fetch(new URL(script, origin + target));
    assert.equal(resource.status, 200, script);
    assert.match(resource.headers.get('content-type'), /javascript/);
    new vm.Script(await resource.text(), { filename: script });
  }
  const client = fs.readFileSync(path.join(__dirname, '../public/ar-games/phone/kto-blizhe.js'), 'utf8');
  assert.match(client, /kto-blizhe\.join/);
  assert.match(client, /kto-blizhe\.answer/);
  assert.match(client, /ar-games-kto-blizhe/);
});
