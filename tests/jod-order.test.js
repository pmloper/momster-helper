// Joke sequencing: opening by card or nav says setup only; Tell me says
// boing + punchline only; Tell it again says setup + boing + punchline.
// Closing by button or backdrop resets the reveal and next opening to setup.
//
// Drives a real Chromium via raw CDP (node >= 22, no deps). Tests run against
// a local HTTP origin so snap Chromium localStorage works (file:// would block).
// Usage: node tests/jod-order.test.js   (CHROME env var overrides binary)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const CHROME = process.env.CHROME || ["/usr/bin/google-chrome","/usr/bin/chromium","/snap/bin/chromium"]
  .find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(rootDir, port) {
  const types = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json" };
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
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve(server)));
}

(async () => {
  if (!CHROME) { console.log("NO BROWSER"); process.exit(2); }
  const rootDir = path.resolve(__dirname, "..");
  const server = await startServer(rootDir, 19435);
  const URL_BASE = `http://127.0.0.1:19435/index.html`;

  let fails = 0;
  const check = (cond, m) => { console.log((cond ? "OK   " : "FAIL ") + m); if (!cond) fails++; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-jod-"));
  const proc = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=19436",
    "--user-data-dir=" + dir,
    "--no-first-run",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ], { stdio: "ignore" });

  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch("http://127.0.0.1:19436/json");
      if (res.ok) {
        const j = await res.json();
        if (j && j.find(t => t.type === "page")) { targets = j; break; }
      }
    } catch (e) {}
    await sleep(200);
  }
  if (!targets) {
    try { proc.kill("SIGKILL"); } catch (e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    server.close();
    console.log("ERROR: Chrome DevTools did not start on 127.0.0.1:19436");
    process.exit(4);
  }
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const click = async sel => {
    const pt = await ev(`(()=>{ const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; el.scrollIntoView({block:"center"}); const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()`);
    if (!pt) return false;
    for (const type of ["mousePressed","mouseReleased"]) await send("Input.dispatchMouseEvent",{type,x:pt.x,y:pt.y,button:"left",clickCount:1});
    await sleep(300);
    return true;
  };
  const calls = () => ev(`window.__calls`);

  const boot = async (kid) => {
    await send("Page.navigate", { url: URL_BASE }); await sleep(1200);
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
    await send("Page.navigate", { url: URL_BASE }); await sleep(1500);
    if (kid) { await ev(`document.querySelector('[data-a="kid"]')?.click()`); await sleep(600); }
    await ev(`layer.innerHTML=""; true`); // dismiss any auto-opened intro / prize / reward sheets
    await ev(`window.__calls=[]; window.play=function(k){ window.__calls.push(k); }; true`);
  };

  const vw=process.env.VIEWPORT==='360'?360:412, vh=vw===360?640:938;
  await send("Emulation.setDeviceMetricsOverride",{width:vw,height:vh,deviceScaleFactor:2,mobile:true});

  // Capture today's joke so we can assert exact queue order.
  const j = await (async () => {
    await send("Page.navigate", { url: URL_BASE }); await sleep(1200);
    await ev(`localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
    await send("Page.navigate", { url: URL_BASE }); await sleep(1500);
    return await ev(`JOKES[jodIndex()]`);
  })();

  // Card and bottom nav are separate entry points, but both start unrevealed.
  await boot(true);
  await ev(`document.querySelector(".screen").insertAdjacentHTML("beforeend", jokeCard()); true`);
  check(await click(".jod"), "kid joke card opens sheet");
  let c = await calls();
  check(same(c, [["BJ:"+j[0]]]), "card opening says setup only: " + JSON.stringify(c));
  check(await ev(`!!document.querySelector('.ov .sheet [data-a=jodAnswer]') && !document.querySelector('.ov .ja')`), "unrevealed sheet has Tell me, no punchline");

  await ev(`window.__calls.length=0; true`);
  check(await click(".ov .sheet [data-a=jodAnswer]"), "Tell me button clicked");
  c = await calls();
  check(same(c, [["boing","BJ:"+j[1]]]), "Tell me says only beat and punchline: " + JSON.stringify(c));
  check(await ev(`!!document.querySelector('.ov .sheet [data-a=jodReplay]') && !!document.querySelector('.ov .ja')`), "replay button appears after punchline");

  await ev(`window.__calls.length=0; true`);
  check(await click(".ov .sheet [data-a=jodReplay]"), "Tell it again button clicked");
  c = await calls();
  check(same(c, [["BJ:"+j[0],"boing","BJ:"+j[1]]]), "replay says setup, beat, punchline: " + JSON.stringify(c));

  // Both close routes must reset the reveal, not only hide the overlay.
  check(await click(".ov [data-a=closeOvBtn]"), "close button clicked");
  check(await ev(`jodOpen===false && !document.querySelector('.jod strong')`), "close resets status and card");
  await ev(`document.querySelector('[data-a=home]')?.click(); window.__calls.length=0; true`);
  check(await ev(`(function(){const b=document.querySelector('.bn-btn[data-a=jokeSheet]');if(!b)return false;b.click();return true})()`), "nav reopens after close");
  c = await calls();
  check(same(c, [["BJ:"+j[0]]]) && await ev(`!!document.querySelector('.ov .sheet [data-a=jodAnswer]')`), "reopen starts with setup and Tell me: " + JSON.stringify(c));
  await click(".ov .sheet [data-a=jodAnswer]");
  await ev(`window.__calls.length=0; true`);
  for (const type of ["mousePressed","mouseReleased"]) await send("Input.dispatchMouseEvent",{type,x:4,y:4,button:"left",clickCount:1});
  await sleep(300);
  check(await ev(`!document.querySelector('.ov')`), "backdrop closes sheet");
  check(await ev(`jodOpen===false`), "backdrop resets reveal");

  await boot(false);
  check(await click(".bn-btn[data-a=jokeSheet]"), "bottom-nav Joke opens sheet");
  c = await calls();
  check(same(c, [["BJ:"+j[0]]]), "bottom nav says setup only: " + JSON.stringify(c));
  await ev(`window.__calls.length=0; true`);
  check(await click(".ov .sheet [data-a=jodAnswer]"), "nav sheet Tell me clicked");
  c = await calls();
  check(same(c, [["boing","BJ:"+j[1]]]), "nav Tell me says punchline only: " + JSON.stringify(c));
  await ev(`window.__calls.length=0; true`);
  check(await click(".ov .sheet [data-a=jodReplay]"), "nav sheet Tell it again clicked");
  c = await calls();
  check(same(c, [["BJ:"+j[0],"boing","BJ:"+j[1]]]), "nav replay says full joke: " + JSON.stringify(c));

  ws.close();
  try { proc.kill("SIGTERM"); } catch (e) {}
  await sleep(200);
  try { proc.kill("SIGKILL"); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  server.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch(e => {
  // Best-effort cleanup; do not kill any chrome we did not spawn ourselves.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { server.close(); } catch (_) {}
  console.error(e);
  process.exit(3);
});
