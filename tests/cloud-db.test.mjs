// Unit checks for cloud-db.js with a fake Convex client. Usage: node tests/cloud-db.test.mjs
import assert from 'node:assert/strict';
import { createDb } from '../cloud-db.js';

let fails = 0;
const check = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } };
const api = { docs: { list: 'list', listVoices: 'listVoices', set: 'set', setMany: 'setMany', remove: 'remove' } };
function fake() {
  const subs = { list: [], listVoices: [] }, writes = []; let holdWrites = null;
  const client = {
    onUpdate(ref, args, cb) { subs[ref].push(cb); return () => {}; },
    mutation(ref, args) { writes.push([ref, args]); return holdWrites ? new Promise(res => holdWrites.push(res)) : Promise.resolve(); },
  };
  return { client, subs, writes, push: (rows, which = 'list') => subs[which].forEach(f => f(rows)), hold() { holdWrites = []; return holdWrites; } };
}

await check('doc listeners get exists:false then data once the first list arrives', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start();
  const seen = []; db.doc('settings/main').onSnapshot(s => seen.push(s.exists ? s.data() : null));
  assert.deepEqual(seen, []);
  f.push([{ path: 'weeks/w1_k1', data: { bonus: 1 }, updatedAt: 1 }]);
  assert.deepEqual(seen, [null]);
  f.push([{ path: 'settings/main', data: { goal: 100 }, updatedAt: 2 }]);
  assert.deepEqual(seen, [null, { goal: 100 }]);
});
await check('collection snapshots list every doc in the collection', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start();
  let ids; db.collection('weeks').onSnapshot(qs => { ids = qs.docs.map(d => d.id).sort(); });
  f.push([{ path: 'weeks/a_k1', data: {}, updatedAt: 1 }, { path: 'weeks/b_k1', data: {}, updatedAt: 1 }, { path: 'buddies/k1', data: {}, updatedAt: 1 }]);
  assert.deepEqual(ids, ['a_k1', 'b_k1']);
});
await check('set writes through and does not echo to listeners', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start(); f.push([]);
  const seen = []; db.doc('buddies/k1').onSnapshot(s => seen.push(s.exists));
  await db.doc('buddies/k1').set({ spent: 3 });
  assert.deepEqual(f.writes, [['set', { path: 'buddies/k1', data: { spent: 3 } }]]);
  assert.deepEqual(seen, [false]);                     // initial only
  assert.deepEqual((await db.doc('buddies/k1').get()).data(), { spent: 3 });
});
await check('a stale server snapshot does not overwrite a pending local write', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start(); f.push([{ path: 'weeks/w_k1', data: { bonus: 0 }, updatedAt: 1 }]);
  const seen = []; db.doc('weeks/w_k1').onSnapshot(s => seen.push(s.data().bonus));
  const held = f.hold(); const p = db.doc('weeks/w_k1').set({ bonus: 2 });
  f.push([{ path: 'weeks/w_k1', data: { bonus: 1 }, updatedAt: 2 }]);   // older echo arrives mid-flight
  assert.deepEqual(seen, [0]);
  held.forEach(r => r()); await p;
  f.push([{ path: 'weeks/w_k1', data: { bonus: 2 }, updatedAt: 3 }]);
  assert.equal((await db.doc('weeks/w_k1').get()).data().bonus, 2);
});
await check('remote deletes remove the doc and notify', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start(); f.push([{ path: 'teams/w1', data: { given: true }, updatedAt: 1 }]);
  const seen = []; db.doc('teams/w1').onSnapshot(s => seen.push(s.exists)); f.push([]);
  assert.deepEqual(seen, [true, false]);
});
await check('get waits for the first load', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start();
  const p = db.doc('settings/main').get(); f.push([{ path: 'settings/main', data: { goal: 5 }, updatedAt: 1 }]);
  assert.equal((await p).exists, true);
});
await check('bulkSet uploads in chunks of 50', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start(); f.push([]);
  await db.bulkSet(Array.from({ length: 120 }, (_, i) => ({ path: `weeks/x${i}_k1`, data: { i } })));
  assert.deepEqual(f.writes.map(w => w[1].items.length), [50, 50, 20]);
});
await check('voices are tracked separately from the main list', async () => {
  const f = fake(), db = createDb({ client: f.client, api }); db.start(); f.push([]);
  let n = -1; db.collection('voices').onSnapshot(qs => { n = qs.size; });
  f.push([{ path: 'voices/great', data: { mime: 'audio/mp4', b64: 'AAAA' }, updatedAt: 1 }], 'listVoices');
  assert.equal(n, 1);
});
console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); process.exit(fails ? 1 : 0);
