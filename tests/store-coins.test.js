// Sidekick store rules and the coin economy.
//
// Wearing: one hat, one face, one neck, one outfit, one place, and two hands that hold two toys OR one toy and one
// pet (never two pets). The older item gives way. Older avatars that wear too much are fixed on load. Everything a
// kid has unlocked stays in the shop.
//
// Coins (stars no longer make coins):
//   * 1 coin the first time a kid finishes every job in a category that day (morning, after school, bedtime, helper)
//     and 1 for the special mission; a grown-up taking a star back withdraws it; never paid twice for the same day
//   * 10 coins to every kid when the week's villain is defeated; categories then pay 2 until the next villain
//   * 25 starter coins (once) at the reward line of Momster's tutorial, which a brand new family sees when setup ends
//   * Grown-ups can add and remove coins (never below zero), next to the bonus star buttons
//
// Real Chromium over CDP against a tiny static server (node >= 22, no deps).
// Usage: node tests/store-coins.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19484, HTTP_PORT = 19485;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(){
  const types = { ".html":"text/html", ".js":"application/javascript", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml", ".mp3":"audio/mpeg", ".webp":"image/webp" };
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-store-"));
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
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if(!cond) fails++; };
  const canon = x => JSON.stringify(x, (k,v) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort().reduce((o,kk) => (o[kk]=v[kk], o), {}) : v);
  const same = (a, b) => canon(a) === canon(b);

  async function ready(){
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof saveLocal === "function" && typeof wearToggle === "function"`)) return; await sleep(250); }
    throw new Error("app did not initialize");
  }
  // A set-up two-kid family with an empty slate and no intro popups.
  async function fresh(){
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); true`);
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`layer.innerHTML=""; view.kid="k1"; view.routine="am"; render(); true`);
  }

  try {
    // ---------- wearing ----------
    await fresh();
    const W = await ev(`(function(){ const o={}; const b=BLANK_BUDDY(); const wear=(s,i)=>{ wearToggle(b,s,i,true); return JSON.stringify(b.wear); };
      b.wear={}; wear("hat","h1"); wear("hat","h2"); o.hat=b.wear;
      b.wear={}; wear("face","f1"); wear("face","f2"); o.face=b.wear;
      b.wear={}; wear("neck","n1"); wear("neck","n2"); wear("fit","o1"); wear("fit","o2"); wear("bg","p1"); wear("bg","p2"); o.singles=b.wear;
      b.wear={}; wear("hold","t1"); wear("hold","t2"); o.twoToys=Object.assign({},b.wear); wear("hold","t3"); o.threeToys=Object.assign({},b.wear);
      b.wear={}; wear("hold","t1"); wear("pet","a1"); o.toyPet=Object.assign({},b.wear); wear("hold","t2"); o.toyPetNewToy=Object.assign({},b.wear); wear("pet","a2"); o.petSwap=Object.assign({},b.wear);
      b.wear={}; wear("hold","t1"); wear("hold","t2"); wear("pet","a1"); o.twoToysThenPet=Object.assign({},b.wear);
      b.wear={}; wear("pet","a1"); wear("hold","t1"); wear("hold","t2"); o.petThenTwoToys=Object.assign({},b.wear);
      b.wear={hold:"t1",hold2:"t2"}; wearToggle(b,"hold","t1"); o.takeOff=Object.assign({},b.wear);
      o.legacy=normalizeWear({hat:"h",face:"f1",face2:"f2",pet:"a1",pet2:"a2",hold:"t1",hold2:"t2",neck:"n",fit:"o",bg:"p"});
      o.orphans=normalizeWear({pet2:"a2",hold2:"t2"});
      return o; })()`);
    ok(same(W.hat,{hat:"h2"}), "one hat at a time");
    ok(same(W.face,{face:"f2"}), "one face item at a time");
    ok(same(W.singles,{neck:"n2",fit:"o2",bg:"p2"}), "one neck item, outfit and place");
    ok(same(W.twoToys,{hold:"t1",hold2:"t2"}), "two toys can be worn");
    ok(same(W.threeToys,{hold:"t2",hold2:"t3"}), "a third toy replaces the older one");
    ok(same(W.toyPet,{hold:"t1",pet:"a1"}), "a toy and a pet can be worn");
    ok(same(W.toyPetNewToy,{hold:"t2",pet:"a1"}), "with a toy and a pet, a new toy swaps the toy");
    ok(same(W.petSwap,{hold:"t2",pet:"a2"}), "never two pets: a new pet replaces the old one");
    ok(same(W.twoToysThenPet,{hold:"t2",pet:"a1"}), "a pet takes a hand: the older toy goes");
    ok(same(W.petThenTwoToys,{hold:"t2",pet:"a1"}), "pet, then two toys: keeps the pet and the newest toy");
    ok(same(W.takeOff,{hold2:"t2"}), "an item can be taken off");
    ok(same(W.legacy,{hat:"h",face:"f1",pet:"a1",hold:"t2",neck:"n",fit:"o",bg:"p"}), "an older avatar with two faces/pets is fixed");
    ok(same(W.orphans,{pet:"a2",hold:"t2"}), "orphaned second slots move up");

    // ---------- the shop keeps everything unlocked ----------
    const shop = await ev(`(function(){ const o={}; buddies.k1.adjCoins=30; const cheap=ITEMS.filter(i=>i[4]>0).sort((x,y)=>x[4]-y[4])[0];
      bTab=cheap[0]; view.kid="k1"; buddySheet("k1"); const tap=id=>document.querySelector('#buddySheet [data-a="bItem"][data-v="'+id+'"]').click();
      tap(cheap[1]); tap(cheap[1]);
      o.price=cheap[4]; o.after=coins("k1"); o.owned=buddies.k1.owned.includes(cheap[1]); o.worn=isWearing(buddies.k1.wear,cheap[0],cheap[1]);
      o.hint=(document.querySelector("#buddySheet .bsec")||{}).textContent||"";
      const other=Object.keys(SEASON).map(Number).filter(m=>m!==MONTH()).map(m=>SEASON[m][0])[0], rare=RARE[0];
      buddies.k1.owned.push(other[1], rare[1]); o.seen={}; for(const it of [cheap,other,rare]){ bTab=it[0]; buddySheet("k1"); o.seen[it[1]]=!!document.querySelector('#buddySheet [data-a="bItem"][data-v="'+it[1]+'"]'); }
      layer.innerHTML=""; return o; })()`);
    ok(shop.after === 30 - shop.price, "buying an item spends its price");
    ok(shop.owned && shop.worn, "a bought item is owned and put on");
    ok(/whole group of jobs/.test(shop.hint), "the shop explains how coins are earned");
    ok(Object.values(shop.seen).every(Boolean), "normal, rare and other-month seasonal unlocked items all stay in the shop");

    // ---------- category coins ----------
    await fresh();
    const day = await ev(`ymd(new Date())`);
    const tapAll = async ids => { for(const id of ids){ await ev(`layer.innerHTML=""; var t=document.querySelector('.tile[data-a="job"][data-j="${id}"]'); if(t) t.click(); true`); await sleep(140); } await sleep(250); };
    const catJobs = c => ev(`jobsFor(ROUTINES.find(r=>r.id==="${c}"),todayDow(),"k1").map(j=>j.id)`);
    const am = await catJobs("am");
    ok(am.length >= 2, "there are morning jobs to finish today ("+am.length+")");
    await tapAll(am.slice(0,-1));
    ok(await ev(`coins("k1")`) === 0, "no coin until every job in the category is done");
    await tapAll(am.slice(-1));
    ok(await ev(`coins("k1")`) === 1, "finishing the whole morning category pays 1 coin");
    ok(same(await ev(`Object.keys(buddies.k1.coinAwards)`), ["cat:"+day+":am"]), "the coin is keyed by day and category");
    await ev(`(function(){ const w=weeks.k1; w.done["${day}"]=w.done["${day}"].filter(x=>x!=="${am[0]}"); saveWeek("k1"); return true; })()`);
    ok(await ev(`coins("k1")`) === 0, "taking a star back withdraws the coin");
    await ev(`(function(){ const w=weeks.k1; w.done["${day}"].push("${am[0]}"); saveWeek("k1"); awardCategory("k1","am","${day}",false,""); awardCategory("k1","am","${day}",false,""); return true; })()`);
    ok(await ev(`coins("k1")`) === 1, "finishing again pays once, never twice");
    for(const cat of ["pm","bt","hp"]){ const ids = await catJobs(cat); if(!ids.length) continue; await ev(`view.routine="${cat}"; render(); true`); await tapAll(ids); }
    const paid = await ev(`Object.keys(buddies.k1.coinAwards).map(k=>k.split(":")[2]).sort()`);
    const expect = []; for(const c of ["am","bt","hp","pm"]) if((await catJobs(c)).length) expect.push(c);
    ok(same(paid, expect), "every category with jobs today paid exactly once: "+paid.join(","));
    ok(await ev(`coins("k1")`) === expect.length, "each category is worth 1 coin before the villain falls");

    // ---------- villain ----------
    await fresh();
    const v = await ev(`(function(){ const before=Object.keys(KIDS).map(k=>coins(k)); weeks.k2.bonus=monsterHP()+50; saveWeek("k2"); const won=checkMonster();
      const after=Object.keys(KIDS).map(k=>coins(k)); const again=checkMonster(); return {before, after, won, again, now:Object.keys(KIDS).map(k=>coins(k))}; })()`);
    ok(v.won && v.after.every((c,i)=>c-v.before[i]===10), "defeating the villain gives every kid 10 coins");
    ok(!v.again && v.now.every((c,i)=>c===v.after[i]), "the villain bonus is paid only once");
    ok(await ev(`awardCategory("k1","bt","${await ev(`ymd(new Date())`)}",monsterLeft()<=0,"")`) === 2, "after the villain falls, a category pays 2");
    await fresh();
    ok(await ev(`awardCategory("k1","pk","${await ev(`ymd(new Date())`)}",false,"")`) === 1, "the special mission pays 1 like a category");

    // ---------- starter and parent coins ----------
    await fresh();
    const st = await ev(`(function(){ const a=giveStarterCoins("k1"), b=giveStarterCoins("k1"); return {a,b,coins:coins("k1")}; })()`);
    ok(st.a === 25 && st.b === 0 && st.coins === 25, "starter coins are 25 and only given once");
    await fresh();
    const adj = await ev(`(function(){ const o=[]; const click=d=>{ const t=document.createElement("button"); t.dataset.a="coinAdj"; t.dataset.k="k1"; t.dataset.d=d; document.body.appendChild(t); t.click(); t.remove(); };
      o.push(coins("k1")); click(-1); o.push(coins("k1")); click(1); click(1); o.push(coins("k1")); click(-1); click(-1); click(-1); o.push(coins("k1")); return o; })()`);
    ok(same(adj,[0,0,2,0]), "grown-up coin +/- works and the balance never goes below zero: "+JSON.stringify(adj));
    const btns = await ev(`(function(){ view.kid=null; render(); panel(); const q=a=>[...document.querySelectorAll('#gPanel [data-a="'+a+'"][data-k="k1"]')].map(b=>b.textContent.trim()); const r={stars:q("bonus"),coins:q("coinAdj")}; layer.innerHTML=""; return r; })()`);
    ok(same(btns,{stars:["−","+"],coins:["−","+"]}), "Grown-ups has − and + buttons for both stars and coins");

    // ---------- a brand new family gets the starter coins at the end of Momster's tutorial; an existing one does not ----------
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); true`); await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`wizStart(); wiz.kids=[{id:"k1",name:"Ana",av:"🦄",color:"#E2468A"},{id:"k2",name:"Ben",av:"🦖",color:"#1A9C74"}]; wiz.step=WIZ_STEPS.indexOf("pin"); wizSheet(); true`);
    for(const n of ["1","2","3","4"]) await ev(`document.querySelector('[data-a="wizPin"][data-n="${n}"]').click(); true`);
    await sleep(900);
    ok(await ev(`!!window.tourOn && !!document.getElementById("tour")`), "finishing setup for a brand new family starts Momster's tutorial");
    ok(same(await ev(`Object.keys(KIDS).map(k=>coins(k))`),[0,0]), "no coins yet while the tutorial is still talking");
    await ev(`MomsterTour.finish(false); true`);
    ok(same(await ev(`Object.keys(KIDS).map(k=>coins(k))`),[0,0]), "skipping the tutorial gives no starter coins");
    await ev(`MomsterTour.start(); true`); await sleep(300);
    await ev(`MomsterTour.reward(); true`); await sleep(300);
    ok(same(await ev(`Object.keys(KIDS).map(k=>coins(k))`),[25,25]), "the tutorial's reward line gives each kid 25 coins");
    await ev(`MomsterTour.finish(true); true`);
    await ev(`wizStart(); wiz.step=WIZ_STEPS.indexOf("pin"); wizSheet(); true`);
    for(const n of ["9","9","9","9"]) await ev(`document.querySelector('[data-a="wizPin"][data-n="${n}"]').click(); true`);
    await sleep(600);
    ok(!(await ev(`!!window.tourOn`)), "running setup again for an existing family does not start the tutorial");
    ok(same(await ev(`Object.keys(KIDS).map(k=>Object.keys(buddies[k].coinAwards).length)`),[1,1]), "running setup again does not give the starter coins twice");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
