// Regression: every jod tap (kid joke card, sheet "Tell me!", sheet "Tell it again")
// must read setup -> beat -> punchline. The bottom-nav Joke button still opens
// with the setup only. jodOpen is for the visual reveal (re-render of the
// punchline + change Tell-me button into Tell-it-again), NOT for audio branching.
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

  await send("Emulation.setDeviceMetricsOverride",{width:412,height:938,deviceScaleFactor:2,mobile:true});

  // Capture today's joke so we can assert exact queue order.
  const j = await (async () => {
    await send("Page.navigate", { url: URL_BASE }); await sleep(1200);
    await ev(`localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); true`);
    await send("Page.navigate", { url: URL_BASE }); await sleep(1500);
    return await ev(`JOKES[jodIndex()]`);
  })();

  // ---- Scenario 1: kid card first tap (jodOpen=false path) ----
  await boot(true);
  await ev(`document.querySelector(".screen").insertAdjacentHTML("beforeend", jokeCard()); true`);
  check(await click(".jod[data-a=jod]"), "kid joke card present and clicked (first tap)");
  let c = await calls();
  check(same(c[0], ["BJ:"+j[0],"boing","BJ:"+j[1]]), "card first tap plays setup, boing, punchline: " + JSON.stringify(c));
  check(c.length === 1, "card first tap makes exactly one play() call");

  // ---- Scenario 2: sheet "Tell it again" (jodOpen=true path) ----
  await ev(`window.__calls.length=0; true`);
  check(await click(".ov .sheet button[data-a=jod]"), "sheet 'Tell it again' present and clicked");
  c = await calls();
  check(same(c[0], ["BJ:"+j[0],"boing","BJ:"+j[1]]) && c.length === 1, "Tell it again replays setup, boing, punchline: " + JSON.stringify(c));

  // ---- Scenario 3: card second tap (after closing sheet, jodOpen was just set true) ----
  await ev(`window.__calls.length=0; true`);
  check(await click(".ov [data-a=closeOvBtn]"), "sheet close button present and clicked");
  await ev(`document.querySelector(".screen").insertAdjacentHTML("beforeend", jokeCard()); true`);
  check(await click(".jod[data-a=jod]"), "card present and clicked on second tap after closing sheet");
  c = await calls();
  check(same(c[0], ["BJ:"+j[0],"boing","BJ:"+j[1]]) && c.length === 1,
        "card second tap (after closing sheet) still plays setup, boing, punchline: " + JSON.stringify(c));

  // ---- Scenario 4: card third tap (regression: jodOpen must NOT branch) ----
  await ev(`window.__calls.length=0; true`);
  check(await click(".ov [data-a=closeOvBtn]"), "sheet close button clicked before third tap");
  await ev(`document.querySelector(".screen").insertAdjacentHTML("beforeend", jokeCard()); true`);
  check(await click(".jod[data-a=jod]"), "card present and clicked on third tap");
  c = await calls();
  check(same(c[0], ["BJ:"+j[0],"boing","BJ:"+j[1]]) && c.length === 1,
        "card third tap still plays setup, boing, punchline: " + JSON.stringify(c));

  // ---- Scenario 5: bottom-nav Joke -> setup only ----
  await boot(false);
  check(await click(".bn-btn[data-a=jokeSheet]"), "bottom-nav Joke button present and clicked");
  c = await calls();
  check(same(c, [["BJ:"+j[0]]]), "bottom-nav Joke plays only setup: " + JSON.stringify(c));

  // ---- Scenario 6: bottom-nav sheet "Tell me!" -> full joke ----
  await ev(`window.__calls.length=0; true`);
  check(await click(".ov .sheet button[data-a=jod]"), "sheet 'Tell me!' present and clicked");
  c = await calls();
  check(same(c, [["BJ:"+j[0],"boing","BJ:"+j[1]]]), "bottom-nav 'Tell me!' plays setup, boing, punchline: " + JSON.stringify(c));

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
