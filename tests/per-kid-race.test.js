// Per-kid Morning Race leave-by times + global race toggle (RED on main@6673e67, GREEN with the feature).
//
//   * settings.kidEnds = { <kidId>: { walk, bus, drive } }  (blank/absent = family default)
//   * settings.raceOff = true turns the whole race off (absent = ON, so old installs are unchanged)
//   * raceEnd/raceOpen/raceBar/home chip all resolve kid override first, family fallback second.
//   * Toggle OFF hides chip + race clock + banners but keeps recorded race results, stars and times.
//   * Wizard and Grown-ups both expose the per-kid rows and the toggle.
//
// Real Chromium over CDP against a tiny static server (node >= 22, no deps).
// Usage: node tests/per-kid-race.test.js   (CHROME env var overrides the browser path)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const CHROME = process.env.CHROME
  || ["/snap/bin/chromium","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
     .find(p => p && fs.existsSync(p));
const REPO = path.resolve(__dirname, "..");
const VIEWPORTS = [[360,640],[412,938]];
const CDP_PORT = 19474, HTTP_PORT = 19475;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(){
  const types = { ".html":"text/html", ".js":"application/javascript", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml" };
  const svr = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if(p === "/") p = "/index.html";
    const file = path.join(REPO, p);
    if(!file.startsWith(REPO) || !fs.existsSync(file)){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => svr.listen(HTTP_PORT, "127.0.0.1", () => resolve(svr)));
}

async function run(){
  if(!CHROME){ console.log("NO BROWSER"); process.exit(2); }
  const server = await startServer();
  const URL_ = "http://127.0.0.1:"+HTTP_PORT+"/index.html";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-race-"));
  const proc = spawn(CHROME, ["--headless=new","--remote-debugging-port="+CDP_PORT,"--user-data-dir="+dir,
    "--no-first-run","--disable-gpu","--no-default-browser-check","--disable-extensions","--mute-audio","about:blank"], { stdio:"ignore" });
  let targets = null;
  for(let i=0;i<60;i++){
    try { targets = await (await fetch("http://127.0.0.1:"+CDP_PORT+"/json")).json(); if(targets.find(t=>t.type==="page")) break; }catch(e){}
    await sleep(200);
  }
  if(!targets || !targets.find(t=>t.type==="page")){ console.log("NO CDP"); proc.kill(); server.close(); process.exit(2); }
  const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if(d.id && pend[d.id]){ pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params={}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id:i,method,params})); });
  let fails = 0;
  const ev = async expr => { const r = await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.result && r.result.exceptionDetails){ fails++; console.log("FAIL script error in: "+expr.replace(/\s+/g," ").slice(0,110)+" -> "+((r.result.exceptionDetails.exception||{}).description||"").split("\n")[0]); return null; }
    return r.result && r.result.result ? r.result.result.value : null; };
  const fail = (W, H, name, msg) => { fails++; console.log("FAIL "+W+"x"+H+" "+name+": "+msg); };
  const eq = (W, H, name, got, want) => { if(JSON.stringify(got) !== JSON.stringify(want)) fail(W,H,name,"got "+JSON.stringify(got)+" want "+JSON.stringify(want)); };

  // Frozen clock: a weekday, 07:20 local, same calendar day as the real one (so WEEK keys stay valid).
  const FREEZE = `(function(){ const RD=Date, f=new RD(); f.setHours(7,20,0,0); const fx=f.getTime();
    class FD extends RD{ constructor(...a){ if(a.length) super(...a); else super(fx); } static now(){ return fx; } }
    window.Date=FD; window.todayDow=()=>3; true; })()`;
  async function ready(){
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof saveLocal === "function"`)) return; await sleep(250); }
    throw new Error("app did not initialize after navigation");
  }
  async function fresh(settingsJs){
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("intro_"+WEEK, 1); true`);
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`Object.keys(weeks).forEach(k => { weeks[k].reward = "movie"; saveWeek(k); }); true`);
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(FREEZE);
    if(settingsJs) await ev(settingsJs);
  }
  const SET = (obj, mode) => `(function(){ Object.assign(settings, ${JSON.stringify(obj)}); settings.rideMode=${JSON.stringify(mode||"walk")}; settings.rideDate=ymd(new Date()); settings.event=null; saveSettings(); render(); })()`;
  const enterKid = async (kid) => { await ev(`document.querySelector('[data-a="kid"][data-k="${kid}"]').click()`); await sleep(700); await ev(`view.routine="am"; render(); true`); await sleep(200); };
  const goHome = async () => { await ev(`view.kid=null; render(); true`); await sleep(300); };
  const raceText = () => ev(`(document.querySelector(".race")||{}).textContent||null`);
  const chipText = () => ev(`([...document.querySelectorAll(".kidBtn .kidTime")].map(e=>e.textContent.trim()).join(" | "))||null`);

  const DIFF = { kidEnds: { k1:{walk:"07:30",bus:"07:35",drive:"07:55"}, k2:{walk:"07:45",bus:"07:50",drive:"08:05"} }, walkEnd:"07:40", busEnd:"07:45", driveEnd:"07:50" };

  // ---- static checks (viewport independent) -------------------------------------------------------
  { const html = fs.readFileSync(path.join(REPO,"index.html"),"utf8"), sw = fs.readFileSync(path.join(REPO,"sw.js"),"utf8");
    const snap = html.split("\n").find(l => l.includes("settings = {pin:d.pin")) || "";
    if(!/kidEnds\s*:/.test(snap) || !/raceOff\s*:/.test(snap)) fail(0,0,"firebase_sync","settings snapshot whitelist drops kidEnds/raceOff");
    const m = sw.match(/const CACHE = "([^"]+)"/);
    if(!m || m[1] !== "momster-helper-v81-cloud-sync") fail(0,0,"sw_cache","SW cache not bumped to v81-cloud-sync: "+(m&&m[1])); }

  for(const [W,H] of VIEWPORTS){
    await send("Emulation.setDeviceMetricsOverride", { width:W, height:H, deviceScaleFactor:2, mobile:true });

    // ---- old saved data: no kidEnds / raceOff -> identical to family times, race ON ----------------
    await fresh(SET({ walkEnd:"07:40", busEnd:"07:45", driveEnd:"07:50" }, "bus"));
    eq(W,H,"old_data:on", await ev(`raceOn()`), true);
    eq(W,H,"old_data:k1", await ev(`raceEnd("k1")`), "07:45");
    eq(W,H,"old_data:k2", await ev(`raceEnd("k2")`), "07:45");
    eq(W,H,"old_data:ends", await ev(`rideEnds("k1")`), { walk:"07:40", bus:"07:45", drive:"07:50" });
    await enterKid("k1"); { const t = await raceText(); if(!t || !/25 min/.test(t)) fail(W,H,"old_data:clock","race clock should show 25 min, got "+t); }
    await goHome(); { const t = await chipText(); if(!t || !t.includes("7:45 am")) fail(W,H,"old_data:chip","chip should read 7:45 am, got "+t); }

    // ---- Lily/Logan different times, all three modes --------------------------------------------
    for(const [mode, k1, k2, m1, m2] of [["walk","07:30","07:45",10,25],["bus","07:35","07:50",15,30],["drive","07:55","08:05",35,45]]){
      await fresh(SET(DIFF, mode));
      await ev(`FAMILY.kids[0].name="Lily"; FAMILY.kids[1].name="Logan"; applyKids(); render(); true`);
      eq(W,H,mode+":k1", await ev(`raceEnd("k1")`), k1);
      eq(W,H,mode+":k2", await ev(`raceEnd("k2")`), k2);
      await enterKid("k1"); { const t = await raceText(); if(!t || !new RegExp("\\b"+m1+" min").test(t)) fail(W,H,mode+":k1 clock","expected "+m1+" min, got "+t); }
      await goHome(); await enterKid("k2"); { const t = await raceText(); if(!t || !new RegExp("\\b"+m2+" min").test(t)) fail(W,H,mode+":k2 clock","expected "+m2+" min, got "+t); }
      await goHome(); { const t = await chipText(); const f = v => { const [h,mm]=v.split(":").map(Number); return ((h%12)||12)+":"+String(mm).padStart(2,"0")+" am"; };
        if(!t || !t.includes(f(k1)) || !t.includes(f(k2))) fail(W,H,mode+":chip","chip should show both kid times "+f(k1)+" and "+f(k2)+", got "+t);
        const two=await ev(`(() => { const cards=[...document.querySelectorAll(".kidBtn")]; return { topBarChip: !!document.querySelector(".hello .kidTime, .hello [data-a=rideQuick]"), cards: cards.map(c=>{ const t=c.querySelector(".kidTime"), cr=c.getBoundingClientRect(), tr=t&&t.getBoundingClientRect(); return { kid:c.dataset.k, text:t&&t.textContent.trim(), inside: !!tr && tr.right<=cr.right+0.5 && tr.top>=cr.top-0.5 && tr.left>=cr.left && tr.bottom<=cr.bottom, topRight: !!tr && cr.right-tr.right<30 && tr.top-cr.top<30 }; }) }; })()`);
        if(two.topBarChip) fail(W,H,mode+":no top-bar chip","the leave-by time must not be in the top bar: "+JSON.stringify(two));
        for(const c of two.cards) if(!c.inside || !c.topRight) fail(W,H,mode+":card chip "+c.kid,"time must sit in the card's top right corner: "+JSON.stringify(c));
        { const want={k1:f(k1),k2:f(k2)}; for(const c of two.cards) if(!c.text || !c.text.includes(want[c.kid])) fail(W,H,mode+":card time "+c.kid,"card should show "+want[c.kid]+", got "+(c.text||null)); }
        eq(W,H,mode+":chip-mode", !!(t && t.includes({walk:"🛴",bus:"🚌",drive:"🚗"}[mode])), true);
        eq(W,H,mode+":ride-unchanged", await ev(`rideToday()`), mode); }
    }

    // ---- race completion uses the kid's own deadline ------------------------------------------------
    // 07:20 now. Lily walk 07:15 (closed) vs Logan walk 07:45 (open): only Logan can win.
    await fresh(SET({ kidEnds:{ k1:{walk:"07:15"}, k2:{walk:"07:45"} } }, "walk"));
    eq(W,H,"complete:open", await ev(`[raceOpen("k1"), raceOpen("k2")]`), [false,true]);

    // ---- blank fallback --------------------------------------------------------------------------
    await fresh(SET({ kidEnds:{ k1:{walk:"07:30", bus:"", drive:"  "} } }, "bus"));
    eq(W,H,"blank:k1 bus -> family", await ev(`raceEnd("k1")`), "07:45");
    eq(W,H,"blank:k1 walk override", await ev(`rideEnds("k1").walk`), "07:30");
    eq(W,H,"blank:k2 family", await ev(`rideEnds("k2")`), { walk:"07:40", bus:"07:45", drive:"07:50" });
    await fresh(SET({ kidEnds:{ k1:{walk:"garbage"} } }, "walk"));
    eq(W,H,"blank:invalid ignored", await ev(`raceEnd("k1")`), "07:40");

    // ---- toggle OFF / ON -------------------------------------------------------------------------
    await fresh(SET(DIFF, "walk"));
    await ev(`(function(){ weeks.k1.race[ymd(new Date())]=true; saveWeek("k1"); })()`);
    const starsBefore = await ev(`stars("k1")`);
    await ev(`panel(); true`); await sleep(300);
    if(!(await ev(`!!document.querySelector('#gPanel [data-a="raceToggle"]')`))) fail(W,H,"toggle:ui","Grown-ups panel has no Morning Race toggle");
    eq(W,H,"toggle:default on", await ev(`(document.querySelector('#gPanel [data-a="raceToggle"]')||{}).getAttribute&&document.querySelector('#gPanel [data-a="raceToggle"]').getAttribute("aria-pressed")`), "true");
    await ev(`document.querySelector('#gPanel [data-a="raceToggle"]').click()`); await sleep(300);
    eq(W,H,"toggle:off persisted", await ev(`JSON.parse(localStorage.getItem("starjobs_settings")).raceOff`), true);
    await ev(`close(); true`); await sleep(200);
    await goHome();
    eq(W,H,"toggle:off chips hidden", await ev(`!!document.querySelector(".kidTime")`), false);
    await enterKid("k1");
    eq(W,H,"toggle:off race bar hidden", await ev(`!!document.querySelector(".race")`), false);
    eq(W,H,"toggle:off raceOpen", await ev(`[raceOpen("k1"), raceOpen("k2"), raceDay()]`), [false,false,false]);
    eq(W,H,"toggle:off keeps race record", await ev(`!!weeks.k1.race[ymd(new Date())]`), true);
    eq(W,H,"toggle:off keeps stars", await ev(`stars("k1")`), starsBefore);
    eq(W,H,"toggle:off keeps times", await ev(`JSON.stringify(settings.kidEnds)`), JSON.stringify(DIFF.kidEnds));
    eq(W,H,"toggle:off morning tasks still render", await ev(`document.querySelectorAll('[data-a="job"],[data-a="tick"],.job,.jobRow,.tile').length > 0`), true);
    // finishing the morning while OFF must not record a race win
    await ev(`(function(){ const w=weeks.k2; delete w.race[ymd(new Date())]; saveWeek("k2"); })()`);
    // reload: still off
    await send("Page.navigate", { url: URL_ }); await sleep(1300); await ev(FREEZE);
    eq(W,H,"toggle:off after reload", await ev(`raceOn()`), false);
    // back ON restores previously configured times
    await ev(`panel(); true`); await sleep(300);
    await ev(`document.querySelector('#gPanel [data-a="raceToggle"]').click()`); await sleep(300);
    eq(W,H,"toggle:on persisted", await ev(`!JSON.parse(localStorage.getItem("starjobs_settings")).raceOff`), true);
    await ev(`close(); render(); true`); await sleep(200);
    eq(W,H,"toggle:on restores k1", await ev(`raceEnd("k1")`), "07:30");
    eq(W,H,"toggle:on restores k2", await ev(`raceEnd("k2")`), "07:45");
    await goHome(); eq(W,H,"toggle:on chips back", await ev(`!!document.querySelector(".kidTime")`), true);

    // ---- Grown-ups per-kid editors: save, blank, persist, geometry ------------------------------------
    await fresh(SET({ walkEnd:"07:40", busEnd:"07:45", driveEnd:"07:50" }, "walk"));
    await ev(`panel(); true`); await sleep(300);
    { const ids = await ev(`["k1","k2"].every(k => ["walk","bus","drive"].every(m => !!document.getElementById("ke_"+k+"_"+m)))`);
      if(!ids){ fail(W,H,"grown:fields","per-kid time inputs ke_<kid>_<mode> missing"); }
      else {
        await ev(`(function(){ const s=(i,v)=>{ document.getElementById(i).value=v; }; s("ke_k1_walk","07:30"); s("ke_k1_bus","07:35"); s("ke_k1_drive","07:55"); s("ke_k2_walk","07:45"); s("ke_k2_bus",""); s("ke_k2_drive",""); })()`);
        await ev(`document.querySelector('#gPanel [data-a="saveRace"]').click()`); await sleep(400);
        eq(W,H,"grown:saved k1", await ev(`settings.kidEnds.k1`), { walk:"07:30", bus:"07:35", drive:"07:55" });
        eq(W,H,"grown:saved k2 blanks omitted", await ev(`settings.kidEnds.k2`), { walk:"07:45" });
        eq(W,H,"grown:family untouched", await ev(`[settings.walkEnd, settings.busEnd, settings.driveEnd]`), ["07:40","07:45","07:50"]);
        await send("Page.navigate", { url: URL_ }); await sleep(1300); await ev(FREEZE);
        eq(W,H,"grown:persist reload", await ev(`[raceEnd("k1"), rideEnds("k2").bus]`), ["07:30","07:45"]);
        await ev(`panel(); true`); await sleep(300);
        eq(W,H,"grown:field shows saved", await ev(`document.getElementById("ke_k1_bus").value`), "07:35");
        eq(W,H,"grown:blank stays blank", await ev(`document.getElementById("ke_k2_bus").value`), "");
        const g = await ev(`(() => { const p=document.getElementById("gPanel"), r=document.getElementById("ke_k1_walk").getBoundingClientRect(), r2=document.getElementById("ke_k1_drive").getBoundingClientRect();
          const bad=[...document.querySelectorAll('#gPanel [id^="ke_"]')].filter(i=>i.scrollWidth>i.clientWidth+1).length;
          return { overflowX: p.scrollWidth>p.clientWidth+1, bad, right:Math.round(r2.right), vw:innerWidth, w:Math.round(r.width) }; })()`);
        if(g.overflowX) fail(W,H,"grown:geometry","panel horizontally overflows");
        if(g.bad) fail(W,H,"grown:geometry",g.bad+" per-kid time inputs clip their value");
        if(g.right > g.vw) fail(W,H,"grown:geometry","inputs run off screen "+JSON.stringify(g));
        if(g.w < 44) fail(W,H,"grown:geometry","input too narrow to tap "+g.w);
        // reset-to-family button clears one kid
        await ev(`(document.querySelector('#gPanel [data-a="kidEndsReset"][data-k="k1"]')||{click(){ throw new Error("no reset button"); }}).click()`); await sleep(300);
        eq(W,H,"grown:reset kid", await ev(`settings.kidEnds.k1||null`), null);
      } }

    // ---- Wizard times step -------------------------------------------------------------------------
    await fresh(null);
    await ev(`wizStart(); wiz.kids[0].name="Lily"; wiz.kids[1].name="Logan"; wiz.step=WIZ_STEPS.indexOf("times"); wizSheet(); true`); await sleep(400);
    { const ok = await ev(`["k1","k2"].every(k => ["walk","bus","drive"].every(m => !!document.querySelector('#wizSheet [data-wke="'+k+'|'+m+'"]'))) && !!document.querySelector('#wizSheet [data-a="wizRace"]')`);
      if(!ok) fail(W,H,"wizard:fields","wizard times step lacks per-kid inputs or race toggle");
      else {
        await ev(`wiz.kidEnds.k1={walk:"07:15"}; wizSheet(); document.querySelector('#wizSheet [data-a="kidEndsReset"][data-k="k1"]').click(); true`);
        eq(W,H,"wizard:reset stays in wizard", await ev(`!!document.querySelector('#wizSheet')`), true);
        eq(W,H,"wizard:reset clears draft only", await ev(`wiz.kidEnds.k1||null`), null);
        await ev(`(function(){ const s=(k,m,v)=>{ document.querySelector('#wizSheet [data-wke="'+k+'|'+m+'"]').value=v; }; s("k1","walk","07:30"); s("k2","walk","07:50"); s("k2","drive","08:00"); document.querySelector('#wizSheet [data-a="wizRide"][data-v="bus"]').click(); })()`);
        eq(W,H,"wizard:mode switch keeps unsaved kid time", await ev(`document.querySelector('#wizSheet [data-wke="k2|walk"]').value`), "07:50");
        const g = await ev(`(() => { const p=document.getElementById("wizSheet"); const bad=[...p.querySelectorAll("[data-wke]")].filter(i=>i.scrollWidth>i.clientWidth+1).length; return { overflowX:p.scrollWidth>p.clientWidth+1, bad }; })()`);
        if(g.overflowX) fail(W,H,"wizard:geometry","wizard horizontally overflows");
        if(g.bad) fail(W,H,"wizard:geometry",g.bad+" wizard per-kid inputs clip their value");
        await ev(`wizSheet(); true`); await sleep(200);
        eq(W,H,"wizard:rerender keeps", await ev(`document.querySelector('#wizSheet [data-wke="k2|walk"]').value`), "07:50");
        await ev(`wizApply()`);
        eq(W,H,"wizard:applied k1", await ev(`settings.kidEnds.k1`), { walk:"07:30" });
        eq(W,H,"wizard:applied k2", await ev(`settings.kidEnds.k2`), { walk:"07:50", drive:"08:00" });
        eq(W,H,"wizard:family defaults", await ev(`[settings.walkEnd, settings.busEnd, settings.driveEnd]`), ["07:40","07:45","07:50"]);
        eq(W,H,"wizard:race stays on", await ev(`!settings.raceOff`), true);
        // wizard toggle off
        await ev(`wizStart(); wiz.kids[0].name="Lily"; wiz.kids[1].name="Logan"; wiz.step=WIZ_STEPS.indexOf("times"); wizSheet(); document.querySelector('#wizSheet [data-a="wizRace"]').click(); true`); await sleep(300);
        await ev(`wizApply()`);
        eq(W,H,"wizard:toggle off applied", await ev(`settings.raceOff===true`), true);
        eq(W,H,"wizard:toggle off keeps kid times", await ev(`!!(settings.kidEnds&&settings.kidEnds.k2)`), true);
      } }

    // Distinct leave-by times for four kids must not erase the home title or overflow.
    await fresh(SET({kidEnds:{k1:{walk:"07:30"},k2:{walk:"07:38"},k3:{walk:"07:42"},k4:{walk:"07:48"}}},"walk"));
    await ev(`FAMILY.kids.push({id:"k3",name:"Alice",color:"#7048E8",av:"⭐"},{id:"k4",name:"Ben",color:"#E5484D",av:"⭐"}); applyKids(); view.kid=null; render(); true`);
    const four = await ev(`(() => { const cards=[...document.querySelectorAll(".kidBtn")]; return { times: cards.map(c=>(c.querySelector(".kidTime")||{}).textContent||null), fits: cards.every(c=>{ const t=c.querySelector(".kidTime"); if(!t) return false; const cr=c.getBoundingClientRect(), tr=t.getBoundingClientRect(); return tr.right<=cr.right+0.5 && tr.left>=cr.left; }), title: document.querySelector('.hello h1').getBoundingClientRect().width, bodyScroll:document.body.scrollWidth, vw:innerWidth }; })()`);
    if(!four.fits || four.title<100 || four.bodyScroll>four.vw+1) fail(W,H,"four-kid home","each kid's time must fit in its own card and the page must not overflow: "+JSON.stringify(four));
    for(const t of ["7:30","7:38","7:42","7:48"]) if(!four.times.some(x=>x&&x.includes(t))) fail(W,H,"four-kid times","missing "+t+": "+JSON.stringify(four.times));
  }

  try { proc.kill(); } catch(e){}
  try { server.close(); } catch(e){}
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nOK: per-kid race times + toggle checks passed at all viewports");
  process.exit(fails ? 1 : 0);
}
run().catch(e => { console.error("FATAL", e); process.exit(2); });
