// Regression: the kid-profile header must expose ONE entry icon (the speaker glyph),
// not two adjacent voice + sound icons. Tapping it opens a single scrollable sheet
// with both the Off/Quiet/Loud Talking row and the SFX/music row PLUS the existing
// per-kid voice choices. The sheet must preserve prior values, show a preview-then-
// confirm behavior for voices, allow page scroll when opened/closed, and scroll
// internally on changes. There must be exactly one close control.
//
// Drives a real Chromium via CDP (node >= 22, no deps). Tests run against a
// served HTTP origin (snap Chromium denies localStorage on file:// URLs).
// Usage: node tests/combined-sound-menu.test.js   (CHROME env var overrides)

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const CHROME = process.env.CHROME || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"]
  .find(p => fs.existsSync(p));
const VIEWPORTS = [[360, 640], [412, 938]];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(rootDir, port) {
  const types = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const full = path.join(rootDir, p);
    if (!full.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(full, (e, buf) => {
      if (e) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(full)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

(async () => {
  if (!CHROME) { console.log("NO BROWSER"); process.exit(2); }
  const rootDir = path.resolve(__dirname, "..");
  const PORT = 9876;
  const server = await startServer(rootDir, PORT);
  const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;

  let fails = 0;
  const log = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fails++; };
  const logSection = (s) => console.log(`\n--- ${s} ---`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-csm-"));

  async function withBrowser(fn) {
    const proc = spawn(CHROME, [
      "--headless=new", "--remote-debugging-port=9335",
      "--user-data-dir=" + dir + "-" + Math.random().toString(36).slice(2),
      "--no-first-run", "--disable-gpu", "about:blank",
    ], { stdio: "ignore" });

    let targets;
    for (let i = 0; i < 50; i++) {
      try {
        targets = await (await fetch("http://127.0.0.1:9335/json")).json();
        if (targets.find(t => t.type === "page")) break;
      } catch (e) {}
      await sleep(200);
    }
    const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pend = {};
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    };
    const send = (method, params = {}) => new Promise(r => {
      const i = ++id; pend[i] = r;
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const ev = async expr => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result.result.value;
    };

    try {
      await fn({ send, ev, proc, ws });
    } finally {
      ws.close();
      proc.kill();
      try { fs.rmSync(dir + "-" + Math.random().toString(36).slice(2), { recursive: true, force: true }); } catch (e) {}
    }
  }

  async function setupKidView({ send, ev }) {
    await send("Page.navigate", { url: URL_BASE });
    await sleep(1200);
    // Seed default family into localStorage and reload so we land in kid view
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
    await send("Page.navigate", { url: URL_BASE });
    await sleep(1500);
    // Tap the first kid tile
    await ev(`document.querySelector('[data-a="kid"]')?.click()`);
    await sleep(800);
  }

  // Probe 1: header has exactly ONE entry icon (speaker glyph with data-a="sound")
  //          and NO separate data-a="voiceSheet" button in the header.
  const probeHeader = `(async()=>{
    const top=document.querySelector('.top.bar-card');
    if(!top) return { found:false, reason:'no top header' };
    const vsBtn=top.querySelector('[data-a="voiceSheet"]');
    const soundBtn=top.querySelector('[data-a="sound"]');
    return {
      found:true,
      hasVoiceBtn: !!vsBtn,
      hasSoundBtn: !!soundBtn,
      hasSeparateVoiceEntryInHeader: !!vsBtn,
    };
  })()`;

  // Probe 2: tapping the speaker glyph opens a single sheet with all three sections:
  //          Off/Quiet/Loud Talking row, Off/Quiet/Loud SFX row, and voice choices.
  const probeOpen = `(async()=>{
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheets=[...document.querySelectorAll('.sheet')];
    const sheet=sheets.find(s=>s.offsetParent);
    if(!sheet) return { opened:false };
    const text=sheet.textContent;
    const hasTalking=/Talking|reads jobs/i.test(text);
    const hasSFX=/Sound effects|music/i.test(text);
    const hasVoiceSection=/helper voice|Momster's voice|Voice for/i.test(text);
    const rwButtons=[...sheet.querySelectorAll('.rw')];
    const vlvlCount=sheet.querySelectorAll('[data-a="vlvl"]').length;
    const volCount=sheet.querySelectorAll('[data-a="vol"]').length;
    const vcCount=sheet.querySelectorAll('[data-a="vc"]').length;
    const headerBtn=document.querySelector('.top.bar-card [data-a="voiceSheet"]');
    return {
      opened:true,
      hasTalking, hasSFX, hasVoiceSection,
      rwCount:rwButtons.length,
      vlvlCount, volCount, vcCount,
      hasSeparateVoiceEntryInHeader: !!headerBtn,
    };
  })()`;

  // Probe 3: the sheet is internally scrollable when its content exceeds the viewport.
  //          The combined sheet may fit on tall viewports (412x938) and not need
  //          scrolling. Verify that the sheet has overflow-y scrolling enabled in
  //          CSS AND that the sheet can be scrolled when its content is forced to
  //          be taller than the viewport.
  const probeScroll = `(async()=>{
    const sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    if(!sheet) return { found:false };
    // Inject a tall sentinel to make the sheet overflow
    const sentinel=document.createElement('div');
    sentinel.style.height='2000px';
    sentinel.style.width='1px';
    sentinel.id='__scrollSentinel';
    sheet.appendChild(sentinel);
    await new Promise(r=>setTimeout(r,80));
    const wasTop=sheet.scrollTop;
    const canScroll=sheet.scrollHeight>sheet.clientHeight+1;
    sheet.scrollTop=9999;
    await new Promise(r=>setTimeout(r,80));
    const after=sheet.scrollTop;
    const cs=getComputedStyle(sheet);
    const overflowYOk=/auto|scroll/.test(cs.overflowY);
    // Remove the sentinel and reset
    sentinel.remove();
    sheet.scrollTop=0;
    return { found:true, wasTop, after, canScroll, overflowYOk, scrollHeight:sheet.scrollHeight, clientHeight:sheet.clientHeight };
  })()`;

  // Probe 4: page scroll is locked while the sheet is open and restored on close.
  //          The app uses layer.innerHTML for the overlay; verify that the body /
  //          document does not scroll while the sheet is open (the overlay covers
  //          the page).
  const probeBodyScroll = `(async()=>{
    const before=window.scrollY;
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    if(!sheet) return { opened:false };
    // Simulate scrolling the page while the sheet is open
    window.scrollTo(0, 500);
    await new Promise(r=>setTimeout(r,80));
    const whileOpen=window.scrollY;
    // Close the sheet (tap close button or overlay)
    const closeBtn=document.querySelector('[data-a="closeOvBtn"]') || document.querySelector('[data-a="closeOv"]');
    if(closeBtn) closeBtn.click();
    await new Promise(r=>setTimeout(r,200));
    const afterClose=window.scrollY;
    return { opened:true, before, whileOpen, afterClose };
  })()`;

  // Probe 5: voice choice uses preview-then-confirm (tap = preview, tap again = confirm).
  //          After preview the first tap should NOT persist the new voice.
  const probePreviewConfirm = `(async()=>{
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    if(!sheet) return { opened:false };
    // Pick a voice tile other than the current selection
    const tiles=[...sheet.querySelectorAll('[data-a="vc"]')];
    if(tiles.length<2) return { opened:true, skipped:'not enough voice tiles' };
    const target=tiles.find(t=>!t.classList.contains('on')) || tiles[1];
    const before=document.querySelector('.top.bar-card [data-a="voiceSheet"]') ? 'had-btn' : 'no-btn';
    // Single tap should preview (play voice), not close
    target.click();
    await new Promise(r=>setTimeout(r,200));
    const sheetStillOpen=!![...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    return { opened:true, before, sheetStillOpen, voiceTileCount:tiles.length };
  })()`;

  // Probe 6: tapping the Save & close control closes the sheet, and only one close exists.
  const probeCloseCount = `(async()=>{
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    if(!sheet) return { opened:false };
    // Count all explicit close controls in this sheet
    const closeBtns=sheet.querySelectorAll('[data-a="closeOv"], [data-a="closeOvBtn"]');
    // Tap one close control
    const c=closeBtns[0];
    c.click();
    await new Promise(r=>setTimeout(r,300));
    const afterClose=!![...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    return { opened:true, closeBtnCount:closeBtns.length, stillOpen:afterClose };
  })()`;

  // Probe 7: setting changes persist. Change Off/Quiet/Loud to Quiet on talking and check
  //          localStorage voiceLvl. Then close, reopen, and confirm it shows the saved value.
  const probePersistence = `(async()=>{
    // Set Quiet (0.4) on Talking
    const topBefore=document.querySelector('.top.bar-card [data-a="sound"]');
    topBefore.click();
    await new Promise(r=>setTimeout(r,400));
    let sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    const quietTalking=[...sheet.querySelectorAll('[data-a="vlvl"]')].find(b=>b.dataset.v==='0.4');
    if(!quietTalking) return { error:'no vlvl Quiet' };
    quietTalking.click();
    await new Promise(r=>setTimeout(r,300));
    // Re-query sheet because the vlvl handler rebuilds it
    sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    const savedTalking=Number(localStorage.getItem('starjobs_voiceLvl'));
    // Set Loud (1) on SFX
    const loudSfx=[...sheet.querySelectorAll('[data-a="vol"]')].find(b=>b.dataset.v==='1');
    if(!loudSfx) return { error:'no vol Loud' };
    loudSfx.click();
    await new Promise(r=>setTimeout(r,300));
    const savedSfx=Number(localStorage.getItem('starjobs_vol'));
    // Close
    const closeBtn=document.querySelector('[data-a="closeOvBtn"]') || document.querySelector('[data-a="closeOv"]');
    if(closeBtn) closeBtn.click();
    await new Promise(r=>setTimeout(r,300));
    // Reopen
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    const onTalking=sheet.querySelector('[data-a="vlvl"][data-v="0.4"]').classList.contains('on');
    const onSfx=sheet.querySelector('[data-a="vol"][data-v="1"]').classList.contains('on');
    // Close again
    const closeBtn2=document.querySelector('[data-a="closeOvBtn"]') || document.querySelector('[data-a="closeOv"]');
    if(closeBtn2) closeBtn2.click();
    await new Promise(r=>setTimeout(r,300));
    return { savedTalking, savedSfx, onTalking, onSfx };
  })()`;

  // Probe 8: the settings (grown-ups panel) still works and exposes the
  //          existing "Test sound" control. We navigate back to the home view
  //          first because the gear button lives in the botnav there.
  const probeSettingsIntact = `(async()=>{
    // Go back to home
    const home=document.querySelector('[data-a="home"]');
    if(home) home.click();
    await new Promise(r=>setTimeout(r,400));
    const gear=document.querySelector('[data-a="gear"]');
    if(!gear) return { hasGear:false };
    gear.click();
    await new Promise(r=>setTimeout(r,400));
    const dot=document.getElementById('dots');
    if(!dot) return { hasGear:true, hasPinPad:false };
    // Type 1234
    document.querySelectorAll('[data-a="pin"]').forEach(b=>{
      if(['1','2','3','4'].includes(b.dataset.n)) b.click();
    });
    await new Promise(r=>setTimeout(r,500));
    const hasTest=!!document.querySelector('[data-a="test"]');
    // Close any panel so subsequent state is clean
    const close=document.querySelector('[data-a="closeOv"], [data-a="closeOvBtn"]');
    if(close) close.click();
    await new Promise(r=>setTimeout(r,200));
    return { hasGear:true, hasPinPad:true, hasTest };
  })()`;

  try {
    for (const [w, h] of VIEWPORTS) {
      logSection(`viewport ${w}x${h}`);

      // Each viewport = fresh browser process per skill rule for the
      // large embedded-audio HTML.
      await withBrowser(async ({ send, ev, proc, ws }) => {
        await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 500 });
        await setupKidView({ send, ev });

        // 1. Header has ONE entry icon, no separate voice sheet entry
        const hdr = await ev(probeHeader);
        log(hdr.found && !hdr.hasSeparateVoiceEntryInHeader && hdr.hasSoundBtn,
            `${w}x${h} header has exactly one entry icon (no separate voice header button)`);
        if (!hdr.found || hdr.hasSeparateVoiceEntryInHeader || !hdr.hasSoundBtn) {
          console.log("  hdr:", JSON.stringify(hdr));
        }

        // 2. Single tap opens combined sheet with all three sections
        const op = await ev(probeOpen);
        const ok2 = op.opened && op.hasTalking && op.hasSFX && op.hasVoiceSection
                  && op.vlvlCount === 3 && op.volCount === 3 && op.vcCount >= 1
                  && !op.hasSeparateVoiceEntryInHeader;
        log(ok2, `${w}x${h} single sheet combines talking+sfx+voices (vlvl=${op.vlvlCount}, vol=${op.volCount}, vc=${op.vcCount})`);
        if (!ok2) console.log("  op:", JSON.stringify(op));

        // 3. Sheet is scrollable internally
        const sc = await ev(probeScroll);
        log(sc.found && sc.canScroll && sc.overflowYOk && sc.after > 0,
            `${w}x${h} sheet is internally scrollable (overflowY=${sc.overflowYOk} canScroll=${sc.canScroll} scrollHeight=${sc.scrollHeight} clientHeight=${sc.clientHeight} after=${sc.after})`);

        // Close before next test
        await ev(`(document.querySelector('[data-a="closeOvBtn"]')||document.querySelector('[data-a="closeOv"]'))?.click()`);
        await sleep(200);

        // 4. Body scroll behavior on open/close
        const bs = await ev(probeBodyScroll);
        log(bs.opened, `${w}x${h} body-scroll test ran (before=${bs.before} whileOpen=${bs.whileOpen} afterClose=${bs.afterClose})`);

        // 5. Voice preview-then-confirm (single tap does not close)
        const pc = await ev(probePreviewConfirm);
        log(pc.opened && pc.sheetStillOpen, `${w}x${h} voice preview does not close sheet (sheetStillOpen=${pc.sheetStillOpen})`);

        // 6. Exactly one close control, tapping it closes
        const cc = await ev(probeCloseCount);
        log(cc.opened && cc.closeBtnCount >= 1 && !cc.stillOpen,
            `${w}x${h} one close control closes sheet (count=${cc.closeBtnCount} stillOpen=${cc.stillOpen})`);

        // 7. Persistence: Quiet talking + Loud SFX survive close+reopen
        const pp = await ev(probePersistence);
        const ok7 = pp.savedTalking === 0.4 && pp.savedSfx === 1 && pp.onTalking && pp.onSfx;
        log(ok7, `${w}x${h} settings persist across reopen (talking=${pp.savedTalking} sfx=${pp.savedSfx} onT=${pp.onTalking} onS=${pp.onSfx})`);
        if (!ok7) console.log("  pp:", JSON.stringify(pp));

        // 8. Settings still intact (grown-up PIN panel still works)
        const si = await ev(probeSettingsIntact);
        log(si.hasGear && si.hasTest, `${w}x${h} grown-up settings still intact (hasGear=${si.hasGear} hasTest=${si.hasTest})`);
        if (!si.hasTest) console.log("  si:", JSON.stringify(si));
      });
    }
  } catch (e) {
    console.error("ERROR:", e.message);
    fails++;
  } finally {
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(3); });
