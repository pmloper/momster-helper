// Usage: node --experimental-strip-types tests/throttle.test.mjs
import assert from 'node:assert/strict';
import { nextCounter } from '../convex/throttleLogic.ts';
const H = 3600_000; let fails = 0;
const check = (n, f) => { try { f(); console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', e.message); } };
check('first hit is allowed and starts a window', () => { const r = nextCounter(null, 1000, 5, H); assert.deepEqual(r, { allowed: true, next: { windowStart: 1000, count: 1 } }); });
check('allows up to the limit then blocks', () => {
  let row = null, ok = 0;
  for (let i = 0; i < 8; i++) { const r = nextCounter(row, 1000 + i, 5, H); if (r.allowed) ok++; row = r.next; }
  assert.equal(ok, 5);
});
check('a new window resets the count', () => { const r = nextCounter({ windowStart: 0, count: 5 }, H + 1, 5, H); assert.equal(r.allowed, true); assert.equal(r.next.count, 1); });
check('blocked hits do not extend the window', () => { const r = nextCounter({ windowStart: 10, count: 5 }, 20, 5, H); assert.deepEqual(r, { allowed: false, next: { windowStart: 10, count: 5 } }); });
console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); process.exit(fails ? 1 : 0);
