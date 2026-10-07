// Kid-page header redesign + mission siren (RED on main, GREEN with the header change).
//
//   * Compact dark header: back (upper left), avatar + name (centre), weekly-prize pill
//     directly under the name, star progress (lower left), coin count (lower right), speaker
//     (upper right). The siren sits in the slot left of the speaker, never replaces it.
//   * Siren is shown iff at least one surprise/special mission is ACTIVE and UNCOMPLETED for
//     the kid, regardless of whether the entry popup was dismissed.
//   * Siren opens a sheet listing every unfinished mission (incl. an unchosen special's choices)
//     and completes them through the existing Bonus handlers (bjob -> grown-up PIN -> bnYes,
//     pkDo): stars awarded exactly once, siren disappears afterwards.
//   * Header is no taller than main's was at 360x640 and 412x938; nothing clipped or wrapped.
//
// Real Chromium over CDP against a tiny static server (node >= 22, no deps).
// Usage: node tests/kid-header-siren.test.js   (CHROME env var overrides the browser path)
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
// .top header height on main@484bc50 (measured), in CSS px.
const BASELINE_TOP_H = { 360: 60, 412: 68 };
const CDP_PORT = 19464, HTTP_PORT = 19465;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-hdr-"));
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
  // A script error (typically a missing element we tried to click) counts as a failure, not a crash.
  let fails = 0;
  const ev = async expr => { const r = await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.result && r.result.exceptionDetails){ fails++; console.log("FAIL script error in: "+expr.replace(/\s+/g," ").slice(0,110)+" -> "+((r.result.exceptionDetails.exception||{}).description||"").split("\n")[0]); return null; }
    return r.result && r.result.result ? r.result.result.value : null; };
  const key = async (k) => { for(const type of ["keyDown","keyUp"]) await send("Input.dispatchKeyEvent", { type, key:k, code:k, windowsVirtualKeyCode:27 }); };

  const fail = (W, H, name, msg) => { fails++; console.log("FAIL "+W+"x"+H+" "+name+": "+msg); };

  // Fresh storage, family seeded, villain intro marked seen, every kid has a prize.
  async function fresh(extra){
    await send("Page.navigate", { url: URL_ }); await sleep(800);
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("intro_"+WEEK, 1); true`);
    await send("Page.navigate", { url: URL_ }); await sleep(1300);
    await ev(`Object.keys(weeks).forEach(k => { weeks[k].reward = "movie"; saveWeek(k); }); true`);
    await send("Page.navigate", { url: URL_ }); await sleep(1300);
    if(extra) await ev(extra);
  }
  const SURPRISE = `settings.event = { id:"crumb", e:"\\ud83c\\udf6a", title:"THE GREAT CRUMB INCIDENT!", t:"Wipe the table", pts:3, day:ymd(new Date()) }; saveSettings();`;
  const NO_SURPRISE = `settings.event = null; saveSettings();`;
  // Special "done" for a kid: pick one and mark it complete today.
  const SPECIAL_DONE = k => `(function(){ const k=${JSON.stringify(k)}, id=pickList()[0].id, day=ymd(new Date()); weeks[k].pick={day,id}; (weeks[k].done[day]=weeks[k].done[day]||[]).push("pk_"+id); saveWeek(k); })();`;
  const SPECIAL_NONE = k => `(function(){ const k=${JSON.stringify(k)}; delete weeks[k].pick; saveWeek(k); })();`;

  const enterKid = async (kid="k1") => { await ev(`document.querySelector('[data-a="kid"][data-k="${kid}"]').click()`); await sleep(900); };
  const dismissPopup = async () => { await ev(`(function(){ const b=document.querySelector('#missionPop [data-a="missionDismiss"].mClose'); if(b) b.click(); })()`); await sleep(400); };
  const state = () => ev(`(() => { const s=document.querySelector(".top .siren"), hub=document.querySelector("#missionHub");
    return { siren: !!s, hub: !!hub, popup: !!document.querySelector("#missionPop"),
      evCard: !!document.querySelector("#missionHub .mCard.ev"), pkCard: !!document.querySelector("#missionHub .mCard.pk"),
      choices: document.querySelectorAll('#missionHub [data-a="sirenChoose"]').length,
      goEv: !!document.querySelector('#missionHub [data-a="bjob"],#missionHub [data-a="approveAsk"]'), goPk: !!document.querySelector('#missionHub [data-a="pkDo"]'),
      speaker: !!document.querySelector('.top [data-a="sound"]'), voiceBtn: !!document.querySelector('.top [data-a="voiceSheet"]'),
      stars: stars(view.kid), kid: view.kid }; })()`);
  const openHub = async () => { await ev(`document.querySelector(".top .siren").click()`); await sleep(400); };
  const pickCount = () => ev(`pickChoices("k1").length`);

  for(const [W,H] of VIEWPORTS){
    await send("Emulation.setDeviceMetricsOverride", { width:W, height:H, deviceScaleFactor:2, mobile:true });

    // ---- no mission: no siren; speaker + sound sheet still there -------------------------------
    await fresh(NO_SURPRISE + SPECIAL_DONE("k1") + SPECIAL_DONE("k2")); await enterKid();
    { const s = await state();
      if(s.siren) fail(W,H,"no_mission","siren shown with no active mission");
      if(!s.speaker) fail(W,H,"no_mission","speaker button missing");
      if(s.voiceBtn) fail(W,H,"no_mission","separate voices button reappeared");
      if(s.popup) fail(W,H,"no_mission","entry popup shown with no mission");
      await ev(`document.querySelector('.top [data-a="sound"]').click()`); await sleep(400);
      if(!(await ev(`!!document.querySelector("#csmSheet")`))) fail(W,H,"no_mission","speaker no longer opens the sound & voice sheet"); }

    // ---- surprise only -----------------------------------------------------------------------
    await fresh(SURPRISE + SPECIAL_DONE("k1")); await enterKid();
    { let s = await state();
      if(!s.popup) fail(W,H,"surprise_only","automatic first-visit popup no longer fires");
      if(!s.siren) fail(W,H,"surprise_only","siren missing while popup is pending");
      await dismissPopup(); s = await state();
      if(s.popup) fail(W,H,"surprise_only","popup did not dismiss");
      if(!s.siren) fail(W,H,"surprise_only","siren vanished after popup dismissal");
      await openHub(); s = await state();
      if(!s.hub) fail(W,H,"surprise_only","siren did not open the mission sheet");
      if(!s.evCard || s.pkCard) fail(W,H,"surprise_only","sheet should list the surprise only (ev="+s.evCard+" pk="+s.pkCard+")"); }

    // ---- special unselected: sheet shows every choice ----------------------------------------
    await fresh(NO_SURPRISE + SPECIAL_NONE("k1")); await enterKid(); await dismissPopup();
    { let s = await state(); const n = await pickCount();
      if(!s.siren) fail(W,H,"special_unselected","siren missing for unchosen special");
      await openHub(); s = await state();
      if(!s.pkCard || s.evCard) fail(W,H,"special_unselected","sheet should list the special only");
      if(s.choices !== n || n < 1) fail(W,H,"special_unselected","sheet shows "+s.choices+" of "+n+" special choices"); }

    // ---- both missions together --------------------------------------------------------------
    await fresh(SURPRISE + SPECIAL_NONE("k1")); await enterKid();
    { const s = await state(); if(!s.popup || !s.siren) fail(W,H,"both","expected one entry popup and the siren (popup="+s.popup+" siren="+s.siren+")");
      if(await ev(`document.querySelectorAll("#layer .sheet").length`) !== 1) fail(W,H,"both","more than one popup sheet open");
      await dismissPopup(); await openHub(); const t = await state();
      if(!t.evCard || !t.pkCard) fail(W,H,"both","sheet should list both missions (ev="+t.evCard+" pk="+t.pkCard+")"); }

    // ---- dismiss / reopen: close button, backdrop, Escape; siren never goes away ---------------
    for(const how of ["button","backdrop","escape"]){
      await fresh(SURPRISE + SPECIAL_NONE("k1")); await enterKid(); await dismissPopup();
      for(let round=0; round<2; round++){
        await openHub(); let s = await state();
        if(!s.hub){ fail(W,H,"reopen_"+how,"sheet did not open on round "+round); break; }
        if(how==="button") await ev(`document.querySelector('#missionHub [data-a="closeOvBtn"]').click()`);
        else if(how==="backdrop") await ev(`document.querySelector('#layer .ov').click()`);
        else await key("Escape");
        await sleep(300); s = await state();
        if(s.hub) fail(W,H,"reopen_"+how,"sheet still open after close on round "+round);
        if(!s.siren) fail(W,H,"reopen_"+how,"siren gone after closing the sheet");
        if(s.popup) fail(W,H,"reopen_"+how,"entry popup came back after the sheet closed");
      }
    }
    // Re-entering the kid view after a dismissed popup keeps the siren and does not re-pop.
    await fresh(SURPRISE + SPECIAL_DONE("k1")); await enterKid(); await dismissPopup();
    await ev(`document.querySelector('[data-a="home"]').click()`); await sleep(300); await enterKid();
    { const s = await state(); if(!s.siren) fail(W,H,"reenter","siren missing after leaving and re-entering"); if(s.popup) fail(W,H,"reenter","popup repeated on re-entry"); }

    // ---- surprise completes exactly once (bjob -> grown-up PIN -> bnYes), siren disappears ------
    await fresh(SURPRISE + SPECIAL_DONE("k1")); await enterKid(); await dismissPopup();
    { const before = (await state()).stars; await openHub();
      await ev(`document.querySelector('#missionHub [data-a="bjob"]').click()`); await sleep(400);
      let s = await state();
      if(!s.siren) fail(W,H,"surprise_complete","siren vanished while surprise is only waiting for a grown-up");
      if(!s.hub || !(await ev(`!!document.querySelector('#missionHub [data-a="approveAsk"]')`))) fail(W,H,"surprise_complete","sheet should offer grown-up check after the kid taps I did it");
      if(s.stars !== before) fail(W,H,"surprise_complete","stars changed before grown-up approval ("+before+" -> "+s.stars+")");
      await ev(`document.querySelector('#missionHub [data-a="approveAsk"]').click()`); await sleep(300);
      const pin = await ev(`DEFAULT_PIN`);
      for(const d of String(pin)) { await ev(`document.querySelector('[data-a="pin"][data-n="${d}"]').click()`); await sleep(40); }
      await sleep(300);
      const yes = await ev(`!!document.querySelector('[data-a="bnYes"]')`);
      if(!yes) fail(W,H,"surprise_complete","grown-up approval did not offer Give stars");
      else {
        await ev(`document.querySelector('[data-a="bnYes"]').click()`); await sleep(500);
        s = await state();
        if(s.stars - before !== 3) fail(W,H,"surprise_complete","expected +3 stars once, got "+(s.stars-before));
        if(s.siren) fail(W,H,"surprise_complete","siren still shown after the only mission completed");
        // A second approval of the same task must not pay again.
        await ev(`(function(){ const b=document.createElement("button"); b.dataset.a="bnYes"; b.dataset.k="k1"; b.dataset.j="ev_crumb"; b.style.display="none"; document.body.appendChild(b); b.click(); b.remove(); })()`); await sleep(300);
        const again = await state(); if(again.stars !== s.stars) fail(W,H,"surprise_complete","second approval paid again ("+s.stars+" -> "+again.stars+")");
      } }

    // ---- special: choose from the sheet, complete once, siren disappears ---------------------------
    await fresh(NO_SURPRISE + SPECIAL_NONE("k1")); await enterKid(); await dismissPopup();
    { const before = (await state()).stars; await openHub();
      await ev(`document.querySelector('#missionHub [data-a="sirenChoose"]').click()`); await sleep(400);
      let s = await state();
      if(!s.hub || !s.goPk || s.choices) fail(W,H,"special_complete","sheet should switch to the chosen special's Done button");
      if(!s.siren) fail(W,H,"special_complete","siren vanished after choosing (still unfinished)");
      if(s.popup) fail(W,H,"special_complete","entry popup re-fired after choosing");
      await ev(`document.querySelector('#missionHub [data-a="pkDo"]').click()`); await sleep(700);
      s = await state();
      const gained = s.stars - before;
      if(gained < 2) fail(W,H,"special_complete","completing the special awarded only +"+gained+" stars");
      if(s.siren) fail(W,H,"special_complete","siren still shown after the special was completed");
      if(s.hub) fail(W,H,"special_complete","sheet left open with nothing to do");
      await ev(`(function(){ const b=document.createElement("button"); b.dataset.a="pkDo"; b.dataset.j="pk_"+todayPick("k1").id; b.style.display="none"; document.body.appendChild(b); b.click(); b.remove(); })()`); await sleep(500);
      const again = await state(); if(again.stars !== s.stars) fail(W,H,"special_complete","second pkDo paid again ("+s.stars+" -> "+again.stars+")"); }

    // ---- Bonus tab badges and tiles preserved ------------------------------------------------
    await fresh(SURPRISE + SPECIAL_NONE("k1")); await enterKid(); await dismissPopup();
    { const r = await ev(`(() => ({ ev: !!document.querySelector('.tab[data-r="bn"] .bonusStarEv'), pk: !!document.querySelector('.tab[data-r="bn"] .bonusStarPk') }))()`);
      if(!r.ev || !r.pk) fail(W,H,"bonus_badges","Bonus tab badges missing (ev="+r.ev+" pk="+r.pk+")");
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(400);
      const t = await ev(`(() => ({ evt: !!document.querySelector(".tile.evt"), pick: !!document.querySelector(".tile.spmPick") }))()`);
      if(!t.evt || !t.pick) fail(W,H,"bonus_tiles","Bonus mission tiles missing (evt="+t.evt+" spmPick="+t.pick+")"); }

    // ---- kid switch + prize pill ---------------------------------------------------------------
    await fresh(SURPRISE + SPECIAL_NONE("k1") + SPECIAL_DONE("k2") + `
      weeks.k1.reward="movie"; delete weeks.k2.reward; weeks.k1.bonus=3;
      weeks.k2.extra=weeks.k2.extra||{}; weeks.k2.extra[ymd(new Date())]=[{id:"ev_crumb",pts:3,ok:true}]; saveWeek("k1"); saveWeek("k2");`);
    await enterKid("k1"); await dismissPopup();
    { const pill = () => ev(`(() => { const p=document.querySelector(".top .prizePill"); return p ? { txt:p.textContent.replace(/\\s+/g," ").trim(), pt:(p.querySelector(".pt")||{}).textContent } : null; })()`);
      const jar = await ev(`(() => ({ n: stars("k1"), g: goal(), t: rewardOf("k1").t, e: rewardOf("k1").e }))()`);
      let p = await pill();
      if(!p) fail(W,H,"pill","no .prizePill in the header");
      else {
        if(p.pt !== jar.t) fail(W,H,"pill","pill title '"+p.pt+"' != jar prize '"+jar.t+"'");
        if(!(await ev(`document.querySelector('.top .hdStars').textContent.includes(stars('k1') + ' of ' + goal())`))) fail(W,H,"pill","star count missing from header");
        if(p.txt.includes(jar.n+"/"+jar.g) || /to go/.test(p.txt)) fail(W,H,"pill","prize pill should show prize only, not progress: "+p.txt);
      }
      if(!(await state()).siren) fail(W,H,"kid_switch","k1 should show the siren");
      await ev(`document.querySelector('[data-a="home"]').click()`); await sleep(300); await enterKid("k2");
      // k2 already finished today's surprise and special: no siren for k2, even though k1 still has both.
      let s = await state();
      if(s.siren) fail(W,H,"kid_switch","siren shown for k2 who has no active mission");
      const k2NameColor = await ev(`getComputedStyle(document.querySelector('.top .who .wn b')).color`);
      const k2ChosenColor = await ev(`(() => { const e=document.createElement('span'); e.style.color=KIDS.k2.color; document.body.append(e); const c=getComputedStyle(e).color; e.remove(); return c; })()`);
      if(k2NameColor !== k2ChosenColor) fail(W,H,"kid_switch","k2 name did not adopt its chosen color");
      p = await pill();
      if(!p || !/Pick a prize/i.test(p.txt)) fail(W,H,"pill","k2 without a prize should say Pick a prize, got "+(p&&p.txt));
      // Pick a prize through the real picker; pill updates without reload.
      await sleep(200);
      if(await ev(`!document.querySelector(".rewards")`)) await ev(`document.querySelector('.top .prizePill').click()`);
      await sleep(300);
      await ev(`document.querySelector('.rw[data-r="park"]').click()`); await sleep(200);
      await ev(`document.querySelector('[data-a="rwYes"]').click()`); await sleep(500);
      p = await pill(); const rk2 = await ev(`rewardOf("k2").t`);
      if(!p || p.pt !== rk2 || rk2 !== "Park trip") fail(W,H,"pill","pill did not update after prize pick ('"+(p&&p.pt)+"' vs '"+rk2+"')");
      await ev(`document.querySelector('[data-a="home"]').click()`); await sleep(300); await enterKid("k1");
      p = await pill(); if(!p || p.pt !== jar.t) fail(W,H,"pill","pill kept k2's prize after switching back to k1 ('"+(p&&p.pt)+"')"); }

    // The expired-clock warning is removed, but successful morning/clock banners remain.
    const raceCases = await ev(`(() => {
      const make = (won, done) => {
        const race = new Function('raceDay','raceOpen','doneOn','view','weeks','ymd','raceEnd','tm12','atTime','RACE_START','return ('+raceBar.toString()+')');
        return race(()=>true,()=>false,()=>done,{routine:'am'},{k1:{race:won?{TODAY:true}:{}}},()=> 'TODAY',()=> '07:40',()=> '7:40 am',()=>new Date(),'07:00')('k1');
      };
      return {expired:make(false,false), morningDone:make(false,true), beatClock:make(true,false)};
    })()`);
    if(!raceCases || raceCases.expired !== '') fail(W,H,'race_banner','expired unfinished morning still shows a banner: '+JSON.stringify(raceCases));
    if(!raceCases || !raceCases.morningDone.includes('Morning done!') || !raceCases.beatClock.includes('You beat the clock!')) fail(W,H,'race_banner','successful morning/clock wins must remain: '+JSON.stringify(raceCases));
    // ---- geometry ------------------------------------------------------------------------------
    const GEO = `(() => {
      const R = e => { if(!e) return null; const r=e.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2}; };
      const q = s => document.querySelector(s);
      const top=q(".top"), tabs=[...document.querySelectorAll(".tabs .tab")];
      const clipped = e => !!e && e.scrollWidth > e.clientWidth + 1;
      // Text really sticks out of its box (ignores invisible ::after hit areas, which inflate scrollWidth).
      const textOut = e => { if(!e) return true; const g=document.createRange(); g.selectNodeContents(e); const t=g.getBoundingClientRect(), r=e.getBoundingClientRect(); return t.left < r.left - 0.5 || t.right > r.right + 0.5; };
      const hit = e => { if(!e) return false; const r=e.getBoundingClientRect(), el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return !!el && (el===e || e.contains(el)); };
      return { top:R(top), back:R(q(".top .back")), who:R(q(".top .who")), avatar:R(q(".top .whoAv")), name:R(q(".top .who .wn b")), nameFont:parseFloat(getComputedStyle(q(".top .who .wn b")).fontSize), nameColor:getComputedStyle(q(".top .who .wn b")).color, chosenColor:KIDS[view.kid].color, siren:R(q(".top .siren")), spk:R(q(".top .spk")),
        starFont:parseFloat(getComputedStyle(q(".top .hdStars")).fontSize), coinFont:parseFloat(getComputedStyle(q(".top .hdCoin")).fontSize),
        pill:R(q(".top .prizePill")), pillCSSHeight:parseFloat(getComputedStyle(q(".top .prizePill")).height), stars:R(q(".top .hdStars")), coin:R(q(".top .hdCoin")), bar:R(q(".top .hdBar")),
        nameClipped: (()=>{ const b=q(".top .who .wn b"); return !!b && (b.scrollWidth>b.clientWidth+1 || b.scrollHeight>b.clientHeight+1); })(),
        nameOverflowMode:getComputedStyle(q(".top .who .wn b")).textOverflow, nameFullTitle:q(".top .who .wn b").title,
        coinClipped: textOut(q(".top .hdCoin")), pillOverflow: false,
        topOverflow: top ? top.scrollWidth > top.clientWidth + 1 : true, pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
        tabTops: [...new Set(tabs.map(t=>Math.round(t.getBoundingClientRect().top)))], tabsN: tabs.length,
        tabsOverflow: (()=>{ const t=q(".tabs"); return !!t && t.scrollWidth > t.clientWidth + 1; })(),
        tabsTextClipped: tabs.some(t=>[...t.querySelectorAll("em,small,span")].some(x=>x.offsetParent && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow!=="visible")),
        hits: { back: hit(q(".top .back")), spk: hit(q(".top .spk")), siren: q(".top .siren") ? hit(q(".top .siren")) : null, pill: hit(q(".top .prizePill")), coin: hit(q(".top .hdCoin")) } };
    })()`;
    const geoCases = [
      ["siren_default", SURPRISE + SPECIAL_NONE("k1")],
      ["no_siren_default", NO_SURPRISE + SPECIAL_DONE("k1")],
      ["long_prize_long_name", SURPRISE + SPECIAL_NONE("k1") + `FAMILY.kids[0].name="Bartholomew"; KIDS.k1.name="Bartholomew"; weeks.k1.reward="date"; weeks.k1.bonus=47; saveWeek("k1");`],
      ["max_length_name", SURPRISE + SPECIAL_NONE("k1") + `FAMILY.kids[0].name="MaximilianJunior"; KIDS.k1.name="MaximilianJunior"; weeks.k1.reward="date"; saveWeek("k1");`],
      ["full_stars", SURPRISE + SPECIAL_NONE("k1") + `weeks.k1.bonus=100; weeks.k1.reward="date"; saveWeek("k1");`],
    ];
    for(const [label, setup] of geoCases){
      await fresh(setup); await enterKid(); await dismissPopup();
      const g = await ev(GEO); const name = label+" ";
      if(!g.top){ fail(W,H,name+"geometry","no .top header"); continue; }
      const integrated = await ev(`(() => { const q=s=>document.querySelector(s), r=e=>e&&e.getBoundingClientRect(), top=r(q('.top')), bar=r(q('.top .hdBar')), jar=q('.layout>.jarCard'); return { bar:bar&&{w:bar.width,b:bar.bottom}, top:top&&{w:top.width,b:top.bottom}, jarVisible:!!jar&&getComputedStyle(jar).display!=='none' }; })()`);
      if(Math.abs(g.top.h - 150) > .5) fail(W,H,name+"geometry","header height should be exactly 150px: "+g.top.h);
      if(g.starFont !== 16) fail(W,H,name+"status","star count and icon should be 16px, got "+g.starFont);
      if(g.coinFont !== 16 || Math.abs(g.coin.h-32) > .5) fail(W,H,name+"status","coin pill should be 16px text / 32px tall, got "+JSON.stringify({font:g.coinFont,box:g.coin}));
      if(Math.abs(g.pillCSSHeight-32) > .5) fail(W,H,name+"status","prize pill CSS height should be 32px (earned animation may temporarily scale its rect): "+g.pillCSSHeight);
      for(const button of ["back","siren","spk"]) if(g[button] && (Math.abs(g[button].w-40) > .5 || Math.abs(g[button].h-40) > .5)) fail(W,H,name+"status",button+" should be 40x40: "+JSON.stringify(g[button]));
      if(!g.avatar || g.avatar.w < 50 || g.avatar.w > 62.5 || Math.abs(g.avatar.w-g.avatar.h) > .5) fail(W,H,name+"identity","avatar should be 50–62px square: "+JSON.stringify(g.avatar));
      if(g.nameFont < (label==="long_prize_long_name" || label==="max_length_name" ? 20 : 22)) fail(W,H,name+"identity","name should be enlarged while long names fit: "+g.nameFont);
      const expectedColor = await ev(`(() => { const e=document.createElement('span'); e.style.color=KIDS[view.kid].color; document.body.append(e); const c=getComputedStyle(e).color; e.remove(); return c; })()`);
      if(g.nameColor !== expectedColor) fail(W,H,name+"identity","name color "+g.nameColor+" differs from selected kid color "+expectedColor);
      if(g.pill && g.pill.w > 155) fail(W,H,name+"geometry","weekly-prize pill too wide: "+g.pill.w);
      const overlaps = (a,b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      if(overlaps(g.stars,g.pill) || overlaps(g.coin,g.pill) || overlaps(g.stars,g.coin) || overlaps(g.coin,g.bar) || overlaps(g.stars,g.bar)) fail(W,H,name+"status","status items overlap: "+JSON.stringify({stars:g.stars,pill:g.pill,coin:g.coin,bar:g.bar}));
      if(g.pill && await ev(`/\\d+\\/\\d+|to go/.test(document.querySelector('.top .prizePill').textContent)`)) fail(W,H,name+"geometry","prize pill repeats progress instead of showing only the prize");
      if(integrated.jarVisible) fail(W,H,name+"geometry","old separate progress/jar strip still shown below header");
      if(!integrated.bar || integrated.bar.w < integrated.top.w * .75 || integrated.bar.b > integrated.top.b + .5) fail(W,H,name+"geometry","progress bar not full-width inside top bar: "+JSON.stringify(integrated));
      if(!g.pill || !g.stars || !g.coin || !g.back || !g.spk || !g.who) { fail(W,H,name+"geometry","header pieces missing "+JSON.stringify({pill:!!g.pill,stars:!!g.stars,coin:!!g.coin,back:!!g.back,spk:!!g.spk,who:!!g.who})); continue; }
      const inside = o => o.l >= g.top.l - 0.5 && o.r <= g.top.r + 0.5 && o.t >= g.top.t - 0.5 && o.b <= g.top.b + 0.5;
      for(const k of ["back","who","spk","pill","stars","coin","siren"]) if(g[k] && !inside(g[k])) fail(W,H,name+"geometry",k+" sticks out of the header "+JSON.stringify(g[k]));
      if(g.topOverflow || g.pageOverflowX) fail(W,H,name+"geometry","horizontal overflow (header="+g.topOverflow+" page="+g.pageOverflowX+")");
      const allowedLongName = (label==="max_length_name" && g.nameFullTitle==="MaximilianJunior") || (label==="long_prize_long_name" && g.nameFullTitle==="Bartholomew");
      if(g.nameClipped && !(allowedLongName && g.nameOverflowMode==="ellipsis")) fail(W,H,name+"geometry","kid name clipped without readable ellipsis and full title");
      if(label==="max_length_name" && g.nameOverflowMode!=="ellipsis") fail(W,H,name+"geometry","long name lacks ellipsis fallback");
      if(g.coinClipped) fail(W,H,name+"geometry","coin text clipped");
      // Layout: pill directly under name (same centre column), stars lower-left, coins lower-right, speaker upper-right.
      if(!(g.pill.t >= g.who.b - 1)) fail(W,H,name+"layout","pill is not below the name (pill.t="+g.pill.t+" who.b="+g.who.b+")");
      if(Math.abs(g.pill.cx - g.who.cx) > 14) fail(W,H,name+"layout","pill not centred under the name (dx="+Math.round(g.pill.cx-g.who.cx)+")");
      if(!(g.stars.cy > g.back.cy && g.stars.l < g.pill.l && g.stars.cx < g.top.cx)) fail(W,H,name+"layout","stars not at lower left");
      if(!(g.coin.cy > g.spk.cy && g.coin.l > g.pill.r - 1 && g.coin.cx > g.top.cx)) fail(W,H,name+"layout","coins not at lower right");
      if(!(g.back.cy < g.pill.cy && g.back.cx < g.top.cx)) fail(W,H,name+"layout","back not upper left");
      if(!(g.spk.cy < g.pill.cy && g.spk.cx > g.top.cx && g.spk.r <= g.top.r)) fail(W,H,name+"layout","speaker not upper right");
      if(g.siren){ if(!(g.siren.r <= g.spk.l + 0.5 && Math.abs(g.siren.cy - g.spk.cy) < 2)) fail(W,H,name+"layout","siren not in the slot left of the speaker");
        if(g.siren.l < g.who.r) fail(W,H,name+"layout","siren overlaps the name: "+JSON.stringify({who:g.who,siren:g.siren})); }
      else if(label.startsWith("siren")) fail(W,H,name+"geometry","expected a siren");
      if(label==="no_siren_default" && g.siren) fail(W,H,name+"geometry","siren present with no mission");
      if(g.tabTops.length !== 1 || g.tabsOverflow || g.tabsTextClipped) fail(W,H,name+"geometry","tabs wrapped/overflow/clipped: rows="+g.tabTops.length+" overflow="+g.tabsOverflow+" textClipped="+g.tabsTextClipped);
      for(const [k,v] of Object.entries(g.hits)) if(v === false) fail(W,H,name+"geometry",k+" button is covered / not tappable at its centre");
    }
  }

  try { proc.kill(); } catch(e){}
  try { server.close(); } catch(e){}
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nOK: kid header + siren checks passed at all viewports");
  process.exit(fails ? 1 : 0);
}
run().catch(e => { console.error("FATAL", e); process.exit(2); });
