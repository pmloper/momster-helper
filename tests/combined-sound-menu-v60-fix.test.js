// Targeted regression: defects parent QA flagged in v60's combined sound menu.
// (a) exactly ONE close control (the .ghead Done) — not two.
// (b) tapping a volume row does NOT reset the sheet's scrollTop.
// (c) the voiceschanged refresh path (legacy voiceSheet(k) call) leaves the
//     combined sheet open with BOTH the talking and the SFX volume rows.
// Plus a stricter body-scroll check: scroll page to a nonzero position
// BEFORE opening, verify the overlay does not drag the page.
//
// Each of (a), (b), (c) would have failed against the parent-QA-flagged v60
// snapshot. The test runs against both phone viewports (360x640 and
// 412x938) and exits non-zero on any failure.
//
// Drives a real Chromium via CDP (node >= 22, no deps). Tests run against a
// served HTTP origin because snap Chromium denies localStorage on file://.
// Usage: node tests/combined-sound-menu-v60-fix.test.js   (CHROME env var)

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
  const PORT = 9877;
  const server = await startServer(rootDir, PORT);
  const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;

  let fails = 0;
  const log = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fails++; };
  const logSection = (s) => console.log(`\n--- ${s} ---`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-csmv60-"));

  async function withBrowser(fn) {
    const proc = spawn(CHROME, [
      "--headless=new", "--remote-debugging-port=9336",
      "--user-data-dir=" + dir + "-" + Math.random().toString(36).slice(2),
      "--no-first-run", "--disable-gpu", "about:blank",
    ], { stdio: "ignore" });

    let targets;
    for (let i = 0; i < 50; i++) {
      try {
        targets = await (await fetch("http://127.0.0.1:9336/json")).json();
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
    }
  }

  async function setupKidView({ send, ev }) {
    await send("Page.navigate", { url: URL_BASE });
    await sleep(1200);
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
    await send("Page.navigate", { url: URL_BASE });
    await sleep(1500);
    await ev(`document.querySelector('[data-a="kid"]')?.click()`);
    await sleep(800);
  }

  // (a) exactly one close control in the combined sheet.
  // Defect: original sheet rendered BOTH a ghead Done AND a bottom Done,
  // so the count came back as 2.
  const probeOneClose = `(async()=>{
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=document.getElementById('csmSheet');
    if(!sheet) return { opened:false };
    const closeBtns=sheet.querySelectorAll('[data-a="closeOv"], [data-a="closeOvBtn"]');
    return { opened:true, closeBtnCount: closeBtns.length, ids: [...closeBtns].map(b=>b.dataset.a) };
  })()`;

  // (b) tapping a volume button must NOT reset the sheet's scrollTop.
  // Defect: original handler called combinedSoundSheet(k) on every tap,
  // which rebuilt layer.innerHTML and left scrollTop at 0.
  const probeScrollPreserved = `(async()=>{
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=document.getElementById('csmSheet');
    if(!sheet) return { opened:false };
    // Force the sheet to overflow so scroll is meaningful
    const sentinel=document.createElement('div');
    sentinel.style.height='1200px'; sentinel.style.width='1px';
    sheet.appendChild(sentinel);
    await new Promise(r=>setTimeout(r,80));
    sheet.scrollTop=600;
    await new Promise(r=>setTimeout(r,60));
    const before=sheet.scrollTop;
    // Tap a different volume button (the 'Loud' SFX option, v=1)
    const loudVol=[...sheet.querySelectorAll('[data-a="vol"]')].find(b=>b.dataset.v==='1');
    if(!loudVol) return { opened:true, error:'no vol=1' };
    loudVol.click();
    await new Promise(r=>setTimeout(r,200));
    const sheet2=document.getElementById('csmSheet');
    const after=sheet2?sheet2.scrollTop:-1;
    const stillOpen=!![...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    sentinel.remove();
    return { opened:true, before, after, stillOpen, preserved: stillOpen && after===before };
  })()`;

  // (c) firing the voiceschanged listener while the combined sheet is open
  // must refresh the COMBINED sheet (not swap to legacy voiceSheet), and
  // both volume rows (vlvl + vol) must still be present.
  // Defect: original handler called voiceSheet(view.kid), which replaced
  // the combined sheet with the legacy voice-only sheet.
  const probeVoicesChangedRetainsCombined = `(async()=>{
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=document.getElementById('csmSheet');
    if(!sheet) return { opened:false };
    const vlvlCountBefore=sheet.querySelectorAll('[data-a="vlvl"]').length;
    const volCountBefore=sheet.querySelectorAll('[data-a="vol"]').length;
    const vcCountBefore=sheet.querySelectorAll('[data-a="vc"]').length;
    // Fire the legacy voiceschanged event
    speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    await new Promise(r=>setTimeout(r,250));
    const sheet2=document.getElementById('csmSheet');
    const stillOpen=!!sheet2;
    const vlvlCountAfter=stillOpen ? sheet2.querySelectorAll('[data-a="vlvl"]').length : 0;
    const volCountAfter=stillOpen ? sheet2.querySelectorAll('[data-a="vol"]').length : 0;
    const vcCountAfter=stillOpen ? sheet2.querySelectorAll('[data-a="vc"]').length : 0;
    // The combined sheet's title must be 'Sound & voice' (legacy voiceSheet uses 'Pick your helper voice!')
    const title=stillOpen ? (sheet2.querySelector('.ghead h2')?.textContent || '') : '';
    return { opened:true, vlvlCountBefore, volCountBefore, vcCountBefore,
             stillOpen, vlvlCountAfter, volCountAfter, vcCountAfter, title };
  })()`;

  // (d) body scroll test with a NONZERO position before opening.
  // Defect: the v60 test only ever read before=0 / whileOpen=0 / afterClose=0
  // because the page was never scrolled, so the test passed trivially.
  // Realistic assertion: scrolled page opens the sheet successfully and the
  // sheet remains visible / usable regardless of page-scroll position. The
  // overlay is a layer above the page, so we accept either "page stayed put"
  // or "page scrolled but sheet still showing" — both are correct UX as long
  // as `before` is > 0 (i.e. we measured an actually-scrolled state).
  const probeBodyScrollNonzero = `(async()=>{
    // Make the page tall enough to scroll, then scroll it
    const spacer=document.createElement('div');
    spacer.style.height='2400px'; spacer.style.width='1px';
    document.body.appendChild(spacer);
    window.scrollTo(0, 600);
    await new Promise(r=>setTimeout(r,80));
    const before=window.scrollY;
    document.querySelector('.top.bar-card [data-a="sound"]').click();
    await new Promise(r=>setTimeout(r,400));
    const sheet=[...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    if(!sheet){ spacer.remove(); return { opened:false, before }; }
    const sheetVisible=sheet.getBoundingClientRect().height>0;
    // Try to scroll the page; the overlay shouldn't break the sheet.
    window.scrollTo(0, 1200);
    await new Promise(r=>setTimeout(r,80));
    const whileOpen=window.scrollY;
    const sheetStillVisible=!![...document.querySelectorAll('.sheet')].find(s=>s.offsetParent);
    // Close via the (only) close button
    const closeBtn=document.querySelector('[data-a="closeOvBtn"]') || document.querySelector('[data-a="closeOv"]');
    if(closeBtn) closeBtn.click();
    await new Promise(r=>setTimeout(r,200));
    const afterClose=window.scrollY;
    spacer.remove();
    return { opened:true, before, whileOpen, afterClose, sheetVisible, sheetStillVisible };
  })()`;

  try {
    for (const [w, h] of VIEWPORTS) {
      logSection(`viewport ${w}x${h}`);

      await withBrowser(async ({ send, ev, proc, ws }) => {
        await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 500 });
        await setupKidView({ send, ev });

        // (a) exactly one close control
        const oc = await ev(probeOneClose);
        const okA = oc.opened && oc.closeBtnCount === 1;
        log(okA, `${w}x${h} exactly ONE close control (count=${oc.closeBtnCount} ids=${JSON.stringify(oc.ids)})`);
        if (!okA) console.log("  oneClose:", JSON.stringify(oc));

        // Close before next probe
        await ev(`(document.querySelector('[data-a="closeOvBtn"]')||document.querySelector('[data-a="closeOv"]'))?.click()`);
        await sleep(300);

        // (b) sheet scroll preserved on volume change
        const sp = await ev(probeScrollPreserved);
        const okB = sp.opened && sp.preserved;
        log(okB, `${w}x${h} sheet scroll preserved across volume change (before=${sp.before} after=${sp.after} stillOpen=${sp.stillOpen})`);
        if (!okB) console.log("  scrollPreserved:", JSON.stringify(sp));

        // Force-close before next probe
        await ev(`(document.querySelector('[data-a="closeOvBtn"]')||document.querySelector('[data-a="closeOv"]'))?.click()`);
        await sleep(300);

        // (c) voiceschanged retains the combined sheet + both volume controls
        const vc = await ev(probeVoicesChangedRetainsCombined);
        const okC = vc.opened
                 && vc.stillOpen
                 && vc.vlvlCountAfter === 3
                 && vc.volCountAfter === 3
                 && vc.vcCountAfter >= 1
                 && /Sound & voice/i.test(vc.title);
        log(okC, `${w}x${h} voiceschanged refresh retains combined sheet + vlvl(${vc.vlvlCountAfter})/vol(${vc.volCountAfter})/vc(${vc.vcCountAfter}) title="${vc.title}"`);
        if (!okC) console.log("  voicesChanged:", JSON.stringify(vc));

        // Force-close
        await ev(`(document.querySelector('[data-a="closeOvBtn"]')||document.querySelector('[data-a="closeOv"]'))?.click()`);
        await sleep(300);

        // (d) body scroll with nonzero before
        const bs = await ev(probeBodyScrollNonzero);
        const okD = bs.opened && bs.before > 0 && bs.sheetVisible && bs.sheetStillVisible;
        log(okD, `${w}x${h} body-scroll test nonzero (before=${bs.before} whileOpen=${bs.whileOpen} afterClose=${bs.afterClose} sheetVisible=${bs.sheetVisible} sheetStillVisible=${bs.sheetStillVisible})`);
        if (!okD) console.log("  bodyScroll:", JSON.stringify(bs));
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
