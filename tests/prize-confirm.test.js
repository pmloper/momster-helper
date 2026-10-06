// Regression: choosing a prize must keep the chosen tile, the sheet header and the
// Yes / Keep looking controls visible. Drives real Chrome via CDP (node >= 22, no deps).
// Usage: node tests/prize-confirm.test.js   (CHROME env var overrides the binary)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","/usr/bin/google-chrome","/usr/bin/chromium"].find(p=>fs.existsSync(p));
const URL_ = "file:///" + path.resolve(__dirname, "../index.html").split(path.sep).join("/");
const VIEWPORTS = [[360,640],[412,938],[430,932],[800,360]];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!CHROME) { console.log("NO BROWSER"); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-"));
  const proc = spawn(CHROME, ["--headless=new","--remote-debugging-port=9333","--user-data-dir="+dir,"--no-first-run","--disable-gpu","about:blank"], {stdio:"ignore"});
  let targets; for (let i=0;i<50;i++){ try{ targets = await (await fetch("http://127.0.0.1:9333/json")).json(); if(targets.find(t=>t.type==="page")) break; }catch(e){} await sleep(200); }
  const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id=0; const pend={};
  ws.onmessage = m => { const d=JSON.parse(m.data); if(d.id&&pend[d.id]){ pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params={}) => new Promise(r => { const i=++id; pend[i]=r; ws.send(JSON.stringify({id:i,method,params})); });
  const ev = async expr => { const r = await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true}); if(r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };

  let fails = 0;
  const probe = (idx) => `(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const sheet=document.querySelector('.sheet'); const tiles=[...sheet.querySelectorAll('.rw')]; const t=tiles[${idx}]; t.click(); await sleep(600);
    const hd=sheet.querySelector('.ghead'), top=Math.max(sheet.getBoundingClientRect().top, 0) + (getComputedStyle(hd).position==='sticky' ? hd.getBoundingClientRect().height : 0);
    const vis=(el,isHead)=>{ const r=el.getBoundingClientRect(), b=sheet.getBoundingClientRect(); return r.top>=(isHead?b.top:top)-1&&r.bottom<=b.bottom+1&&r.bottom<=innerHeight; };
    const conf=sheet.querySelector('.rwConfirm');
    return { scrollTop:sheet.scrollTop, tile:vis(t), head:vis(hd,true), yes:!!conf&&vis(conf.querySelector('[data-a=rwYes]')), no:!!conf&&vis(conf.querySelector('[data-a=rwNo]')) };
  })()`;
  for (const [w,h] of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:2,mobile:w<500});
    // scenarios: [prize number, tile to confirm first (prize 2 only), tile under test (-1 = last)]
    for (const [label, pre, idx] of [["prize1 first tile",null,0],["prize1 last tile",null,-1],["prize2 first tile",-1,0],["prize2 last tile",0,-1]]) {
      await send("Page.navigate",{url:URL_}); await sleep(1200);
      // skip first-run wizard: seed the default family, reload, enter the first kid
      await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
      await send("Page.navigate",{url:URL_}); await sleep(1500);
      await ev(`document.querySelector('[data-a="kid"]')?.click()`); await sleep(600);
      const opened = await ev(`(async()=>{ const b=document.querySelector('[data-a="pickReward"]'); if(!b) return false; b.click(); await new Promise(r=>setTimeout(r,400)); return !!document.querySelector('.rw'); })()`);
      if (!opened) { console.log(`FAIL ${w}x${h} ${label}: could not open prize sheet`); fails++; continue; }
      const n = await ev(`document.querySelectorAll('.rw').length`);
      if (pre !== null) {
        const p = pre < 0 ? n+pre : pre;
        await ev(`document.querySelectorAll('.rw')[${p}].click()`); await sleep(300);
        await ev(`document.querySelector('[data-a=rwYes]').click()`); await sleep(500);
      }
      const res = await ev(probe(idx < 0 ? n+idx : idx));
      const ok = res.tile && res.head && res.yes && res.no;
      if (!ok) fails++;
      console.log(`${ok?"PASS":"FAIL"} ${w}x${h} ${label}`, JSON.stringify(res));
    }
  }
  ws.close(); proc.kill(); try{ fs.rmSync(dir,{recursive:true,force:true}); }catch(e){}
  console.log(fails? `\n${fails} FAILURE(S)` : "\nALL PASS"); process.exit(fails?1:0);
})().catch(e => { console.error(e); process.exit(3); });
