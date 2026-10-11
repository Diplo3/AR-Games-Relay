'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function codeChecksum(prefix, payload) {
  const digest = createHash('sha256').update(`${prefix}-${payload}`).digest();
  const value = digest.readUInt16BE(0) & 1023;
  return alphabet[(value >> 5) & 31] + alphabet[value & 31];
}

function createShortCode(prefix) {
  const bytes = randomBytes(13);
  bytes[0] &= 0x0f; // 100 random bits => 20 base32 characters.
  const raw = BigInt(`0x${bytes.toString('hex')}`).toString(32).padStart(20, '0');
  const payload = [...raw].map((character) => alphabet[Number.parseInt(character, 32)]).join('');
  return `${prefix}-${payload}${codeChecksum(prefix, payload)}`;
}

function normalizeShortCode(value, prefix) {
  const text = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const compactPrefix = prefix.replace('-', '');
  if (!text.startsWith(compactPrefix) || text.length !== compactPrefix.length + 22) return null;
  const payload = text.slice(compactPrefix.length, compactPrefix.length + 20);
  const checksum = text.slice(-2);
  if (![...payload, ...checksum].every((character) => alphabet.includes(character))) return null;
  if (codeChecksum(prefix, payload) !== checksum) return null;
  return `${prefix}-${payload}${checksum}`;
}

function hashCode(code) { return createHash('sha256').update(code).digest('hex'); }
function validDeviceId(value) { return typeof value === 'string' && /^sha256:[0-9A-F]{64}$/.test(value); }
function validProductCode(value) { return typeof value === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(value); }

