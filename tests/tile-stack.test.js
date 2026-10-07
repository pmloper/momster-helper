// Regression: kid routine + Bonus tiles must stack icon → full label → reward
// stars vertically on real phones, with whole-word wrapping (no mid-word
// breaks), and every last tile must remain reachable above the bottom edge.
//
// Drives a real Chromium via CDP (node >= 22, no deps). Runs against a local
// HTTP origin so localStorage and the SW work. Two phone viewports are
// required: 360x640 (smallest target) and 412x938 (typical modern Android).
//
// Usage: node tests/tile-stack.test.js   (CHROME env var overrides browser)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const CHROME = process.env.CHROME
  || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"]
       .find(fs.existsSync);
if (!CHROME) { console.error("NO BROWSER"); process.exit(2); }

const VIEWPORTS = [
  { w: 360, h: 640, label: "360x640" },
  { w: 412, h: 938, label: "412x938" }
];
const SLEEP = ms => new Promise(r => setTimeout(r, ms));

function startServer(rootDir, port) {
  const types = { ".html":"text/html",".js":"application/javascript",".json":"application/json",".png":"image/png",".ico":"image/x-icon",".webmanifest":"application/manifest+json" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const full = path.join(rootDir, p);
    if (!full.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(full, (e, buf) => {
      if (e) { res.writeHead(404); res.end("not found"); return; }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control":"no-store" });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function driveChrome(cdpPort, w, h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-tile-"));
  const args = [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--disable-gpu",
    "--no-default-browser-check",
    "--disable-features=Translate",
    `--window-size=${w},${h}`,
    "about:blank"
  ];
  const proc = spawn(CHROME, args, { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
      const page = ts.find(t => t.type === "page");
      if (page) { target = page; break; }
    } catch (_) {}
    await SLEEP(150);
  }
  if (!target) { try { proc.kill("SIGKILL"); } catch(_){} throw new Error("no target"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression, awaitPromise = true) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (!r || !r.result) return null;
    if (r.result.exceptionDetails) {
      const txt = JSON.stringify(r.result.exceptionDetails).slice(0, 400);
      return { __error: txt };
    }
    return r.result.result.value;
  };
  return { proc, ws, send, ev, close: async () => { try { ws.close(); } catch(_){} try { proc.kill("SIGKILL"); } catch(_){} } };
}

async function prep(cdp, baseUrl) {
  await cdp.send("Page.navigate", { url: baseUrl + "index.html" });
  for (let i = 0; i < 30; i++) {
    const ok = await cdp.ev("typeof DEFAULT_FAMILY !== 'undefined'");
    if (ok === true) break;
    await SLEEP(150);
  }
  await cdp.ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); if (typeof saveLocal === 'function') saveLocal('intro_'+WEEK, 1); true`);
  await cdp.send("Page.navigate", { url: baseUrl + "index.html" });
  for (let i = 0; i < 30; i++) {
    const ok = await cdp.ev("typeof DEFAULT_FAMILY !== 'undefined'");
    if (ok === true) break;
    await SLEEP(150);
  }
  await SLEEP(600);
  // Click the first kid card; then force the AM routine so we always have jobs.
  const entered = await cdp.ev(`(async()=>{ const b=document.querySelector('[data-a="kid"]'); if(!b) return false; b.click(); await new Promise(r=>setTimeout(r,500)); view.routine='am'; if (typeof render==='function') render(); return true; })()`);
  await SLEEP(500);
  return entered;
}

async function probeAll(cdp, selector) {
  return cdp.ev(`(async()=>{
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const root = document.querySelector(${JSON.stringify(selector.split('>')[0])}) || document.body;
    const els = root ? [...root.querySelectorAll(${JSON.stringify(selector)})] : [];
    if (!els.length) return [];
    // The kid view scrolls inside .main; ensure last tile is reachable by
    // programmatically scrolling its scrollable ancestor to the end and re-measuring.
    const main = document.querySelector('.main');
    const last = els[els.length - 1];
    let scrollSpent = 0;
    if (last && main) {
      // Try to bring the last tile into view.
      for (let tries = 0; tries < 30; tries++) {
        last.scrollIntoView({ block: 'end' });
        const r = last.getBoundingClientRect();
        if (r.bottom <= innerHeight + 1) break;
        // If still off-screen, also scroll .main itself.
        if (main.scrollTop + main.clientHeight < main.scrollHeight) {
          main.scrollTop = main.scrollHeight;
        }
        await sleep(40);
        scrollSpent++;
      }
    }
    const out = [];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      const vw = innerWidth, vh = innerHeight;
      const all = [...el.querySelectorAll('.em,.tx,.stars,.badges,.wait,.twist')];
      const items = all.map(n => {
        const r = n.getBoundingClientRect();
        return { cls: n.className, top: Math.round(r.top - rect.top), bot: Math.round(r.bottom - rect.top), h: Math.round(r.height), w: Math.round(r.width) };
      });
      const txEl = el.querySelector('.tx');
      const txStyle = txEl ? getComputedStyle(txEl) : null;
      function longestWordWidth(node) {
        const text = (node.textContent || '').trim();
        if (!text) return 0;
        const probe = document.createElement('span');
        const cs2 = getComputedStyle(node);
        probe.style.cssText = 'visibility:hidden;position:absolute;white-space:nowrap;left:-9999px;top:0;'
          + 'font:' + cs2.font + ';letter-spacing:' + cs2.letterSpacing + ';text-transform:' + cs2.textTransform + ';';
        document.body.appendChild(probe);
        let max = 0;
        for (const w of text.split(/\\s+/)) {
          probe.textContent = w;
          const wr = probe.getBoundingClientRect().width;
          if (wr > max) max = wr;
        }
        probe.remove();
        return max;
      }
      const txInfo = txEl ? {
        text: (txEl.textContent || '').trim(),
        rect: { w: Math.round(txEl.getBoundingClientRect().width) },
        longestWord: Math.round(longestWordWidth(txEl)),
        overflowWrap: txStyle.overflowWrap,
        wordBreak: txStyle.wordBreak
      } : null;
      const reach = { top: Math.round(rect.top), bottom: Math.round(rect.bottom), vh };
      const emTop = items.find(i => /\\bem\\b/.test(i.cls))?.top;
      const txTop = items.find(i => /\\btx\\b/.test(i.cls))?.top;
      const starsTop = items.find(i => /\\bstars\\b/.test(i.cls))?.top;
      const order = (emTop!=null && txTop!=null && starsTop!=null) ? (emTop < txTop && txTop < starsTop) : null;
      out.push({
        cls: el.className,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
        items, order, txInfo, reach
      });
    }
    return out;
  })()`);
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const port = 27100 + Math.floor(Math.random() * 200);
  const server = await startServer(root, port);
  const base = `http://127.0.0.1:${port}/`;
  let totalFails = 0;
  const log = (s) => process.stdout.write(s + "\n");
  for (const vp of VIEWPORTS) {
    const cdpPort = 28100 + Math.floor(Math.random() * 200);
    const cdp = await driveChrome(cdpPort, vp.w, vp.h);
    let fails = 0;
    try {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true });
      const entered = await prep(cdp, base);
      if (!entered) { fails++; log(`[${vp.label}] could not enter kid view`); totalFails += fails; await cdp.close(); continue; }
      // Routine tab (.screen .tiles .tile)
      const routineResults = await probeAll(cdp, ".screen .tiles > .tile");
      const rLast = routineResults[routineResults.length - 1];
      const rReachOK = rLast && rLast.reach && rLast.reach.bottom <= rLast.reach.vh + 1;
      if (!rReachOK) { fails++; log(`[${vp.label}] last routine tile NOT reachable: ${JSON.stringify(rLast && rLast.reach)}`); }
      const rMid = routineResults.filter(r => r && r.txInfo && r.txInfo.longestWord > r.txInfo.rect.w + 1).length;
      if (rMid) { fails++; log(`[${vp.label}] ${rMid} routine tile(s) split a word wider than container`); }
      const rBad = routineResults.filter(r => r && r.order === false).length;
      if (rBad) { fails++; log(`[${vp.label}] ${rBad} routine tile(s) have wrong vertical order`); }
      // Bonus tab
      await cdp.ev("(() => { const t = document.querySelector('[data-a=routine][data-r=bn]'); if (t) t.click(); })()");
      await SLEEP(500);
      const bonusResults = await probeAll(cdp, ".screen .tiles > .tile");
      const bLast = bonusResults[bonusResults.length - 1];
      const bReachOK = bLast && bLast.reach && bLast.reach.bottom <= bLast.reach.vh + 1;
      if (!bReachOK) { fails++; log(`[${vp.label}] last Bonus tile NOT reachable: ${JSON.stringify(bLast && bLast.reach)}`); }
      const bMid = bonusResults.filter(r => r && r.txInfo && r.txInfo.longestWord > r.txInfo.rect.w + 1).length;
      if (bMid) { fails++; log(`[${vp.label}] ${bMid} Bonus tile(s) split a word wider than container`); }
      const bBad = bonusResults.filter(r => r && r.order === false).length;
      if (bBad) { fails++; log(`[${vp.label}] ${bBad} Bonus tile(s) have wrong vertical order`); }
      log(`[${vp.label}] routine=${routineResults.length} (reachOK=${!!rReachOK}, midWord=${rMid}, badOrder=${rBad}) bonus=${bonusResults.length} (reachOK=${!!bReachOK}, midWord=${bMid}, badOrder=${bBad}) fails=${fails}`);
    } catch (e) {
      fails++;
      log(`[${vp.label}] EXCEPTION ${e && e.message || e}`);
    } finally {
      await cdp.close();
    }
    totalFails += fails;
  }
  try { server.close(); } catch(_){}
  log(`totalFails=${totalFails}`);
  process.exit(totalFails === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
