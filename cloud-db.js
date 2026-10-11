// Firestore-style document shim over the Convex `docs` functions, so the app's existing sync code
// (db.doc(path).set/get/onSnapshot, db.collection(name).onSnapshot) works unchanged.
// Pure logic with an injected client, so it can be unit tested.
export function createDb({ client, api }) {
  const cache = new Map();          // path -> data
  const docListeners = new Map();   // path -> Set(cb)
  const colListeners = new Map();   // collection name -> Set(cb)
  const pending = new Map();        // path -> number of unsettled local writes
  const waiters = [];
  let loaded = false, voicesLoaded = false;
  const unsubs = [];

  const clone = x => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
  const nameOf = path => path.split("/")[0];
  const idOf = path => path.slice(path.indexOf("/") + 1);
  const snap = path => ({ exists: cache.has(path), id: idOf(path), data: () => clone(cache.get(path)) });
  const colSnap = name => {
    const docs = [...cache.keys()].filter(p => nameOf(p) === name).map(p => snap(p));
    return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
  };
  const fire = (set, arg) => { if (set) set.forEach(cb => { try { cb(arg); } catch (e) { console.warn(e); } }); };
  const notify = (paths, all) => {
    const cols = new Set();
    (all ? [...docListeners.keys()] : paths).forEach(p => { fire(docListeners.get(p), snap(p)); cols.add(nameOf(p)); });
    if (all) colListeners.forEach((_, n) => cols.add(n));
    cols.forEach(n => fire(colListeners.get(n), colSnap(n)));
  };

  function apply(rows, filter) {
    const seen = new Set(), changed = [];
    rows.forEach(r => {
      seen.add(r.path);
      if (pending.get(r.path)) return;                       // keep our newer local write until it settles
      const before = JSON.stringify(cache.get(r.path));
      if (!cache.has(r.path) || before !== JSON.stringify(r.data)) { cache.set(r.path, clone(r.data)); changed.push(r.path); }
    });
    [...cache.keys()].forEach(p => {                          // deleted elsewhere
      if (filter(p) && !seen.has(p) && !pending.get(p)) { cache.delete(p); changed.push(p); }
    });
    return changed;
  }

  function start() {
    unsubs.push(client.onUpdate(api.docs.list, {}, rows => {
      if (rows === null) return;                              // not signed in / no family
      const first = !loaded; loaded = true;
      const changed = apply(rows, p => nameOf(p) !== "voices");
      notify(changed, first);
      if (first) waiters.splice(0).forEach(f => f());
    }, e => console.warn("sync error", e)));
    unsubs.push(client.onUpdate(api.docs.listVoices, {}, rows => {
      if (rows === null) return;
      const first = !voicesLoaded; voicesLoaded = true;
      const changed = apply(rows, p => nameOf(p) === "voices");
      if (first || changed.length) { changed.forEach(p => fire(docListeners.get(p), snap(p))); fire(colListeners.get("voices"), colSnap("voices")); }
    }, e => console.warn("sync error", e)));
  }

  const whenLoaded = () => (loaded ? Promise.resolve() : new Promise(res => waiters.push(res)));
  const track = (path, promise) => {
    pending.set(path, (pending.get(path) || 0) + 1);
    const done = () => pending.set(path, pending.get(path) - 1);
    return promise.then(r => { done(); return r; }, e => { done(); throw e; });
  };

  return {
    start,
    stop() { unsubs.splice(0).forEach(u => { try { u(); } catch (e) {} }); loaded = voicesLoaded = false; cache.clear(); },
    isLoaded: () => loaded,
    whenLoaded,
    paths: () => [...cache.keys()],
    doc(path) {
      return {
        set(data) { const d = clone(data); cache.set(path, d); return track(path, client.mutation(api.docs.set, { path, data: d })); },
        delete() { cache.delete(path); return track(path, client.mutation(api.docs.remove, { path })); },
        async get() { await whenLoaded(); return snap(path); },
        onSnapshot(cb, err) {
          if (!docListeners.has(path)) docListeners.set(path, new Set());
          docListeners.get(path).add(cb);
          if (loaded) { try { cb(snap(path)); } catch (e) { if (err) err(e); } }
          return () => docListeners.get(path) && docListeners.get(path).delete(cb);
        },
      };
    },
    collection(name) {
      return {
        async get() { await whenLoaded(); return colSnap(name); },
        onSnapshot(cb, err) {
          if (!colListeners.has(name)) colListeners.set(name, new Set());
          colListeners.get(name).add(cb);
          if (loaded) { try { cb(colSnap(name)); } catch (e) { if (err) err(e); } }
          return () => colListeners.get(name) && colListeners.get(name).delete(cb);
        },
      };
    },
    // Upload many documents at once (first sync of a family's existing data).
    async bulkSet(items) {
      for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50).map(x => ({ path: x.path, data: clone(x.data) }));
        chunk.forEach(x => cache.set(x.path, x.data));
        await client.mutation(api.docs.setMany, { items: chunk });
      }
    },
  };
}