function createShortCodeApi({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  function settings() {
    const baseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!baseUrl || !serviceKey) {
      const error = new Error('Хранилище коротких кодов не настроено.'); error.status = 503; error.code = 'LICENSE_STORE_UNAVAILABLE'; throw error;
    }
    return { baseUrl, serviceKey };
  }

  async function db(path, { method = 'GET', body, prefer = '' } = {}) {
    const { baseUrl, serviceKey } = settings();
    const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(prefer ? { prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error('Не удалось обратиться к хранилищу коротких кодов.');
      error.status = response.status >= 500 ? 503 : 400;
      error.code = 'LICENSE_STORE_ERROR';
      throw error;
    }
    return data;
  }

  function requireAdmin(request) {
    const expected = env.LICENSE_RELAY_ADMIN_KEY || '';
    const supplied = request.get('x-ar-license-admin-key') || '';
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    if (left.length < 32 || left.length !== right.length || !timingSafeEqual(left, right)) {
      const error = new Error('Недостаточно прав для выдачи кода.'); error.status = 401; error.code = 'ADMIN_KEY_INVALID'; throw error;
    }
  }

  function wrap(handler) {
    return async (request, response) => {
      try { await handler(request, response); }
      catch (error) {
        response.status(error.status || 503).json({ error: { code: error.code || 'LICENSE_SERVICE_ERROR', message: error.message || 'Сервис лицензий временно недоступен.' } });
      }
    };
  }

  async function createRequest(body) {
    if (!body || !validProductCode(body.productCode) || !validDeviceId(body.deviceId)
      || !['windows', 'macos', 'linux'].includes(body.platform)
      || typeof body.productName !== 'string' || !body.productName.trim() || body.productName.length > 120
      || typeof body.appVersion !== 'string' || body.appVersion.length > 80) {
      const error = new Error('Некорректные данные запроса на активацию.'); error.status = 400; error.code = 'INVALID_ACTIVATION_REQUEST'; throw error;
    }
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 30 * 86400000).toISOString();
    const request = {
      version: 1,
      productCode: body.productCode,
      productName: body.productName.trim(),
      deviceId: body.deviceId,
      platform: body.platform,
      appVersion: body.appVersion,
      createdAt: createdAt.toISOString(),
    };
    // Old request handles are pruned opportunistically so the table stays small.
    await db(`ar_license_requests?expires_at=lt.${encodeURIComponent(createdAt.toISOString())}`, { method: 'DELETE' });
    await db(`ar_license_activations?expires_at=lt.${encodeURIComponent(createdAt.toISOString())}`, { method: 'DELETE' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const requestCode = createShortCode('RQ');
      try {
        await db('ar_license_requests', {
          method: 'POST',
          body: { code_hash: hashCode(requestCode), request_payload: request, created_at: createdAt.toISOString(), expires_at: expiresAt },
          prefer: 'return=minimal',
        });
        return { requestCode, expiresAt };
      } catch (error) { if (![400, 409].includes(error.status) || attempt === 2) throw error; }
    }
    throw new Error('Не удалось создать код запроса.');
  }

  async function getRequest(requestCode) {
    const normalized = normalizeShortCode(requestCode, 'RQ');
    if (!normalized) { const error = new Error('Код запроса имеет неверный формат.'); error.status = 400; error.code = 'INVALID_REQUEST_CODE'; throw error; }
    const rows = await db(`ar_license_requests?code_hash=eq.${hashCode(normalized)}&expires_at=gt.${encodeURIComponent(now().toISOString())}&select=request_payload,expires_at`);
    if (!rows?.[0]) { const error = new Error('Код запроса не найден или срок его действия истёк.'); error.status = 404; error.code = 'REQUEST_CODE_NOT_FOUND'; throw error; }
    return { request: rows[0].request_payload, expiresAt: rows[0].expires_at };
  }

  async function publishActivation({ requestCode, license }) {
    if (!license?.payload || typeof license.encodedPayload !== 'string' || typeof license.signature !== 'string') {
      const error = new Error('Подписанный токен лицензии не передан.'); error.status = 400; error.code = 'INVALID_LICENSE_TOKEN'; throw error;
    }
    const resolved = await getRequest(requestCode);
    const request = resolved.request;
    if (license.payload.deviceId !== request.deviceId || !license.payload.productCodes?.includes(request.productCode)) {
      const error = new Error('Токен не соответствует коду запроса и купленной игре.'); error.status = 409; error.code = 'LICENSE_REQUEST_MISMATCH'; throw error;
    }
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 30 * 86400000).toISOString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const activationCode = createShortCode('AC');
      try {
        await db('ar_license_activations', {
          method: 'POST',
          body: {
            code_hash: hashCode(activationCode), token_payload: license,
            device_id: request.deviceId, product_code: request.productCode,
            created_at: createdAt.toISOString(), expires_at: expiresAt,
          },
          prefer: 'return=minimal',
        });
        return { activationCode, expiresAt };
      } catch (error) { if (![400, 409].includes(error.status) || attempt === 2) throw error; }
    }
    throw new Error('Не удалось создать код активации.');
  }

  async function redeem({ activationCode, deviceId, productCode }) {
    const normalized = normalizeShortCode(activationCode, 'AC');
    if (!normalized || !validDeviceId(deviceId) || !validProductCode(productCode)) {
      const error = new Error('Код активации или идентификатор игры имеет неверный формат.'); error.status = 400; error.code = 'INVALID_ACTIVATION_CODE'; throw error;
    }
    const rows = await db('rpc/redeem_ar_games_activation', {
      method: 'POST', body: { p_code_hash: hashCode(normalized), p_device_id: deviceId, p_product_code: productCode },
    });
    if (!rows) { const error = new Error('Код активации не найден, истёк или предназначен для другой установки.'); error.status = 404; error.code = 'ACTIVATION_CODE_NOT_FOUND'; throw error; }
    return { license: rows };
  }

  async function revokePendingActivations(licenseId) {
    if (typeof licenseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(licenseId)) {
      const error = new Error('Некорректный идентификатор лицензии.'); error.status = 400; error.code = 'INVALID_LICENSE_ID'; throw error;
    }
    const filter = `token_payload->payload->>licenseId=eq.${encodeURIComponent(licenseId)}&redeemed_at=is.null`;
    await db(`ar_license_activations?${filter}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { revoked: true };
  }

  function register(app, express) {
    const body = express.json({ limit: '16kb', strict: true });
    app.post('/api/v1/license/requests', body, wrap(async (request, response) => response.status(201).json(await createRequest(request.body))));
    app.post('/api/v1/license/redeem', body, wrap(async (request, response) => response.json(await redeem(request.body || {}))));
    app.get('/api/v1/admin/license-requests/:code', wrap(async (request, response) => {
      requireAdmin(request); response.json(await getRequest(request.params.code));
    }));
    app.post('/api/v1/admin/activation-codes', body, wrap(async (request, response) => {
      requireAdmin(request); response.status(201).json(await publishActivation(request.body || {}));
    }));
    app.post('/api/v1/admin/license-activations/revoke', body, wrap(async (request, response) => {
      requireAdmin(request); response.json(await revokePendingActivations(request.body?.licenseId));
    }));
  }

  return { register, createRequest, getRequest, publishActivation, redeem, revokePendingActivations };
}

module.exports = { createShortCodeApi, createShortCode, normalizeShortCode, hashCode };
