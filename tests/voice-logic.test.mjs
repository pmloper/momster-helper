// Usage: node --experimental-strip-types tests/voice-logic.test.mjs
import assert from 'node:assert/strict';
import { cleanName, cleanRespell, nameClipKey, allowGeneration, MAX_NAME_CLIPS_PER_FAMILY, MAX_GENERATIONS_PER_FAMILY_DAY, MAX_GENERATIONS_PER_DAY_EVERYONE } from '../convex/voiceLogic.ts';
let fails = 0;
const check = (n, f) => { try { f(); console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', e.message); } };
check('a normal first name is accepted and trimmed', () => assert.equal(cleanName('  Emma  '), 'Emma'));
check('accents, hyphens, apostrophes and two-part names are fine', () => { for (const n of ['José', 'Anne-Marie', "D'Angelo", 'Mary Kate', 'Zoë', 'Siobhán']) assert.equal(cleanName(n), n); });
check('a name with no Latin letters has no clip key, so it is refused (the device voice reads it)', () => assert.equal(cleanName('李明'), null));
check('empty, long, numeric, link-like or markup names are refused', () => { for (const n of ['', '   ', 'A'.repeat(25), 'R2D2', 'http://x.co', '<b>Hi</b>', 'Emma!!', '1', '-Emma', 'a\nb;drop']) assert.equal(cleanName(n), null, n); });
check('the clip key matches the app (nm_<slug>, accents removed)', () => { assert.equal(nameClipKey('Emma'), 'nm_emma'); assert.equal(nameClipKey('José'), 'nm_jose'); assert.equal(nameClipKey('Anne-Marie'), 'nm_anne-marie'); assert.equal(nameClipKey("D'Angelo"), 'nm_d-angelo'); });
check('a respelling allows letters, hyphens and capitals; refuses symbols and long text', () => { assert.equal(cleanRespell('Sho-VAWN'), 'Sho-VAWN'); assert.equal(cleanRespell(''), null); assert.equal(cleanRespell('x'.repeat(41)), null); assert.equal(cleanRespell('Sho$ vawn'), null); assert.equal(cleanRespell('http://a.b'), null); });
const base = { disabled: false, existing: 0, isNew: true, familyToday: 0, everyoneToday: 0 };
check('a normal request is allowed', () => assert.deepEqual(allowGeneration(base), { ok: true }));
check('the kill switch stops everything', () => assert.deepEqual(allowGeneration({ ...base, disabled: true }), { ok: false, reason: 'off' }));
check('a family can have a limited number of custom names, but can redo one it already has', () => {
  assert.equal(allowGeneration({ ...base, existing: MAX_NAME_CLIPS_PER_FAMILY }).ok, false);
  assert.equal(allowGeneration({ ...base, existing: MAX_NAME_CLIPS_PER_FAMILY, isNew: false }).ok, true);
});
check('a family has a daily limit on generations', () => {
  assert.equal(allowGeneration({ ...base, familyToday: MAX_GENERATIONS_PER_FAMILY_DAY - 1 }).ok, true);
  assert.deepEqual(allowGeneration({ ...base, familyToday: MAX_GENERATIONS_PER_FAMILY_DAY }), { ok: false, reason: 'family-limit' });
});
check('everyone together has a daily spending cap', () => assert.deepEqual(allowGeneration({ ...base, everyoneToday: MAX_GENERATIONS_PER_DAY_EVERYONE }), { ok: false, reason: 'everyone-limit' }));
console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); process.exit(fails ? 1 : 0);
