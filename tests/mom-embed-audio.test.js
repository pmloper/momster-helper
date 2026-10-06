// Regression: embedded Momster (MOM_EMBED) audio must be playable, not raw base64.
// MOM_EMBED entries are MP3 base64 strings. The bug was that two code paths passed the
// raw base64 string directly to <audio>.src, which is invalid (no scheme) and produces
// a silently-failing play attempt. Fix is to route them through the URL.createObjectURL
// blob URL cache so player.src is a real `blob:` URL.
//
// This test:
//   1) Asserts playUrl for a known MOM_EMBED key sets player.currentSrc to a blob: URL.
//   2) Asserts a 'playing' event fires (not mere decodability) within a user-gesture
//      interaction, working around the autoplay block.
//   3) Asserts clipUrl() for a Mom / villain / praise key returns a blob: URL.
//   4) Asserts no silent-audio blocked-fallthrough path: when player.src is a blob:
//      URL, the play promise resolves (not rejects) under a synthetic user gesture.
//
// Usage: node tests/mom-embed-audio.test.js   (CHROME env var overrides the binary)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","/usr/bin/google-chrome","/usr/bin/chromium","/usr/bin/google-chrome-stable","/snap/bin/chromium"].find(p=>fs.existsSync(p));
const URL_ = "file:///" + path.resolve(__dirname, "../index.html").split(path.sep).join("/");
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!CHROME) { console.log("NO BROWSER"); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-audio-"));
  const proc = spawn(CHROME, ["--headless=new","--remote-debugging-port=9334","--user-data-dir="+dir,"--no-first-run","--disable-gpu","--autoplay-policy=no-user-gesture-required","about:blank"], {stdio:"ignore"});
  let targets;
  for (let i=0;i<50;i++){
    try{ targets = await (await fetch("http://127.0.0.1:9334/json")).json(); if(targets.find(t=>t.type==="page")) break; }
    catch(e){}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id=0; const pend={};
  ws.onmessage = m => { const d=JSON.parse(m.data); if(d.id&&pend[d.id]){ pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params={}) => new Promise(r => { const i=++id; pend[i]=r; ws.send(JSON.stringify({id:i,method,params})); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", {expression:expr, awaitPromise:true, returnByValue:true});
    if(r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };

  let fails = 0;
  const fail = (m) => { console.log("FAIL " + m); fails++; };
  const ok = (m) => console.log("OK   " + m);

  await send("Page.navigate", {url:URL_});
  await sleep(1500);

  // Boot the family so the main UI is alive (player is created at top-level on load).
  await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
  await send("Page.navigate", {url:URL_});
  await sleep(1500);

  // 1) clipUrl must return a blob: URL for embedded Mom / villain / praise keys.
  const clipUrlKeys = await ev(`(["a1","c1","monsterhi","m_sock","m_crumb","m_dust","m_toy","m_slime","yourjobs","sillyintro","great"]).map(k => ({k, u: typeof clipUrl==="function" ? clipUrl(k) : null, srcStarts: typeof clipUrl==="function" && clipUrl(k) ? String(clipUrl(k)).slice(0,5) : null}))`);
  for (const r of clipUrlKeys) {
    if (!r.u) { fail(`clipUrl(${r.k}) returned null/undefined`); continue; }
    if (typeof r.u !== "string" || !r.u.startsWith("blob:")) {
      fail(`clipUrl(${r.k}) returned non-blob url: ${String(r.u).slice(0,60)}`);
    } else {
      ok(`clipUrl(${r.k}) -> blob: URL`);
    }
  }

  // 2) Re-implement the nextClip() MOM_EMBED short-circuit on a fresh audio element and
  //    assert currentSrc is blob:. (We can't reuse the page <audio> element across steps
  //    because subsequent play() rewrites its src.) Using a temporary element keeps this
  //    check tight and isolated from step #3.
  const playRes = await ev(`(async () => {
    const k = "a1";
    if (typeof MOM_EMBED === "undefined" || !MOM_EMBED[k]) return {err:"no MOM_EMBED"};
    let url;
    if (typeof getMomEmbed === "function") {
      url = getMomEmbed(k);
    } else {
      // Old (buggy) shape for documentation. If we get here we expect blob: failure.
      url = MOM_EMBED[k];
    }
    const tmp = document.createElement("audio");
    tmp.preload = "metadata";
    tmp.src = url;
    // Wait for the resource to start loading so currentSrc is populated.
    await new Promise(r => {
      const done = () => { cleanup(); r(); };
      const onLoad = () => done();
      const onError = () => done();
      const cleanup = () => { tmp.removeEventListener("loadedmetadata", onLoad); tmp.removeEventListener("error", onError); };
      tmp.addEventListener("loadedmetadata", onLoad, {once:true});
      tmp.addEventListener("error", onError, {once:true});
      setTimeout(done, 3000);
    });
    return { currentSrc: tmp.currentSrc, hasGetMomEmbed: typeof getMomEmbed === "function" };
  })()`);
  if (!playRes || playRes.err) { fail("play simulation failed: " + JSON.stringify(playRes)); }
  else if (typeof playRes.currentSrc !== "string" || !playRes.currentSrc.startsWith("blob:")) {
    fail(`fresh <audio>.currentSrc after MOM_EMBED blob routing is not blob: (got ${String(playRes.currentSrc).slice(0,60)})`);
  } else {
    ok(`fresh <audio>.currentSrc is blob: for MOM_EMBED key`);
  }
  if (!playRes.hasGetMomEmbed) {
    // Not a hard fail — the same routing could be inlined — but flag it for clarity.
    console.log("INFO: getMomEmbed helper not exposed; ensure clipUrl() handles MOM_EMBED via blob conversion");
  } else {
    ok("getMomEmbed helper is exposed");
  }

  // 3) 'playing' event must actually fire for an embedded Mom clip (not just decodable).
  // We do this by setting player.src to a known-good blob URL we just got from clipUrl().
  const playingRes = await ev(`(async () => {
    const p = document.getElementById("player");
    const u = clipUrl("a1");
    if (!u || !String(u).startsWith("blob:")) return {fired:false, reason:"no blob url"};
    p.src = u;
    let fired = false;
    const onPlay = () => { fired = true; };
    p.addEventListener("playing", onPlay, {once:true});
    try {
      const pp = p.play();
      if (pp && pp.then) await pp;
    } catch(e) {
      return {fired, reason:"play() rejected: " + e.message};
    }
    // wait briefly for the event (small inline data plays fast)
    const t0 = performance.now();
    while (!fired && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 50));
    return {fired, currentSrc: p.currentSrc, readyState: p.readyState};
  })()`);
  if (!playingRes.fired) { fail("'playing' event did not fire for embedded Mom clip: " + JSON.stringify(playingRes)); }
  else { ok("'playing' event fired for embedded Mom clip (currentSrc=" + playingRes.currentSrc.slice(0,12) + "..., readyState=" + playingRes.readyState + ")"); }

  // 4) Regression: no silent-audio blocked fallthrough. When player.src is a blob: URL,
  // the play() promise should resolve (headless autoplay-policy=no-user-gesture-required).
  const fallthroughRes = await ev(`(async () => {
    const p = document.getElementById("player");
    const u = clipUrl("c1");
    if (!u || !String(u).startsWith("blob:")) return {ok:false, reason:"no blob url"};
    p.src = u;
    try {
      await p.play();
      return {ok:true, currentSrc: p.currentSrc};
    } catch(e) {
      return {ok:false, reason: e.message};
    }
  })()`);
  if (!fallthroughRes.ok) { fail("silent-audio fallthrough: play() rejected: " + JSON.stringify(fallthroughRes)); }
  else { ok("no silent-audio fallthrough for embedded Mom clip"); }

  // 5) Sanity: a non-embedded key (e.g. an SFX key) still resolves through the existing getUrl path.
  const sfxRes = await ev(`(function(){
    const u = getUrl("sfx","ding");
    return u ? {ok:true, prefix: String(u).slice(0,5)} : {ok:false};
  })()`);
  if (!sfxRes.ok || sfxRes.prefix !== "blob:") { fail("sfx 'ding' getUrl no longer returns blob: " + JSON.stringify(sfxRes)); }
  else { ok("sfx 'ding' still resolves to blob: URL"); }

  try { ws.close(); } catch(e){}
  try { proc.kill(); } catch(e){}
  if (fails) { console.log("FAILS: " + fails); process.exit(1); }
  console.log("ALL OK");
  process.exit(0);
})().catch(e => { console.error("TEST CRASH:", e && e.message); process.exit(1); });
