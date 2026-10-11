// Unit checks for the sign-in code sender (convex/authEmail.ts). No browser or Convex deployment needed.
// Usage: node --experimental-strip-types tests/auth-email.test.mjs
import assert from 'node:assert/strict';
import { sendAuthEmail, EmailCode } from '../convex/authEmail.ts';

let fails = 0;
const check = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } };
const realFetch = globalThis.fetch, realLog = console.log;

await check('codes are 6 digits and varied', async () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const c = await EmailCode.options.generateVerificationToken(); assert.match(c, /^\d{6}$/); seen.add(c); }
  assert.ok(seen.size > 150, `only ${seen.size} distinct codes in 200`);
});
await check('code lifetime is 10 minutes and emails are normalized', async () => {
  assert.equal(EmailCode.options.maxAge, 600);
  assert.equal(EmailCode.options.normalizeIdentifier('  Mom@Example.COM '), 'mom@example.com');
});
await check('the typed email is matched case-insensitively', async () => {
  await EmailCode.options.authorize({ email: ' Mom@Example.com ' }, { providerAccountId: 'mom@example.com' });
  await assert.rejects(() => EmailCode.options.authorize({ email: 'other@example.com' }, { providerAccountId: 'mom@example.com' }));
  await assert.rejects(() => EmailCode.options.authorize({}, { providerAccountId: 'mom@example.com' }));
});
await check('without a webhook the code is only logged', async () => {
  delete process.env.AUTH_EMAIL_WEBHOOK_URL; let fetched = false; globalThis.fetch = async () => { fetched = true; return new Response('', { status: 200 }); };
  let line = ''; console.log = s => { line = String(s); };
  await sendAuthEmail('a@b.co', '123456'); console.log = realLog;
  assert.equal(fetched, false); assert.match(line, /123456/);
});
await check('with a webhook it posts email, code and expiry with the secret header', async () => {
  process.env.AUTH_EMAIL_WEBHOOK_URL = 'https://example.test/hook'; process.env.AUTH_EMAIL_WEBHOOK_SECRET = 's3cret';
  let call; globalThis.fetch = async (url, init) => { call = { url, init }; return new Response('', { status: 200 }); };
  await sendAuthEmail('a@b.co', '654321');
  assert.equal(call.url, 'https://example.test/hook'); assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['x-webhook-secret'], 's3cret');
  assert.deepEqual(JSON.parse(call.init.body), { email: 'a@b.co', code: '654321', expiresInMinutes: 10, app: 'Momster Helper' });
});
await check('a failing webhook fails the sign-in request', async () => {
  globalThis.fetch = async () => new Response('no', { status: 500 });
  await assert.rejects(() => sendAuthEmail('a@b.co', '111111'), /500/);
});
globalThis.fetch = realFetch;
console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS');
process.exit(fails ? 1 : 0);
