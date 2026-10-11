// Unit checks for cloud-core.js using a fake Convex client. Usage: node tests/cloud-core.test.mjs
import assert from 'node:assert/strict';
import { createCloud } from '../cloud-core.js';

let fails = 0;
const check = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } };
const jwt = exp => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const anyApi = { auth: { signIn: 'signIn', signOut: 'signOut' } };
function fake(handler) {
  const calls = [];
  class ConvexClient { constructor(url) { this.url = url; this.client = { clearAuth() { calls.push(['clearAuth']); } }; }
    setAuth(f, cb) { this.fetchToken = f; this.cb = cb; calls.push(['setAuth']); }
    async action(ref, args) { calls.push([ref, args]); return handler(ref, args); } }
  return { ConvexClient, calls };
}
const T = 1_000_000_000_000;

await check('not configured: inert and refuses to talk to a server', async () => {
  const { ConvexClient } = fake(() => ({})); const c = createCloud({ ConvexClient, anyApi, url: '', storage: mem() });
  assert.equal(c.configured, false); assert.equal(c.client, null); assert.equal(await c.resume(), false);
  await assert.rejects(() => c.requestCode('a@b.co'), /not set up/);
});
await check('requestCode validates and normalizes the email', async () => {
  const { ConvexClient, calls } = fake(() => ({})); const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: mem() });
  await assert.rejects(() => c.requestCode('nope'), /email/);
  assert.equal(await c.requestCode('  Mom@Example.COM '), 'mom@example.com');
  assert.deepEqual(calls.find(x => x[0] === 'signIn')[1], { provider: 'email-code', params: { email: 'mom@example.com' } });
});
await check('verifyCode stores tokens and reports signed in', async () => {
  const st = mem(); const tokens = { token: jwt((T + 3600_000) / 1000), refreshToken: 'r1' };
  const { ConvexClient, calls } = fake((ref, a) => (a.params && a.params.code ? { tokens } : {}));
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: st, now: () => T });
  await c.requestCode('a@b.co'); await assert.rejects(() => c.verifyCode('a@b.co', '12'), /6 numbers/);
  await c.verifyCode('a@b.co', ' 123 456 ');
  assert.equal(st.getItem('momster_auth_refresh'), 'r1');
  const verify = calls.filter(x => x[0] === 'signIn').pop()[1]; assert.equal(verify.params.code, '123456');
  const cli = c.client; cli.cb(true); assert.equal(c.signedIn, true);
});
await check('a wrong code throws a friendly error', async () => {
  const { ConvexClient } = fake((ref, a) => (a.params && a.params.code ? {} : {}));
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: mem() });
  await assert.rejects(() => c.verifyCode('a@b.co', '000000'), /did not work/);
});
await check('fetchToken reuses a fresh token and refreshes an expiring one', async () => {
  const st = mem(); const fresh = jwt((T + 3600_000) / 1000), stale = jwt((T + 5_000) / 1000);
  const { ConvexClient, calls } = fake(() => ({ tokens: { token: fresh, refreshToken: 'r2' } }));
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: st, now: () => T });
  st.setItem('momster_auth_jwt', fresh); st.setItem('momster_auth_refresh', 'r1');
  assert.equal(await c.client.fetchToken({}), fresh); assert.equal(calls.filter(x => x[0] === 'signIn').length, 0);
  st.setItem('momster_auth_jwt', stale);
  assert.equal(await c.client.fetchToken({}), fresh); assert.equal(st.getItem('momster_auth_refresh'), 'r2');
  assert.equal(calls.filter(x => x[0] === 'signIn').length, 1);
});
await check('a network failure keeps the login for later', async () => {
  const st = mem(); st.setItem('momster_auth_refresh', 'keep');
  const { ConvexClient } = fake(() => { throw new Error('Failed to fetch'); });
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: st, now: () => T });
  assert.equal(await c.resume(), false); assert.equal(st.getItem('momster_auth_refresh'), 'keep');
});
await check('an invalid login signs the user out locally', async () => {
  const st = mem(); st.setItem('momster_auth_refresh', 'bad');
  const { ConvexClient } = fake(() => { throw new Error('Invalid refresh token'); });
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: st, now: () => T });
  assert.equal(await c.resume(), false); assert.equal(st.getItem('momster_auth_refresh'), null);
});
await check('signOut clears tokens and notifies listeners', async () => {
  const st = mem(); const tokens = { token: jwt((T + 3600_000) / 1000), refreshToken: 'r1' };
  const { ConvexClient, calls } = fake((ref, a) => (a.params && a.params.code ? { tokens } : {}));
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: st, now: () => T });
  const seen = []; c.onAuthChange(v => seen.push(v));
  await c.verifyCode('a@b.co', '123456'); c.client.cb(true); await c.signOut();
  assert.equal(st.getItem('momster_auth_jwt'), null); assert.deepEqual(seen, [true, false]); assert.ok(calls.some(x => x[0] === 'signOut'));
});
await check('parallel token requests share one refresh', async () => {
  const st = mem(); st.setItem('momster_auth_refresh', 'r1');
  const { ConvexClient, calls } = fake(async () => { await new Promise(r => setTimeout(r, 20)); return { tokens: { token: jwt((T + 3600_000) / 1000), refreshToken: 'r2' } }; });
  const c = createCloud({ ConvexClient, anyApi, url: 'https://x.convex.cloud', storage: st, now: () => T });
  await Promise.all([c.client.fetchToken({}), c.client.fetchToken({ forceRefreshToken: true }), c.resume()]);
  assert.equal(calls.filter(x => x[0] === 'signIn').length, 1);
});
console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); process.exit(fails ? 1 : 0);
