// Cloud sign-in logic with no browser or network dependencies, so it can be unit tested.
// cloud.js wires it to the real Convex client. Sync is optional: with no `url`, everything here is inert.
export function createCloud({ ConvexClient, anyApi, url, storage, now = () => Date.now() }) {
  const KEY_JWT = "momster_auth_jwt", KEY_REFRESH = "momster_auth_refresh";
  const configured = !!url;
  const listeners = new Set();
  let client = null, signedIn = false;

  const read = k => { try { return storage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { storage.setItem(k, v); } catch (e) {} };
  const drop = k => { try { storage.removeItem(k); } catch (e) {} };
  const setSignedIn = ok => { if (ok === signedIn) return; signedIn = ok; listeners.forEach(f => { try { f(ok); } catch (e) {} }); };

  function expiryMs(jwt) {
    try { const b = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(b)).exp * 1000; }
    catch (e) { return 0; }
  }
  function saveTokens(t) { write(KEY_JWT, t.token); write(KEY_REFRESH, t.refreshToken); }
  function clearTokens() { drop(KEY_JWT); drop(KEY_REFRESH); }

  function getClient() {
    if (!configured) throw new Error("Sync is not set up for this app yet.");
    if (!client) {
      client = new ConvexClient(url);
      client.setAuth(fetchToken, ok => setSignedIn(!!ok));
    }
    return client;
  }

  // Called by the Convex client whenever it needs a token.
  async function fetchToken({ forceRefreshToken } = {}) {
    const jwt = read(KEY_JWT), refresh = read(KEY_REFRESH);
    if (jwt && !forceRefreshToken && expiryMs(jwt) - now() > 30000) return jwt;
    if (!refresh) return null;
    try {
      const r = await getClient().action(anyApi.auth.signIn, { refreshToken: refresh });
      if (r && r.tokens) { saveTokens(r.tokens); return r.tokens.token; }
    } catch (e) { /* fall through: treat as signed out */ }
    clearTokens();
    return null;
  }

  return {
    configured,
    get signedIn() { return signedIn; },
    get client() { return configured ? getClient() : null; },
    api: anyApi,
    hasStoredLogin: () => !!read(KEY_REFRESH),
    onAuthChange(f) { listeners.add(f); return () => listeners.delete(f); },
    // Resume a saved login on page load.
    async resume() { if (!configured || !read(KEY_REFRESH)) return false; const t = await fetchToken(); setSignedIn(!!t); getClient(); return !!t; },
    // Step 1: ask for a code to be emailed.
    async requestCode(email) {
      const e = String(email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("That does not look like an email address.");
      await getClient().action(anyApi.auth.signIn, { provider: "email-code", params: { email: e } });
      return e;
    },
    // Step 2: check the code.
    async verifyCode(email, code) {
      const e = String(email || "").trim().toLowerCase(), c = String(code || "").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(c)) throw new Error("The code is 6 numbers.");
      const r = await getClient().action(anyApi.auth.signIn, { provider: "email-code", params: { email: e, code: c } });
      if (!r || !r.tokens) throw new Error("That code did not work. Check it and try again.");
      saveTokens(r.tokens);
      getClient().setAuth(fetchToken, ok => setSignedIn(!!ok));
      return true;
    },
    async signOut() {
      try { if (client && signedIn) await client.action(anyApi.auth.signOut, {}); } catch (e) {}
      clearTokens();
      if (client) { try { client.client.clearAuth(); } catch (e) {} }
      setSignedIn(false);
    },
  };
}
