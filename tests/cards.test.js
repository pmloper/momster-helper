// Cards that wait for a tap: a tap anywhere else closes them, the joke is offered on a card (not played on its own), the coin for
// finishing a routine arrives as a card, and the weekly goal recommendation says 100.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/cards.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19530, HTTP_PORT = 19531;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-cd-"));
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
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof tapJob === "function" && typeof popup === "function"`)) return; await sleep(250); }
    throw new Error("app did not initialize");
  }
  try {
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); true`);
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    await ev(`(function(){ window.__k=[]; const p=window.play; window.play=function(k){ window.__k.push(JSON.stringify(k)); return p.apply(this,arguments); }; window.__hits=0; const b=document.createElement("button"); b.id="under"; b.textContent="under"; b.style.cssText="position:fixed;left:0;top:0;width:60px;height:40px;z-index:5"; b.onclick=()=>{ window.__hits++; }; document.body.appendChild(b); view.kid=null; render(); return true; })()`);
    const keys = async () => JSON.parse(await ev(`JSON.stringify(window.__k.map(x=>JSON.parse(x)).flat())`));
    const cards = () => ev(`document.querySelectorAll(".cheer.tapcard").length`);

    // 1. A tap that is not on the card closes it and does nothing else
    await ev(`cheer("🎉","Hello card"); true`); await sleep(500);
    ok((await cards()) === 1, "a card is showing");
    await ev(`document.getElementById("under").click(); true`); await sleep(150);
    ok((await cards()) === 0, "tapping outside the card closes it");
    ok((await ev(`window.__hits`)) === 0, "and that tap does not also press the button underneath");
    await ev(`cheer("🎉","Hello again"); true`); await sleep(1000);
    await ev(`document.querySelector(".cheer.tapcard").click(); true`); await sleep(150);
    ok((await cards()) === 0, "tapping the card closes it too");
    await ev(`document.getElementById("under").click(); true`);
    ok((await ev(`window.__hits`)) === 1, "with no card up, the button works as usual");

    // 2. The joke is offered, and only played when the card is tapped
    await ev(`window.__k.length=0; jokeOffer("k1","am"); true`); await sleep(900);
    ok((await ev(`(document.querySelector(".jokecard")||{}).textContent||""`)).includes("Joke time"), "a joke card appears");
    ok(!(await keys()).includes("jokeintro"), "the joke is not played by itself");
    await ev(`document.getElementById("under").click(); true`); await sleep(300);
    ok(!(await keys()).includes("jokeintro"), "tapping outside the joke card closes it without telling the joke");
    await ev(`window.__k.length=0; jokeOffer("k1","am"); true`); await sleep(1000);
    await ev(`document.querySelector(".jokecard").click(); true`); await sleep(200);
    ok((await keys()).includes("jokeintro"), "tapping the joke card plays the joke");

    // 2b. One joke per finished group; "Joke time!" is said once
    await ev(`saveLocal("jokes", {}); window.__k.length=0; playJoke("k1","pm"); playJoke("k1","pm"); playJoke("k1","pm"); true`);
    const calls = JSON.parse(await ev(`JSON.stringify(window.__k.map(x=>JSON.parse(x)).filter(a=>Array.isArray(a)))`)).slice(-3);
    ok(calls.length === 3 && calls[0][0] === "jokeintro" && calls[0].length === 2, "the first press says Joke time and tells the joke: " + JSON.stringify(calls[0]));
    ok(calls[1].length === 1 && calls[2].length === 1 && calls[1][0] === calls[0][1] && calls[2][0] === calls[0][1], "later presses replay the same joke without Joke time: " + JSON.stringify(calls.slice(1)));
    await ev(`window.__k.length=0; playJoke("k1","bt"); true`);
    const other = JSON.parse(await ev(`JSON.stringify(window.__k.map(x=>JSON.parse(x)))`)).flat();
    ok(other[0] === "jokeintro", "a different finished group has its own joke (and its own first-time intro): " + JSON.stringify(other));
    await ev(`window.__k.length=0; jokeOffer("k1","pm"); true`); await sleep(1000);
    await ev(`document.querySelector(".jokecard").click(); true`); await sleep(200);
    const viaCard = JSON.parse(await ev(`JSON.stringify(window.__k.map(x=>JSON.parse(x)))`)).flat();
    ok(!viaCard.includes("jokeintro") && viaCard.includes(calls[0][1]), "the card plays that group's same joke, with no second Joke time: " + JSON.stringify(viaCard));
    ok(!viaCard.some(k=>/Joke time/i.test(String(k))), "and the card's spoken prompt does not say Joke time either");

    // 3. Finishing a routine gives its coin on a card
    await ev(`window.__k.length=0; buddies.k1.coinAwards={}; awardCategory("k1","am",ymd(new Date()),false,"Morning done!"); true`); await sleep(3000);
    ok((await ev(`(document.querySelector(".cheer")||{}).textContent||""`)).includes("+1 🪙 coin"), "the coin card shows +1 coin: " + (await ev(`(document.querySelector(".cheer")||{}).textContent`)));
    ok((await keys()).includes("coin") && (await keys()).includes("BJ:You earned a coin!"), "it plays the coin sound and says it");
    ok((await ev(`coins("k1")`)) === 1, "the coin was added");
    await ev(`document.getElementById("under").click(); true`); await sleep(500);
    await ev(`window.__k.length=0; awardCategory("k1","pm",ymd(new Date()),true,"After school done!"); true`); await sleep(3000);
    ok((await ev(`(document.querySelector(".cheer")||{}).textContent||""`)).includes("+2 🪙 coins") && (await keys()).includes("BJ:You earned 2 coins!"), "after the villain is beaten it is 2 coins");
    await ev(`awardCategory("k1","pm",ymd(new Date()),true,"After school done!"); true`); await sleep(2800);
    ok((await ev(`coins("k1")`)) === 3, "a category pays only once a day (3 coins in all)");

    // 3b. The real flow: finish every job of every group today and each group pays its coin
    await ev(`document.querySelectorAll(".cheer,.dmgpop-ov").forEach(x=>x.remove()); popQ.length=0; popBusy=false; layer.innerHTML=""; buddies.k1.coinAwards={}; buddies.k1.adjCoins=0; buddies.k1.bonusCoins=0; buddies.k1.spent=0; weeks.k1.done={}; true`);
    const groups = JSON.parse(await ev(`JSON.stringify(ROUTINES.filter(r=>jobsFor(r,todayDow(),"k1").length>0).map(r=>r.id))`));
    for (const g of groups) await ev(`(function(){ view.kid="k1"; view.routine=${JSON.stringify(g)}; const r=ROUTINES.find(x=>x.id===view.routine); jobsFor(r,todayDow(),"k1").forEach(j=>tapJob("k1", j.id)); return true; })()`);
    ok(groups.length >= 3, "today has several job groups: " + groups.join(","));
    ok((await ev(`coins("k1")`)) === groups.length, "finishing every job in " + groups.length + " groups paid " + groups.length + " coins: " + (await ev(`coins("k1")`)));
    ok(await ev(`Object.keys(buddies.k1.coinAwards).filter(k=>/^cat:/.test(k)).length`) === groups.length, "one coin award recorded per group");
    await sleep(4500);
    let sawCoinCard = false;
    for (let i = 0; i < 60; i++) { if (await ev(`[...document.querySelectorAll(".cheer")].some(c=>c.textContent.includes("coin") && c.textContent.includes("+"))`)) { sawCoinCard = true; break; }
      if (await ev(`!!document.querySelector(".dmgpop-ov")`)) await ev(`document.querySelector(".dmgpop-ov").click(); true`); else if (await ev(`!!document.querySelector(".cheer.tapcard")`)) await ev(`document.querySelector(".cheer.tapcard").click(); true`); else if (await ev(`!!layer.querySelector(".egg")`)) await ev(`close(); true`);
      await sleep(250); }
    ok(sawCoinCard, "a coin card came up among the end-of-routine cards");

    // 4. The weekly star goal recommends 100
    await ev(`document.querySelectorAll(".cheer").forEach(x=>x.remove()); settings.goal=80; saveSettings(); panel(); true`); await sleep(300);
    ok((await ev(`[...document.querySelectorAll(".srow")].map(x=>x.textContent).find(t=>/Weekly star goal/.test(t))||""`)).includes("Recommended: 100"), "the weekly star goal recommends 100");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
