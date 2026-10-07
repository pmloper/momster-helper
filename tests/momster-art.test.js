// Momster portrait artwork checks.
//  1. Static: ONE momsterSvg() definition, every Momster call site reuses it, no raster/base64/external
//     art inside it, villain face + buddySvg untouched.
//  2. Browser (real Chromium via CDP, node >= 22, no deps): the SVG parses as XML, has a viewBox,
//     renders at 48/72/320 px with square non-zero boxes, and the home boss strip keeps ally + kid buttons +
//     villain button + health bar visible with no horizontal overflow at 360x640 and 412x938.
//     Screenshots go to artifacts/momster-art/ (override with MOMSTER_ART_OUT).
// Usage: node tests/momster-art.test.js   (CHROME env var overrides browser)
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const OUT = process.env.MOMSTER_ART_OUT || path.join(root, "artifacts", "momster-art");
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const log = s => process.stdout.write(s + "\n");
const check = (ok, msg) => { log((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; };

// ---- static checks ----
const defs = html.match(/function momsterSvg\s*\(/g) || [];
check(defs.length === 1, "exactly one momsterSvg() definition");
const calls = (html.match(/\$\{momsterSvg\(/g) || []).length;
check(calls === 3, `momsterSvg reused at 3 call sites (home header, wizard card, boss strip) - found ${calls}`);
check(!/\$\{buddySvg\([^)]*h_crown/.test(html), "no crowned orange buddySvg blob left as a Momster stand-in");
const start = html.indexOf("function momsterSvg");
const fn = html.slice(start, html.indexOf("</svg>`; }", start) + 10);
check(fn.length > 500, "momsterSvg body extracted");
check(!/<image|data:|base64|https?:\/\/(?!www\.w3\.org)/i.test(fn), "momsterSvg has no raster/base64/external refs");
check(/function buddySvg\(look, wear, opts\)/.test(html), "buddySvg signature unchanged");
const strip = html.slice(html.indexOf("function monsterStrip"), html.indexOf("const TAUNTS"));
check(/data-a="bossTap"/.test(strip) && /data-a="toot"/.test(strip) && /class="mbar"/.test(strip), "boss strip keeps villain button, kid buttons, health bar");
check(strip.includes('${left?m[2]:"😵"}'), "villain face (m[2]) still drawn by monsterStrip");
check(html.includes('<div class="i-face">${m[2]}'), "villain intro face untouched");
check(fs.readFileSync(path.join(root, "sw.js"), "utf8").includes("momster-helper-v76-kid-header"), "SW cache bumped");

// ---- browser checks ----
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"].find(fs.existsSync);
if (!CHROME) { log("NO BROWSER"); process.exit(2); }
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const types = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".png": "image/png" };
function startServer(port) {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]); if (p === "/") p = "/index.html";
    const full = path.join(root, p); if (!full.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (e, b) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": types[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(b);
    });
  });
  return new Promise(r => s.listen(port, "127.0.0.1", () => r(s)));
}
async function drive(cdpPort) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-art-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${dir}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(t => t.type === "page"); } catch (_) {}
    if (!target) await SLEEP(150);
  }
  if (!target) throw new Error("no browser target");
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.exceptionDetails ? { __error: JSON.stringify(r.result.exceptionDetails).slice(0, 300) } : r.result && r.result.result.value;
  };
  const shot = async (file, clip) => {
    const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, "base64"));
  };
  return { send, ev, shot, close() { try { ws.close(); } catch (_) {} try { proc.kill(); } catch (_) {} } };
}
async function load(cdp, base) {
  const nav = async () => {
    await cdp.send("Page.navigate", { url: base + "index.html" });
    for (let i = 0; i < 40; i++) { if (await cdp.ev("typeof momsterSvg==='function' && typeof DEFAULT_FAMILY!=='undefined'") === true) break; await SLEEP(150); }
  };
  await nav();
  await cdp.ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal('intro_'+WEEK, 1); true`);
  await nav(); await SLEEP(700);
}

(async () => {
  const server = await startServer(27300 + Math.floor(Math.random() * 200));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const cdp = await drive(28300 + Math.floor(Math.random() * 200));
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 700, deviceScaleFactor: 1, mobile: false });
    await load(cdp, base);
    const parse = await cdp.ev(`(()=>{ const d=new DOMParser().parseFromString(momsterSvg(),"image/svg+xml"); const r=d.documentElement; return {err:!!d.querySelector("parsererror"), tag:r.tagName, vb:r.getAttribute("viewBox"), nodes:d.querySelectorAll("*").length, ids:d.querySelectorAll("[id]").length}; })()`);
    check(parse && !parse.err && parse.tag === "svg" && parse.vb === "0 0 120 120", `SVG parses as XML, viewBox 0 0 120 120 (${JSON.stringify(parse)})`);
    check(parse && parse.ids === 0, "no id attributes (safe to repeat on one page)");
    for (const sz of [48, 72, 320]) {
      const m = await cdp.ev(`(()=>{ document.body.innerHTML='<div id=t style="padding:12px;background:#FFF3D6;display:inline-block">'+momsterSvg({attrs:'style="width:${sz}px;height:${sz}px;display:block"'})+'</div>'; const s=document.querySelector("#t svg"), r=s.getBoundingClientRect(), b=s.getBBox(); return {w:r.width,h:r.height,bw:b.width,bh:b.height}; })()`);
      check(m && m.w === sz && m.h === sz && m.bw > 90 && m.bh > 90, `renders ${sz}x${sz}px with art filling the viewBox (bbox ${m && Math.round(m.bw)}x${m && Math.round(m.bh)})`);
      await SLEEP(100); await cdp.shot(`momster-${sz}.png`, { x: 0, y: 0, width: sz + 24, height: sz + 24 });
    }
    await cdp.ev(`document.body.innerHTML='<div style="display:flex;gap:20px;align-items:flex-end;padding:16px;background:#FFF3D6">'+[48,72,320].map(s=>momsterSvg({attrs:'style="width:'+s+'px;height:'+s+'px"'})).join("")+'</div>'`);
    await SLEEP(100); await cdp.shot("momster-sizes.png", { x: 0, y: 0, width: 560, height: 360 });

    for (const vp of [{ w: 360, h: 640 }, { w: 412, h: 938 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true });
      await load(cdp, base);
      const L = await cdp.ev(`(()=>{ const q=s=>document.querySelector(s), R=e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}};
        const boss=q(".boss"), mom=q(".bmom svg"), pals=[...document.querySelectorAll(".bpal")], face=q(".bface"), bar=q(".boss .mbar"), info=q(".boss .minfo"), h1=q(".hello h1 svg[data-momster]");
        if(!boss||!mom) return null;
        return {boss:R(boss), mom:R(mom), pals:pals.map(R), face:R(face), bar:R(bar), info:R(info), h1:h1&&R(h1), helloH:R(q(".hello h1")), sw:document.documentElement.scrollWidth, iw:innerWidth, momEvents:getComputedStyle(q(".bmom")).pointerEvents}; })()`);
      const tag = `${vp.w}x${vp.h}`;
      if (!L || L.__error) { check(false, `[${tag}] boss strip rendered ${JSON.stringify(L)}`); continue; }
      check(L.sw <= L.iw, `[${tag}] no horizontal overflow (scrollWidth ${L.sw} <= ${L.iw})`);
      check(L.mom.w >= 44 && L.mom.h >= 44 && L.mom.w <= 72, `[${tag}] Momster ally ${Math.round(L.mom.w)}px (readable 48-72)`);
      check(L.boss.l >= 0 && L.boss.r <= L.iw + 0.5, `[${tag}] boss strip inside viewport (${Math.round(L.boss.l)}..${Math.round(L.boss.r)})`);
      check(L.pals.length >= 1 && L.pals.every(p => p.w > 20 && p.r <= L.iw), `[${tag}] ${L.pals.length} kid buttons present and on-screen`);
      check(L.face.w > 30 && L.face.r <= L.iw + 0.5, `[${tag}] villain button visible (${Math.round(L.face.w)}px)`);
      check(L.bar.w >= 100 && L.info.w >= 100, `[${tag}] health bar ${Math.round(L.bar.w)}px / info column ${Math.round(L.info.w)}px not squeezed`);
      const tap = await cdp.ev(`(()=>{ const b=document.querySelector('.bpal').getBoundingClientRect(); const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2); return !!(e&&e.closest('.bpal')); })()`);
      check(tap === true, `[${tag}] kid button centre still receives taps (ally overlaps but is non-interactive)`);
      check(L.h1 && L.helloH.h < 40, `[${tag}] header Momster present; header h1 height ${Math.round(L.helloH.h)}px`);
      check(L.momEvents === "none", `[${tag}] ally is non-interactive (combat taps untouched)`);
      await cdp.shot(`home-${tag}.png`);
      await cdp.shot(`boss-strip-${tag}.png`, { x: 0, y: Math.max(0, L.boss.t - 6), width: vp.w, height: L.boss.h + 12 });
      await cdp.shot(`header-${tag}.png`, { x: 0, y: 0, width: vp.w, height: Math.min(120, L.boss.t) });
      await cdp.ev("wizStart(); true"); await SLEEP(500);
      const wiz = await cdp.ev(`(()=>{ const m=[...document.querySelectorAll("svg[data-momster]")].filter(e=>e.getBoundingClientRect().width>60); const r=m[0]&&m[0].getBoundingClientRect(); const kid=document.querySelector('.fpal svg'); const kr=kid&&kid.getBoundingClientRect(); return {n:m.length, w:r&&r.width, kidW:kr&&kr.width, inView:!!r&&r.right<=innerWidth&&r.left>=0}; })()`);
      check(wiz && wiz.n === 1 && wiz.w >= wiz.kidW*1.2 && wiz.inView, `[${tag}] wizard Momster conspicuously larger than kid (Momster ${wiz&&wiz.w}px vs kid ${wiz&&wiz.kidW}px) ${JSON.stringify(wiz)}`);
      await cdp.shot(`wizard-${tag}.png`);
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await load(cdp, base);
    await cdp.ev("wizStart(); true"); await SLEEP(500);
    const desktop = await cdp.ev(`(()=>{ const m=document.querySelector('#wizSheet svg[data-momster]') || [...document.querySelectorAll('svg[data-momster]')].find(e=>e.getBoundingClientRect().width>70); const kid=document.querySelector('.fpal svg'); const mr=m&&m.getBoundingClientRect(),kr=kid&&kid.getBoundingClientRect(); return {mom:mr&&mr.width,kid:kr&&kr.width,overflow:document.documentElement.scrollWidth>innerWidth}; })()`);
    check(desktop && desktop.mom>=desktop.kid*1.2 && !desktop.overflow, `desktop wizard Momster conspicuously larger than kid without overflow ${JSON.stringify(desktop)}`);
  } catch (e) { fails++; log("EXCEPTION " + (e && e.stack || e)); }
  finally { cdp.close(); server.close(); }
  log(`artifacts: ${OUT}`);
  log(`totalFails=${fails}`);
  process.exit(fails ? 1 : 0);
})();
