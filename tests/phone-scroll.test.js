// Strict regression: phone grid tiles must be reachable by finger-drag, while
// desktop mouse-wheel still scrolls. Tiles must remain tappable, and the
// 700 ms grown-up long-press must still open the sheet.
//
// Architecture: the app currently has nested scroll containers (.main and
// .tiles both have overflow-y:auto). On touch devices the inner .tiles eats
// the pan gesture before the outer .main can scroll, so tiles below the
// fold are unreachable. The fix is to make .main the sole vertical scroller.
//
// Runs against a local HTTP origin so localStorage works in Chromium.
// Usage: node tests/phone-scroll.test.js  (CHROME overrides the browser path)
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");

const CHROME = process.env.CHROME
  || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"]
       .find(fs.existsSync);
if (!CHROME) { console.error("NO BROWSER"); process.exit(2); }

const VIEWPORTS = [
  { w: 360,  h: 640,  label: "360x640",  touch: true  },
  { w: 412,  h: 938,  label: "412x938",  touch: true  },
  { w: 360,  h: 800,  label: "360x800",  touch: true  },
  { w: 1024, h: 768,  label: "1024x768", touch: false }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // Tiny local HTTP origin so localStorage and the SW work like on a real site.
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
                   .replace(/^\//, "") || "index.html";
    if (!["index.html", "sw.js", "manifest.json"].includes(name)) {
      res.writeHead(404).end(); return;
    }
    res.setHeader("Content-Type",
      name.endsWith(".html") ? "text/html"
      : name.endsWith(".js") ? "text/javascript"
      : "application/json");
    fs.createReadStream(path.join(__dirname, "..", name)).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const profileRoot = CHROME.includes("/snap/")
    ? path.join(os.homedir(), "snap/chromium/common")
    : os.tmpdir();
  const profileDir = fs.mkdtempSync(path.join(profileRoot, "mh-pgs-"));
  const browser = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=9222",
    "about:blank"
  ], { stdio: "ignore" });

  // Wait for DevTools endpoint (fixed port, matches the existing prize test).
  let endpoint;
  for (let i = 0; i < 80; i++) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
      endpoint = pages.find(x => x.type === "page")?.webSocketDebuggerUrl;
      if (endpoint) break;
    } catch {}
    await sleep(200);
  }
  if (!endpoint) {
    browser.kill();
    server.close();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
    throw new Error("Chrome DevTools did not start on 127.0.0.1:9222");
  }

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let id = 0; const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, m => m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send("Page.enable");

  const touch = async (type, x, y) => {
    await send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    });
  };
  // Real touch drag: touchStart → many touchMove → touchEnd. This is the
  // sequence a real finger produces, and the only one that triggers the
  // browser's pan/scroll-with-touch-action path on touch-emulated Chrome.
  const scrollDrag = async (x, y, dist) => {
    await touch("touchStart", x, y);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", x, y - (dist * i) / 10);
      await sleep(35);
    }
    await touch("touchEnd", x, y - dist);
    await sleep(280);
  };
  const tap = async (x, y, hold = 60) => {
    await touch("touchStart", x, y);
    await sleep(hold);
    await touch("touchEnd", x, y);
    await sleep(280);
  };

  // Geometry probe used after every navigation/scroll.
  const geomExpr = `(()=>{
    const m=document.querySelector('.main'),
          g=document.querySelector('.tiles'),
          last=g&&g.lastElementChild,
          nav=document.querySelector('.botnav');
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
    return {
      main:box(m), grid:g?box(g):null, last:last?box(last):null,
      nav:nav?box(nav):null,
      mainScrollTop:m?m.scrollTop:0, mainScrollHeight:m?m.scrollHeight:0, mainClientHeight:m?m.clientHeight:0,
      mainOverflowY:m?getComputedStyle(m).overflowY:null,
      gridScrollHeight:g?g.scrollHeight:0, gridClientHeight:g?g.clientHeight:0,
      gridOverflowY:g?getComputedStyle(g).overflowY:null,
      tileTouchAction:last?getComputedStyle(last).touchAction:null,
      bodyOverflowY:getComputedStyle(document.body).overflowY
    };
  })()`;

  const results = [];

  for (const vp of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.touch
    });
    await send("Emulation.setTouchEmulationEnabled", {
      enabled: vp.touch, maxTouchPoints: vp.touch ? 1 : 1
    });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await sleep(1100);

    for (const kind of ["routine", "bonus"]) {
      // Seed family + skip intro. Reload so the kid view is reachable.
      await ev(`(async()=>{
        localStorage.clear();
        localStorage.setItem('starjobs_family', JSON.stringify(DEFAULT_FAMILY));
        localStorage.setItem('starjobs_intro_' + new Date().toISOString().slice(0,10), '1');
        location.reload();
        return true;
      })()`);
      await sleep(1300);

      // Open the first kid.
      await ev(`document.querySelector('[data-a="kid"]')?.click(); true`);
      await sleep(900);

      // Inject long job lists so the grid actually overflows on phone.
      const setup = await ev(`(()=>{
        const tabs = document.querySelectorAll('.tab');
        if ('${kind}' === 'routine') {
          const r = ROUTINES.find(r => r.id === 'am');
          r.jobs = Array.from({length:15},(_,i)=>({id:'pg_'+i, e:'⭐', t:'Page '+i, snd:'j_dress'}));
          const tab = document.querySelector('.tab[data-r="am"]') || document.querySelector('.tab');
          if (tab) tab.click();
        } else {
          // settings is a let binding in the app; bonusJobs() reads settings.bonusJobs.
          settings.bonusJobs = Array.from({length:15},(_,i)=>({id:'pb_'+i, e:'⭐', t:'Bonus '+i, pts:2}));
          const tab = document.querySelector('.tab[data-r="bn"]') || document.querySelectorAll('.tab')[4];
          if (tab) tab.click();
        }
        layer.innerHTML = '';
        render();
        return {tabs: tabs.length, kid: view.kid, routine: view.routine};
      })()`);
      if (!setup.tabs) throw new Error(`${vp.label} ${kind}: kid view never rendered tabs (got ${JSON.stringify(setup)})`);
      await sleep(450);
      // Dismiss the new entry mission sheet before swiping underlying jobs.
      const pop = await ev(`(()=>{ const b=document.querySelector('#missionPop .mClose'); if(b){b.click();return true;} return false; })()`);
      if (pop) await sleep(300);

      const initial = await ev(geomExpr);
      if (vp.touch) {
        if (!initial.grid) throw new Error(`${vp.label} ${kind}: .tiles not rendered`);
        if (!(initial.last && initial.last.top > initial.main.top + 60)) {
          throw new Error(
            `${vp.label} ${kind}: test setup didn't overflow (last.top=${initial.last && initial.last.top}, ` +
            `main.top=${initial.main && initial.main.top}, main.scrollHeight=${initial.mainScrollHeight}, ` +
            `main.clientHeight=${initial.mainClientHeight})`
          );
        }
      }

      // Architectural assertion: the inner .tiles must NOT be a scroller.
      // If it is, the inner one eats the pan on touch devices.
      if (initial.gridOverflowY === "auto" || initial.gridOverflowY === "scroll") {
        throw new Error(
          `${vp.label} ${kind}: nested scroll trap — .tiles is itself overflow-y:${initial.gridOverflowY}`
        );
      }
      // Tiles must allow vertical pan to the outer scroller.
      if (vp.touch && initial.tileTouchAction !== "pan-y") {
        throw new Error(
          `${vp.label} ${kind}: tile touch-action is '${initial.tileTouchAction}', expected 'pan-y'`
        );
      }

      // Scroll attempt.
      let scrolled = 0, nestedTrapHit = false;
      for (let n = 0; n < 14; n++) {
        const g = await ev(geomExpr);
        const limit = g.nav ? g.nav.top : vp.h;
        if (g.last && g.last.bottom <= Math.min(limit, vp.h) + 1) break;
        // Find a tile whose visible portion contains (x, y) inside the
        // actual screen viewport. We need the touch to land on a real
        // tile pixel so the browser can route the scroll gesture to
        // the nearest scrollable ancestor (the outer .main).
        const start = await ev(`(()=>{
          const tiles=[...document.querySelectorAll('.tiles .tile')];
          // Prefer the topmost tile that has any visible area in the viewport.
          let t = tiles.find(t=>{
            const r=t.getBoundingClientRect();
            return r.bottom>0 && r.top<${vp.h} && r.left<${vp.w} && r.right>0;
          }) || tiles[0];
          let r = t.getBoundingClientRect();
          let x = Math.max(20, Math.min(${vp.w}-20, r.left + r.width/2));
          let y = Math.max(20, Math.min(${vp.h}-20, r.top + r.height/2));
          // Clamp to the visible part of the tile (in case the tile overflows the viewport).
          y = Math.max(Math.max(r.top, 8) + 4, Math.min(${vp.h}-8, y));
          // Verify elementFromPoint hits a tile; if not, walk to the next one.
          for (let i=0;i<tiles.length;i++){
            const el=document.elementFromPoint(x,y);
            if (el && el.closest && el.closest('.tile')) return {x,y};
            t = tiles[i+1] || tiles[0];
            r = t.getBoundingClientRect();
            x = Math.max(20, Math.min(${vp.w}-20, r.left + r.width/2));
            y = Math.max(Math.max(r.top, 8) + 4, Math.min(${vp.h}-8, r.top + r.height/2));
          }
          return {x,y};
        })()`);
        if (vp.touch) {
          await scrollDrag(start.x, start.y, Math.min(260, vp.h / 2.2));
        } else {
          await ev(`document.querySelector('.main').scrollTop += 280`);
          await sleep(180);
        }
        const after = await ev(geomExpr);
        if (after.gridOverflowY === "auto" || after.gridOverflowY === "scroll") {
          nestedTrapHit = true;
        }
        if (after.mainScrollTop > g.mainScrollTop + 0.5) {
          scrolled += (after.mainScrollTop - g.mainScrollTop);
        }
        if (after.mainScrollTop === g.mainScrollTop) break;
      }

      const final = await ev(geomExpr);
      const limit = final.nav ? final.nav.top : vp.h;

      if (scrolled <= 0 && initial.last && initial.last.bottom > Math.min(limit, vp.h) + 1) {
        throw new Error(
          `${vp.label} ${kind}: outer scroller never moved ` +
          `(initial top=${initial.mainScrollTop}, final top=${final.mainScrollTop}, ` +
          `last=${JSON.stringify(final.last)}, limit=${limit})`
        );
      }
      if (nestedTrapHit) {
        throw new Error(`${vp.label} ${kind}: .tiles acted as a scroller during the drag`);
      }
      if (!final.last || final.last.bottom > Math.min(limit, vp.h) + 2 || final.last.top < final.main.top - 1) {
        throw new Error(
          `${vp.label} ${kind}: last tile not fully reachable above bottom edge/nav ` +
          `(last=${JSON.stringify(final.last)}, limit=${limit})`
        );
      }

      // For routines, also assert the tap on the last tile still registers
      // and the 700 ms grown-up long-press on a done tile still opens the sheet.
      if (kind === "routine") {
        // Re-render fresh so the last tile is undones.
        await ev(`(()=>{
          const r = ROUTINES.find(r => r.id === 'am');
          r.jobs = Array.from({length:15},(_,i)=>({id:'pg2_'+i, e:'⭐', t:'Page2 '+i, snd:'j_dress'}));
          layer.innerHTML = '';
          render();
          // Scroll the last tile into view so the tap actually lands on it.
          const last = document.querySelector('.tiles .tile:last-child');
          if (last) last.scrollIntoView({block:'center'});
          return true;
        })()`);
        await sleep(400);

        const p = await ev(`(()=>{
          const r=document.querySelector('.tiles .tile:last-child').getBoundingClientRect();
          // If the last tile is still off-screen, scroll the outer main to bring it in.
          if (r.bottom > innerHeight - 8 || r.top < 8) {
            document.querySelector('.tiles .tile:last-child').scrollIntoView({block:'center'});
            const r2=document.querySelector('.tiles .tile:last-child').getBoundingClientRect();
            return {x: r2.left + r2.width/2, y: r2.top + r2.height/2};
          }
          return {x: r.left + r.width/2, y: r.top + r.height/2};
        })()`);
        if (vp.touch) {
          await tap(p.x, p.y, 60);
        } else {
          await ev(`document.querySelector('.tiles .tile:last-child').click()`);
          await sleep(200);
        }
        const lastId = "pg2_14";
        const done = await ev(`isDone('k1','${lastId}')`);
        if (!done) {
          throw new Error(`${vp.label} ${kind}: last tile tap did not register (pos ${JSON.stringify(p)})`);
        }
        if (vp.touch) {
          await ev(`document.querySelector('.tile.done[data-j="${lastId}"]').scrollIntoView({block:'center'}); true`);
          await sleep(200);
          const pt = await ev(`(()=>{const r=document.querySelector('.tile.done[data-j="${lastId}"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
          await touch("touchStart", pt.x, pt.y);
          await sleep(820);
          const probe = await ev(`({layer:layer.innerHTML.slice(0,140),fired:lpFired})`);
          await touch("touchEnd", pt.x, pt.y);
          if (!probe.layer.includes('class="sheet"') || !probe.fired) {
            throw new Error(`${vp.label} ${kind}: 700ms grown-up long-press failed (${JSON.stringify(probe)})`);
          }
        }
      }

      results.push({
        viewport: vp.label, kind,
        mainScrolled: Math.round(scrolled),
        lastBottom: Math.round(final.last ? final.last.bottom : -1),
        limit: Math.round(limit),
        gridOverflowY: final.gridOverflowY,
        tileTouchAction: final.tileTouchAction
      });
      console.log(`PASS ${vp.label} ${kind} scrolled=${Math.round(scrolled)} lastBottom=${Math.round(final.last ? final.last.bottom : -1)} limit=${Math.round(limit)}`);
    }
  }

  console.log("\n=== phone-scroll summary ===");
  for (const r of results) console.log(JSON.stringify(r));
  console.log(`\nALL ${results.length} VIEWPORT/KIND COMBOS PASSED`);

  ws.close();
  browser.kill();
  server.close();
  await sleep(300);
  try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch {}
  process.exit(0);
})().catch(e => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
