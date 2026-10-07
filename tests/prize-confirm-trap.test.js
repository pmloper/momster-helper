// Regression for the prize-confirm trap (Sarah 1557150264824303729 / Atlas 1557150445347147893):
//   "after one confirmed prize sheet reopens until both prize slots filled"
//   → Desired: close after one confirmation with no second-prize copy or entry point.
//
// Drives real Chrome via CDP; served Preview only (file:// blocks localStorage under snap Chromium).
// Usage: node tests/prize-confirm-trap.test.js [base-url]
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");
const CHROME = process.env.CHROME || ["/usr/bin/google-chrome","/usr/bin/chromium","/snap/bin/chromium","C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p=>fs.existsSync(p));
const BASE = process.argv[2] || "http://127.0.0.1:9334/";
const VIEWPORTS = [process.env.VIEWPORT === '412' ? [412,938] : [360,640]]; // one viewport per browser to avoid large embedded-audio page reload pressure
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!CHROME) { console.log("NO BROWSER"); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhp-"));
  const proc = spawn(CHROME, ["--headless=new","--remote-debugging-port=9335","--user-data-dir="+dir,"--no-first-run","--disable-gpu",BASE], {stdio:"ignore"});
  let targets; for (let i=0;i<50;i++){ try{ targets = await (await fetch("http://127.0.0.1:9335/json")).json(); if(targets.find(t=>t.type==="page")) break; }catch(e){} await sleep(200); }
  const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id=0; const pend={};
  ws.onmessage = m => { const d=JSON.parse(m.data); if(d.id&&pend[d.id]){ pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params={}) => new Promise(r => { const i=++id; pend[i]=r; ws.send(JSON.stringify({id:i,method,params})); });
  const ev = async expr => {
    let r;
    try { r = await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true}); }
    catch(e) { return { __error: String(e) }; }
    if (!r || !r.result) return { __error: "no-result" };
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };

  let fails = 0;

  // Probe after a Yes! confirmation: the prize picker sheet MUST NOT be re-shown.
  const probeAfterYes = `(() => {
    const layer = document.getElementById('layer');
    const sheet = layer ? layer.querySelector('.sheet') : null;
    const h2 = sheet ? sheet.querySelector('h2') : null;
    const h2text = h2 ? (h2.textContent || '').trim() : '';
    const fullText = sheet ? (sheet.textContent || '') : '';
    const prizeSheet = !!(sheet && h2 && /Pick your prize/i.test(h2text));
    const locked = !!(sheet && /This is your prize this week/i.test(fullText));
    const jarCard = document.querySelector('.jarCard');
    const jarText = jarCard?.textContent || '';
    const secondRef = /(?:2nd|second|prize\s*2|another\s+prize)/i;
    return { prizeSheetOpen: prizeSheet, lockedDialogOpen: locked,
      jarSecondReference: secondRef.test(jarText), addSecondButton: !!jarCard?.querySelector('[data-a=addPrize2]'),
      sheetH2: h2text, layerHasSheet: !!sheet };
  })()`;

  async function gotoKid() {
    await send("Page.navigate",{url:BASE});
    for (let i=0;i<30;i++){ await sleep(150); try{ const ok=await ev(`typeof DEFAULT_FAMILY !== 'undefined'`); if(ok) break; }catch(e){} }
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
    await send("Page.navigate",{url:BASE});
    for (let i=0;i<30;i++){ await sleep(150); try{ const ok=await ev(`typeof DEFAULT_FAMILY !== 'undefined'`); if(ok) break; }catch(e){} }
    await sleep(400);
    await ev(`document.querySelector('[data-a="kid"]')?.click()`); await sleep(500);
  }
  async function openPicker() {
    await ev(`(async()=>{ const b=document.querySelector('[data-a="pickReward"]'); if(!b) return false; b.click(); await new Promise(r=>setTimeout(r,400)); return !!document.querySelector('.rw'); })()`);
  }
  async function pickAndYes(tIdx) {
    // Wait until the picker has rendered at least n tiles.
    for (let i=0;i<20;i++){
      const ok = await ev(`document.querySelectorAll('.rw').length >= 1`);
      if (ok) break;
      await sleep(120);
    }
    const sel = "document.querySelectorAll('.rw')[" + tIdx + "].click()";
    await ev(sel); await sleep(300);
    // Wait for the rwYes button to appear.
    for (let i=0;i<20;i++){
      const ok = await ev(`!!document.querySelector('[data-a=rwYes]')`);
      if (ok) break;
      await sleep(120);
    }
    await ev(`document.querySelector('[data-a=rwYes]').click()`); await sleep(500);
  }

  for (const [w,h] of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:2,mobile:w<500});

    // Scenario A: prize 1 (first tile) — sheet must close, no forced reopen.
    await gotoKid();
    await openPicker();
    const n1 = await ev(`document.querySelectorAll('.rw').length`);
    await pickAndYes(0);
    const a = await ev(probeAfterYes);
    const aOk = a.prizeSheetOpen === false;
    if (!aOk) fails++;
    console.log(`${aOk?"PASS":"FAIL"} ${w}x${h} prize-1 (first tile) closes sheet  ${JSON.stringify(a)}`);

    // Scenario B: prize 1 (last tile) — same expectation.
    await gotoKid();
    await openPicker();
    const n2 = await ev(`document.querySelectorAll('.rw').length`);
    await pickAndYes(n2-1);
    const b = await ev(probeAfterYes);
    const bOk = b.prizeSheetOpen === false;
    if (!bOk) fails++;
    console.log(`${bOk?"PASS":"FAIL"} ${w}x${h} prize-1 (last tile)  closes sheet  ${JSON.stringify(b)}`);

    // The picker and the main kid jar must never suggest a second prize.
    await gotoKid();
    await openPicker();
    const before = await ev(`(() => ({
      pickerText: document.querySelector('#layer .sheet')?.textContent || '',
      jarText: document.querySelector('.jarCard')?.textContent || ''
    }))()`);
    const beforeOk = !/(?:2nd|second|prize\s*2|another\s+prize|first\s+prize)/i.test(before.pickerText + ' ' + before.jarText);
    if (!beforeOk) fails++;
    console.log(`${beforeOk?"PASS":"FAIL"} ${w}x${h} no second-prize prompt before choosing  ${JSON.stringify(before)}`);
    await pickAndYes(0);
    const after = await ev(probeAfterYes);
    const afterOk = !after.jarSecondReference && !after.addSecondButton;
    if (!afterOk) fails++;
    console.log(`${afterOk?"PASS":"FAIL"} ${w}x${h} no second-prize prompt after choosing  ${JSON.stringify(after)}`);
    await ev(`document.querySelector('[data-a="pickReward"]')?.click()`); await sleep(300);
    const locked = await ev(probeAfterYes);
    const lockedOk = locked.lockedDialogOpen === true;
    if (!lockedOk) fails++;
    console.log(`${lockedOk?"PASS":"FAIL"} ${w}x${h} locked dialog after one prize  ${JSON.stringify(locked)}`);
  }

  ws.close(); proc.kill(); try{ fs.rmSync(dir,{recursive:true,force:true}); }catch(e){}
  console.log(fails? `\n${fails} FAILURE(S)` : "\nALL PASS"); process.exit(fails?1:0);
})().catch(e => { console.error(e); process.exit(3); });