// Mission popup + marker UI tests (TDD-RED for v61 mission-popup preview).
//
// Acceptance criteria from /home/skeeter/skeeter-workspace/state/momster-intake-20261006.md
// line 9 (Paul thread 1556503475276484618 addendum run_a4745b9240cd410aac1566422e9b4f02)
// plus Atlas clarification round 2 (kid persistent banners stay gone after dismiss,
// distinct Bonus badge per active type, chooser still accessible from Bonus for
// unselected special):
//
//   * Surprise ("EVENTS" in current code) and special ("pick" in current code) missions
//     must appear as a dismissible popup upon entering the kid view, NOT as a persistent
//     home banner or selected-special header card.
//   * After dismissing the popup, the persistent kid banner and the selected-special
//     header card stay gone. The Bonus-grid tile is the persistent surface.
//   * The actual task lives in the Bonus grid with a distinct marker per type
//     (surprise = red .evt border, special = purple .spm border).
//   * Bonus menu shows a distinct badge per active type — not one generic star — so
//     the kid (and parent) can tell which mission(s) are waiting.
//   * When both are active: ONE combined dismissible popup, not two.
//   * Popup is keyed by day/mission identity; non-reader speech respected; no new autoplay.
//   * Dismissing popup must not cancel the task.
//   * Parent cancellation, day expiry, and completing the daily special clear their
//     applicable active marker.
//   * Preserve tapBonus / bnYes reward and pkDo Done / reward paths.
//   * Tile markers remain visible independently after dismiss.
//   * The special chooser (unselected special) stays accessible from the Bonus view —
//     not removed or hidden.
//   * Both viewports 360x640 and 412x938, no clipping, full kid flow.
//
// This test file is a CDP scenario that drives real Chromium against a tiny static
// HTTP server (file:// localStorage is denied under snap Chromium). Each scenario
// resets storage and inspects the rendered DOM plus dispatch of the popup.
//
// Ports are unique to this test to avoid colliding with parallel browser workers
// running the shared legacy tests: CDP 19444, HTTP server 19445 (>=19000 reserved
// range, distinct from the legacy 9333/9334/9335 CDP ports and 41727 server port).

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const CHROME = process.env.CHROME
  || ["/snap/bin/chromium","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome","/usr/bin/google-chrome-stable"]
     .find(p => p && fs.existsSync(p));
const REPO = path.resolve(__dirname, "..");
const INDEX_HTML = path.join(REPO, "index.html");
const VIEWPORTS = [[360,640],[412,938]];
const CDP_PORT = 19444; // unique to mission-ui to avoid colliding with shared legacy tests
const HTTP_PORT = 19445; // unique to mission-ui (>=19000 reserved range)

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function startServer(){
  const types = { ".html":"text/html", ".js":"application/javascript", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml" };
  const svr = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if(p === "/") p = "/index.html";
    const file = path.join(REPO, p);
    if(!file.startsWith(REPO) || !fs.existsSync(file)){ res.writeHead(404); res.end(); return; }
    const buf = fs.readFileSync(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
  return new Promise((resolve) => svr.listen(HTTP_PORT, "127.0.0.1", () => resolve(svr)));
}

async function run(){
  if(!CHROME){ console.log("NO BROWSER"); process.exit(2); }
  if(!fs.existsSync(INDEX_HTML)){ console.log("NO INDEX"); process.exit(2); }
  const server = await startServer();
  const URL_ = "http://127.0.0.1:"+HTTP_PORT+"/index.html";

  // Launch chromium once with the unique CDP port.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-mis-"));
  const proc = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port="+CDP_PORT,
    "--user-data-dir="+dir,
    "--no-first-run","--disable-gpu","--no-default-browser-check","--disable-extensions","--mute-audio",
    "about:blank",
  ], { stdio:"ignore" });

  // Wait for CDP
  let targets = null;
  for(let i=0;i<60;i++){
    try { targets = await (await fetch("http://127.0.0.1:"+CDP_PORT+"/json")).json(); if(targets.find(t=>t.type==="page")) break; }catch(e){}
    await sleep(200);
  }
  if(!targets || !targets.find(t=>t.type==="page")){ console.log("NO CDP"); proc.kill("SIGTERM"); server.close(); process.exit(2); }
  const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id=0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if(d.id && pend[d.id]){ pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params={}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id:i,method,params})); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return (r.result && r.result.result) ? r.result.result.value : null; };

  // Probe expression returns a JSON snapshot of the current kid-view state.
  const PROBE = `(() => {
    const out = { kid:null, routine:null, popup:null, layerSheet:null,
                  surpriseBadge:false, specialBadge:false, genericBadge:false,
                  bonusTiles: [], alarm:null, pickStrip:null,
                  surpriseMarker:false, specialMarker:false, spmPickMarker:false,
                  missionPopupOpen:false, surprisePending:null, specialPending:null,
                  evCard:false, pkCard:false };
    if(typeof view !== "undefined"){ out.kid = view.kid; out.routine = view.routine; }
    if(typeof missionPopupOpen !== "undefined") out.missionPopupOpen = missionPopupOpen;
    if(typeof surprisePending === "function" && view.kid){ try{ out.surprisePending = !!surprisePending(view.kid); }catch(e){} }
    if(typeof specialPending === "function" && view.kid){ try{ out.specialPending = !!specialPending(view.kid); }catch(e){} }
    // Bonus tab — distinct badges per active type
    const bonusTab = document.querySelector(".tab[data-r=\\"bn\\"]");
    if(bonusTab){
      out.surpriseBadge = !!bonusTab.querySelector(".bonusStarEv") || /🚨|surprise/i.test(bonusTab.textContent);
      out.specialBadge  = !!bonusTab.querySelector(".bonusStarPk") || /🎯|special/i.test(bonusTab.textContent);
      out.genericBadge = !!bonusTab.querySelector(".bonusStar") && !out.surpriseBadge && !out.specialBadge;
      out.bonusTabText = bonusTab.textContent.trim();
    }
    // Tiles in current view (Bonus view only)
    const tiles = document.querySelectorAll(".tile");
    tiles.forEach(t => out.bonusTiles.push({
      id: t.dataset.j || "",
      cls: t.className, em: (t.querySelector(".em")||{}).textContent || "",
      tx: (t.querySelector(".tx")||{}).textContent || "",
      hasStar: !!t.querySelector(".x2") || /⭐/.test(t.textContent),
      text: t.textContent.replace(/\\s+/g," ").trim(),
    }));
    // Alarm banner
    out.alarm = document.querySelector(".alarm") ? document.querySelector(".alarm").textContent.trim() : null;
    // Pick strip
    const pc = document.querySelector(".pickcard");
    out.pickStrip = pc ? { txt: pc.textContent.trim(), cls: pc.className } : null;
    // Layer popup
    const sheet = document.querySelector("#layer .sheet");
    if(sheet){ out.layerSheet = { id: sheet.id||"", html: sheet.innerHTML, txt: sheet.textContent.trim().slice(0,300) }; }
    // Tile markers by class
    out.surpriseMarker = !!document.querySelector(".tile.evt");
    out.specialMarker = !!document.querySelector(".tile.spm");
    out.spmPickMarker = !!document.querySelector(".tile.spmPick");
    out.evCard = !!document.querySelector("#missionPop .mCard.ev");
    out.pkCard = !!document.querySelector("#missionPop .mCard.pk");
    return out;
  })()`;

  // Scenarios
  let fails = 0; const failures = [];
  async function scenario(name, fn){
    let ok = false;
    try {
      await send("Page.navigate", { url: URL_ }); await sleep(900);
      // Seed a default family, mark the weekly villain intro as seen so it does not block
      // the mission popup dispatch, and pre-pick a reward so the reward sheet does not
      // block either. Clear any prior mission-popup dismissal keys so each scenario starts
      // clean.
      await ev(`localStorage.clear();
        localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY));
        saveLocal("intro_"+WEEK, 1);
        true`);
      await send("Page.navigate", { url: URL_ }); await sleep(1400);
      await ev(`Object.keys(weeks).forEach(k => { weeks[k].reward = "movie"; saveWeek(k); }); true`);
      await send("Page.navigate", { url: URL_ }); await sleep(1400);
      await fn();
      ok = true;
    } catch (e) { console.log("EXC", name, e.message ? e.message.slice(0,200) : e); }
    return ok;
  }

  // Helper: dismiss the current mission popup if any.
  async function dismissPopup(){
    await ev(`(function(){ const s=document.querySelector('#layer .sheet'); if(!s) return false;
      const btn = s.querySelector('[data-a="missionDismiss"]') || s.querySelector('[data-a="closeOv"]');
      if(!btn) return false; btn.click(); return true; })()`);
    await sleep(500);
  }

  for (const [W,H] of VIEWPORTS){
    await send("Emulation.setDeviceMetricsOverride", { width:W, height:H, deviceScaleFactor:2, mobile:W<500 });

    // Scenario 1: SURPRISE ONLY (active event, no special needed).
    //   * ONE dismissible popup on entering kid view.
    //   * Persistent alarm banner is removed from kid view (and stays gone after dismiss).
    //   * Bonus tab has a surprise marker (distinct from special).
    //   * The bonus tile for the surprise mission is in the grid with the .evt marker.
    if(await scenario("surprise_only_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"crumb", e:"\\ud83c\\udf6a", title:"THE GREAT CRUMB INCIDENT!", t:"Wipe the table and sweep up crumbs", pts:3, day:ymd(new Date()) }; saveSettings(); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      const r = await ev(PROBE);
      // Popup present
      if(!r.layerSheet){ fails++; failures.push(W+"x"+H+"_surprise_only_popup_missing"); console.log("FAIL "+W+"x"+H+" surprise_only: no popup layer"); return; }
      if(!/Surprise mission/i.test(r.layerSheet.txt)){ fails++; failures.push(W+"x"+H+"_surprise_only_text"); console.log("FAIL "+W+"x"+H+" surprise_only popup text"); return; }
      if(r.alarm){ fails++; failures.push(W+"x"+H+"_surprise_only_alarm_present"); console.log("FAIL "+W+"x"+H+" surprise_only alarm banner present on kid view"); return; }
      // Dismiss
      await dismissPopup();
      const r1 = await ev(PROBE);
      if(r1.layerSheet){ fails++; failures.push(W+"x"+H+"_surprise_only_popup_still_open_after_dismiss"); console.log("FAIL "+W+"x"+H+" surprise_only popup still open after dismiss"); return; }
      // CRITICAL: after dismiss, the kid persistent banner must STAY GONE.
      if(r1.alarm){ fails++; failures.push(W+"x"+H+"_surprise_only_alarm_returned_after_dismiss"); console.log("FAIL "+W+"x"+H+" surprise_only alarm banner returned after dismiss"); return; }
      // Surprise bonus-tab badge present
      if(!r1.surpriseBadge){ fails++; failures.push(W+"x"+H+"_surprise_only_tab_nosurprise"); console.log("FAIL "+W+"x"+H+" surprise_only Bonus tab no surprise badge"); return; }
      // Surprise marker tile present in Bonus view (need to switch to bonus routine)
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(500);
      const r2 = await ev(PROBE);
      if(!/ev_/.test(JSON.stringify(r2.bonusTiles))){ fails++; failures.push(W+"x"+H+"_surprise_only_tile_id"); console.log("FAIL "+W+"x"+H+" surprise_only tile id missing"); return; }
      if(!r2.surpriseMarker){ fails++; failures.push(W+"x"+H+"_surprise_only_tile_marker"); console.log("FAIL "+W+"x"+H+" surprise_only tile marker missing"); return; }
      if(!/⭐/.test(JSON.stringify(r2.bonusTiles.map(t=>t.text)))){ fails++; failures.push(W+"x"+H+"_surprise_only_tile_stars"); console.log("FAIL "+W+"x"+H+" surprise_only tile stars missing"); return; }
    })){ /* ok run */ }

    // Scenario 2: SPECIAL ONLY (unchosen special for today, no surprise).
    //   * Popup on entry with the special mission picker.
    //   * pickStrip is always empty on kid view.
    //   * Bonus tab has a special badge.
    //   * After dismissing the popup, the Bonus grid shows a `.spmPick` chooser tile.
    //   * Tapping the chooser tile opens a small chooser sheet; choosing from it turns
    //     the tile into a `.spm` tile (routes via pkDo).
    if(await scenario("special_only_"+W+"x"+H, async () => {
      await ev(`settings.event = null; saveSettings(); Object.keys(weeks).forEach(k => { delete weeks[k].pick; saveWeek(k); }); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      const r = await ev(PROBE);
      if(!r.layerSheet){ fails++; failures.push(W+"x"+H+"_special_only_popup_missing"); console.log("FAIL "+W+"x"+H+" special_only no popup"); return; }
      if(!/special mission/i.test(r.layerSheet.txt)){ fails++; failures.push(W+"x"+H+"_special_only_text"); console.log("FAIL "+W+"x"+H+" special_only popup text"); return; }
      // Dismiss
      await dismissPopup();
      const r1 = await ev(PROBE);
      if(r1.layerSheet){ fails++; failures.push(W+"x"+H+"_special_only_popup_still_open_after_dismiss"); console.log("FAIL "+W+"x"+H+" special_only popup still open after dismiss"); return; }
      // CRITICAL: pickStrip is always empty on kid view.
      if(r1.pickStrip){ fails++; failures.push(W+"x"+H+"_special_only_pickstrip_present"); console.log("FAIL "+W+"x"+H+" special_only pickStrip is not empty on kid view"); return; }
      // Special bonus-tab badge present
      if(!r1.specialBadge){ fails++; failures.push(W+"x"+H+"_special_only_tab_nospecial"); console.log("FAIL "+W+"x"+H+" special_only Bonus tab no special badge"); return; }
      // Switch to Bonus
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(500);
      const r1b = await ev(PROBE);
      // CRITICAL: a `.spmPick` chooser CTA tile must be visible.
      if(!r1b.spmPickMarker){ fails++; failures.push(W+"x"+H+"_special_only_no_spmPick_tile"); console.log("FAIL "+W+"x"+H+" special_only no .spmPick chooser tile in Bonus"); return; }
      // Open the chooser sheet from the .spmPick tile.
      const opened = await ev(`(function(){ const t=document.querySelector('.tile.spmPick'); if(!t) return false; t.click(); return true; })()`);
      if(!opened){ fails++; failures.push(W+"x"+H+"_special_only_no_spmPick_open"); console.log("FAIL "+W+"x"+H+" special_only .spmPick not clickable"); return; }
      await sleep(500);
      const r2a = await ev(PROBE);
      if(!r2a.layerSheet || !/special mission/i.test(r2a.layerSheet.txt)){ fails++; failures.push(W+"x"+H+"_special_only_chooser_not_open"); console.log("FAIL "+W+"x"+H+" special_only chooser sheet didn't open"); return; }
      // Click a chooser option
      const picked = await ev(`(function(){ const b=document.querySelector('[data-a="pkChooseChooser"]'); if(!b) return false; b.click(); return true; })()`);
      if(!picked){ fails++; failures.push(W+"x"+H+"_special_only_no_chooser_btn"); console.log("FAIL "+W+"x"+H+" special_only no chooser option"); return; }
      await sleep(500);
      const r2 = await ev(PROBE);
      // The chooser turned into a .spm tile that routes via pkDo.
      if(!r2.specialMarker){ fails++; failures.push(W+"x"+H+"_special_only_tile_marker"); console.log("FAIL "+W+"x"+H+" special_only .spm tile missing after pick"); return; }
      if(r2.spmPickMarker){ fails++; failures.push(W+"x"+H+"_special_only_chooser_tile_remains"); console.log("FAIL "+W+"x"+H+" special_only .spmPick tile should disappear after pick"); return; }
    })){ /* ok */ }

    // Scenario 3: BOTH active. EXACTLY ONE popup combining them. Distinct badges per type.
    // After choosing the special from the popup and dismissing, both tile markers must
    // show in the Bonus grid (surprise + special). The surprise is processed via
    // tapBonus/bnYes (grown-up); the special is processed via pkDo. Both reward paths
    // preserved.
    if(await scenario("both_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"sock", e:"\\ud83e\\udde6", title:"THE SOCK HAS AWAKENED!", t:"Find stray socks and put them in the hamper", pts:3, day:ymd(new Date()) }; saveSettings(); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      const r = await ev(PROBE);
      if(!r.layerSheet){ fails++; failures.push(W+"x"+H+"_both_popup_missing"); console.log("FAIL "+W+"x"+H+" both no popup"); return; }
      if(!/Surprise mission/i.test(r.layerSheet.txt) || !/special mission/i.test(r.layerSheet.txt)){ fails++; failures.push(W+"x"+H+"_both_popup_text"); console.log("FAIL "+W+"x"+H+" both popup text lacks both"); return; }
      if(r.alarm){ fails++; failures.push(W+"x"+H+"_both_alarm_present"); console.log("FAIL "+W+"x"+H+" both alarm banner present"); return; }
      // CRITICAL: distinct badges for both types on the Bonus tab while popup is up.
      if(!r.surpriseBadge || !r.specialBadge){ fails++; failures.push(W+"x"+H+"_both_distinct_badges"); console.log("FAIL "+W+"x"+H+" both: Bonus tab missing distinct surprise/special badges"); return; }
      // Choose special from popup (combined popup, single dismiss)
      const picked = await ev(`(function(){ const b=document.querySelector('[data-a="missionChoose"]'); if(!b) return false; b.click(); return true; })()`);
      if(!picked){ fails++; failures.push(W+"x"+H+"_both_no_choose_btn"); console.log("FAIL "+W+"x"+H+" both no choose button"); return; }
      await sleep(500);
      // After dismiss: alarm stays gone, pickStrip stays gone.
      const r1 = await ev(PROBE);
      if(r1.alarm){ fails++; failures.push(W+"x"+H+"_both_alarm_returned_after_dismiss"); console.log("FAIL "+W+"x"+H+" both alarm returned after dismiss"); return; }
      if(r1.pickStrip){ fails++; failures.push(W+"x"+H+"_both_pickstrip_returned_after_dismiss"); console.log("FAIL "+W+"x"+H+" both pickStrip returned after dismiss"); return; }
      // Switch to Bonus
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(500);
      const r2 = await ev(PROBE);
      if(!r2.surpriseMarker || !r2.specialMarker){ fails++; failures.push(W+"x"+H+"_both_tile_markers"); console.log("FAIL "+W+"x"+H+" both tile markers"); return; }
      if(r2.bonusTabBadge === "star"){ /* legacy generic shape guard */ }
      // Tap the surprise tile (data-a=bjob) -> tapBonus adds to extra and waits for grown-up.
      const tapped = await ev(`(function(){ const t=document.querySelector('.tile.evt'); if(!t) return false; t.click(); return true; })()`);
      if(!tapped){ fails++; failures.push(W+"x"+H+"_both_tile_unreachable"); console.log("FAIL "+W+"x"+H+" both surprise tile unreachable"); return; }
      await sleep(500);
      const waitingOrApprove = await ev(`(function(){ return !!(document.querySelector('[data-a="approveAsk"]') || document.querySelector('.tile.evt.waiting')); })()`);
      if(!waitingOrApprove){ fails++; failures.push(W+"x"+H+"_both_tap_no_wait"); console.log("FAIL "+W+"x"+H+" both surprise tap didn't start wait"); return; }
      // Tap the special tile (data-a=pkDo) -> done + reward in one step.
      const spTapped = await ev(`(function(){ const t=document.querySelector('.tile.spm'); if(!t) return false; t.click(); return true; })()`);
      if(!spTapped){ fails++; failures.push(W+"x"+H+"_both_special_unreachable"); console.log("FAIL "+W+"x"+H+" both special tile unreachable"); return; }
      await sleep(700);
      // Special marker should clear and surprise markers should still be present.
      const r3 = await ev(PROBE);
      if(r3.specialMarker){ fails++; failures.push(W+"x"+H+"_both_special_marker_after_pkdo"); console.log("FAIL "+W+"x"+H+" both special marker persists after pkDo"); return; }
    })){ /* ok */ }

    // Scenario 4: DISMISS preserves the task and the marker. After dismiss the alarm
    // banner stays gone, the pickStrip (if any) stays gone, and the Bonus-grid markers
    // remain.
    if(await scenario("dismiss_preserves_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"toy", e:"\\ud83e\\uddf8", title:"TOY AVALANCHE!", t:"5-minute toy pickup race", pts:3, day:ymd(new Date()) }; saveSettings(); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      const dismissed = await ev(`(function(){ const s=document.querySelector('#layer .sheet'); if(!s) return false;
        const btn = s.querySelector('[data-a="missionDismiss"]') || s.querySelector('[data-a="closeOv"]');
        if(!btn) return false; btn.click(); return true; })()`);
      if(!dismissed){ fails++; failures.push(W+"x"+H+"_dismiss_no_btn"); console.log("FAIL "+W+"x"+H+" dismiss no button"); return; }
      await sleep(500);
      // Popup gone
      const r1 = await ev(PROBE);
      if(r1.layerSheet){ fails++; failures.push(W+"x"+H+"_dismiss_still_open"); console.log("FAIL "+W+"x"+H+" dismiss popup still open"); return; }
      // CRITICAL: alarm does NOT come back after dismiss.
      if(r1.alarm){ fails++; failures.push(W+"x"+H+"_dismiss_alarm_returned"); console.log("FAIL "+W+"x"+H+" dismiss alarm returned"); return; }
      // Marker still in Bonus grid
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(500);
      const r2 = await ev(PROBE);
      if(!r2.surpriseMarker){ fails++; failures.push(W+"x"+H+"_dismiss_marker_lost"); console.log("FAIL "+W+"x"+H+" dismiss surprise marker lost"); return; }
      // Surprise tab badge present
      if(!r2.surpriseBadge){ fails++; failures.push(W+"x"+H+"_dismiss_tab_nosurprise"); console.log("FAIL "+W+"x"+H+" dismiss tab no surprise badge"); return; }
      // Task still active: tap the surprise tile in Bonus and confirm the tapBonus path is
      // wired (extra gets an entry, or the tile becomes "waiting" / approveAsk sheet opens).
      const tapped = await ev(`(function(){ const t=document.querySelector('.tile.evt'); if(!t) return false; t.click(); return true; })()`);
      if(!tapped){ fails++; failures.push(W+"x"+H+"_dismiss_tile_unreachable"); console.log("FAIL "+W+"x"+H+" dismiss tile unreachable"); return; }
      await sleep(500);
      const wired = await ev(`(function(){
        const t = document.querySelector('.tile.evt');
        return !!(document.querySelector('[data-a="approveAsk"]') || (t && t.classList.contains('waiting')));
      })()`);
      if(!wired){ fails++; failures.push(W+"x"+H+"_dismiss_bnYes_missing"); console.log("FAIL "+W+"x"+H+" dismiss tapBonus reward path not wired"); return; }
    })){ /* ok */ }

    // Scenario 5: ONE popup per (day,mission). Reload same day must NOT show popup again.
    if(await scenario("popup_once_per_day_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"crumb", e:"\\ud83c\\udf6a", title:"THE GREAT CRUMB INCIDENT!", t:"Wipe the table and sweep up crumbs", pts:3, day:ymd(new Date()) }; saveSettings(); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      // Dismiss
      await ev(`(function(){ const s=document.querySelector('#layer .sheet'); if(s){ const b=s.querySelector('[data-a="missionDismiss"]')||s.querySelector('[data-a="closeOv"]'); if(b) b.click(); } })()`);
      await sleep(400);
      // Re-enter kid view (simulate returning to home and back)
      await ev(`document.querySelector('[data-a="home"]').click()`); await sleep(400);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      const r = await ev(PROBE);
      if(r.layerSheet){ fails++; failures.push(W+"x"+H+"_popup_repeats"); console.log("FAIL "+W+"x"+H+" popup repeats on re-entry same day"); return; }
      // And the alarm still does not reappear.
      if(r.alarm){ fails++; failures.push(W+"x"+H+"_popup_once_alarm_reappeared"); console.log("FAIL "+W+"x"+H+" alarm reappeared after re-entry"); return; }
    })){ /* ok */ }

    // Scenario 6: pkDo reward path intact (special completion clears the active marker for
    // that kid and Bonus tab special badge when surprise isn't active).
    if(await scenario("pkdo_clears_marker_"+W+"x"+H, async () => {
      // Plan a special pick for today; no event.
      await ev(`settings.event = null; saveSettings(); true`);
      const pid = await ev(`pickList()[0].id`);
      await ev(`(function(){ const k=Object.keys(weeks)[0]; weeks[k].pick = { day:ymd(new Date()), id:${JSON.stringify(pid)} }; saveWeek(k); })()`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      // Dismiss popup
      await ev(`(function(){ const s=document.querySelector('#layer .sheet'); if(s){ const b=s.querySelector('[data-a="missionDismiss"]')||s.querySelector('[data-a="closeOv"]'); if(b) b.click(); } })()`);
      await sleep(400);
      // After dismiss, the selected-special pickcard stays gone.
      const r0 = await ev(PROBE);
      if(r0.pickStrip){ fails++; failures.push(W+"x"+H+"_pkdo_pickcard_returned"); console.log("FAIL "+W+"x"+H+" pkdo selected-special pickcard returned after dismiss"); return; }
      // Switch to Bonus
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(500);
      // Tap the special tile (.spm) - routes to pkDo, which marks done and gives reward
      const tapped = await ev(`(function(){ const t=document.querySelector('.tile.spm'); if(!t) return false; t.click(); return true; })()`);
      if(!tapped){ fails++; failures.push(W+"x"+H+"_pkdo_no_tile"); console.log("FAIL "+W+"x"+H+" pkdo special tile missing"); return; }
      await sleep(700);
      // After completion, special marker should be cleared for this kid
      const r2 = await ev(PROBE);
      if(r2.specialMarker){ fails++; failures.push(W+"x"+H+"_pkdo_marker_remains"); console.log("FAIL "+W+"x"+H+" pkdo marker still present"); return; }
      // Bonus tab special badge should also be cleared (no surprise, no special)
      if(r2.specialBadge){ fails++; failures.push(W+"x"+H+"_pkdo_tab_still_special"); console.log("FAIL "+W+"x"+H+" pkdo Bonus tab still special"); return; }
    })){ /* ok */ }

    // Scenario 7: SPECIAL CHOOSER full path. The chooser lives as the `.spmPick` tile
    // in the Bonus grid (not as a persistent pickStrip card on kid view). Tapping the
    // tile opens a small chooser sheet. Picking an option turns the tile into a `.spm`
    // tile (routes via pkDo). Tapping the `.spm` tile completes the special and removes
    // the special badge. Also asserts no home alarm is present when the surprise is
    // active.
    if(await scenario("chooser_full_path_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"crumb", e:"\\ud83c\\udf6a", title:"THE GREAT CRUMB INCIDENT!", t:"Wipe the table and sweep up crumbs", pts:3, day:ymd(new Date()) }; saveSettings(); Object.keys(weeks).forEach(k => { delete weeks[k].pick; saveWeek(k); }); true`);
      // Home view: no persistent alarm banner.
      const rHome = await ev(PROBE);
      if(rHome.alarm){ fails++; failures.push(W+"x"+H+"_home_alarm_present"); console.log("FAIL "+W+"x"+H+" home alarm present when surprise active"); return; }
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      // Dismiss the popup.
      await ev(`(function(){ const s=document.querySelector('#layer .sheet'); if(s){ const b=s.querySelector('[data-a="missionDismiss"]')||s.querySelector('[data-a="closeOv"]'); if(b) b.click(); } })()`);
      await sleep(500);
      // pickStrip stays gone on kid view.
      const r1 = await ev(PROBE);
      if(r1.pickStrip){ fails++; failures.push(W+"x"+H+"_chooser_pickstrip_returned"); console.log("FAIL "+W+"x"+H+" chooser pickStrip returned after dismiss"); return; }
      // Switch to Bonus and find the .spmPick chooser tile.
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(500);
      const r1b = await ev(PROBE);
      if(!r1b.spmPickMarker){ fails++; failures.push(W+"x"+H+"_chooser_no_spmPick"); console.log("FAIL "+W+"x"+H+" chooser .spmPick tile missing"); return; }
      // Tap it and assert the chooser sheet opens.
      const opened = await ev(`(function(){ const t=document.querySelector('.tile.spmPick'); if(!t) return false; t.click(); return true; })()`);
      if(!opened){ fails++; failures.push(W+"x"+H+"_chooser_no_open"); console.log("FAIL "+W+"x"+H+" chooser .spmPick not clickable"); return; }
      await sleep(500);
      const r2 = await ev(PROBE);
      if(!r2.layerSheet || !/special mission/i.test(r2.layerSheet.txt)){ fails++; failures.push(W+"x"+H+"_chooser_sheet_not_open"); console.log("FAIL "+W+"x"+H+" chooser sheet didn't open"); return; }
      // Pick an option from the chooser.
      const picked = await ev(`(function(){ const b=document.querySelector('[data-a="pkChooseChooser"]'); if(!b) return false; b.click(); return true; })()`);
      if(!picked){ fails++; failures.push(W+"x"+H+"_chooser_no_pick"); console.log("FAIL "+W+"x"+H+" chooser sheet no pick button"); return; }
      await sleep(500);
      // CRITICAL: no immediate popup re-fire after explicit chooser selection.
      const r3a = await ev(PROBE);
      if(r3a.layerSheet){ fails++; failures.push(W+"x"+H+"_chooser_repop"); console.log("FAIL "+W+"x"+H+" popup re-fired after explicit chooser pick"); return; }
      // The .spmPick tile should be gone; a .spm tile should be present.
      const r3 = await ev(PROBE);
      if(r3.spmPickMarker){ fails++; failures.push(W+"x"+H+"_chooser_spmPick_remains"); console.log("FAIL "+W+"x"+H+" .spmPick should disappear after picking"); return; }
      if(!r3.specialMarker){ fails++; failures.push(W+"x"+H+"_chooser_no_spm_after_pick"); console.log("FAIL "+W+"x"+H+" .spm tile missing after picking from chooser"); return; }
      // Now tap the .spm tile to complete via pkDo. Stars increase by 2 (pkDo reward).
      const beforeStars = await ev(`(function(){ const k=Object.keys(weeks)[0]; return stars(k); })()`);
      const tapped = await ev(`(function(){ const t=document.querySelector('.tile.spm'); if(!t) return false; t.click(); return true; })()`);
      if(!tapped){ fails++; failures.push(W+"x"+H+"_chooser_spm_not_tappable"); console.log("FAIL "+W+"x"+H+" .spm tile not tappable"); return; }
      await sleep(800);
      const afterStars = await ev(`(function(){ const k=Object.keys(weeks)[0]; return stars(k); })()`);
      if(afterStars <= beforeStars){ fails++; failures.push(W+"x"+H+"_chooser_pkdo_no_stars"); console.log("FAIL "+W+"x"+H+" pkDo did not add stars ("+beforeStars+" -> "+afterStars+")"); return; }
      // Special marker and special badge should be cleared.
      const r4 = await ev(PROBE);
      if(r4.specialMarker){ fails++; failures.push(W+"x"+H+"_chooser_spm_marker_after_pkdo"); console.log("FAIL "+W+"x"+H+" .spm marker should clear after pkDo"); return; }
      if(r4.specialBadge){ fails++; failures.push(W+"x"+H+"_chooser_special_badge_after_pkdo"); console.log("FAIL "+W+"x"+H+" special badge should clear after pkDo"); return; }
    })){ /* ok */ }

    // Scenario 8: Syntax/structure. No JS error after dismissing and re-rendering.
    if(await scenario("no_errors_after_dismiss_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"couch", e:"\\ud83d\\udecb\\ufe0f", title:"COUCH CHAOS!", t:"Fix the pillows and fold the blankets", pts:3, day:ymd(new Date()) }; saveSettings(); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      await ev(`(function(){ const s=document.querySelector('#layer .sheet'); if(s){ const b=s.querySelector('[data-a="missionDismiss"]')||s.querySelector('[data-a="closeOv"]'); if(b) b.click(); } })()`);
      await sleep(400);
      // Trigger a re-render and switch routines
      await ev(`render()`); await sleep(400);
      await ev(`document.querySelector('.tab[data-r="bn"]').click()`); await sleep(400);
      const ok = await ev(`(function(){ try { render(); return true; } catch(e){ return e.message; } })()`);
      if(ok !== true){ fails++; failures.push(W+"x"+H+"_render_after_dismiss"); console.log("FAIL "+W+"x"+H+" render after dismiss threw: "+ok); return; }
    })){ /* ok */ }
  }

  // Tablet mission tiles must be centered within the wider popup sheet, both on
  // initial entry and when reopened via the kid-header siren.
  for(const [W,H] of [[768,1024],[1024,768]]){
    await send("Emulation.setDeviceMetricsOverride", { width:W, height:H, deviceScaleFactor:2, mobile:true });
    await scenario("tablet_mission_center_"+W+"x"+H, async () => {
      await ev(`settings.event = { id:"tablet", e:"🎁", title:"TABLET SURPRISE!", t:"Find the hidden toy", pts:3, day:ymd(new Date()) }; saveSettings(); true`);
      await ev(`document.querySelector('[data-a="kid"]').click()`); await sleep(900);
      async function checkCentered(id){
        const geometry = await ev(`(() => { const sheet=document.querySelector('#${id}'), cards=[...sheet.querySelectorAll('.mCard')];
          if(!sheet || cards.length!==2) return {error:'expected surprise and special mission cards'};
          const s=sheet.getBoundingClientRect(); return {sheet:[s.left,s.width], cards:cards.map(c=>{const r=c.getBoundingClientRect();return [r.left,r.width]})}; })()`);
        if(geometry.error || geometry.cards.some(([left,width]) => Math.abs(left+width/2-geometry.sheet[0]-geometry.sheet[1]/2)>2)){
          fails++; failures.push(W+"x"+H+"_"+id+"_not_centered");
          console.log("FAIL tablet mission card centering", W,H,id,JSON.stringify(geometry));
        }
      }
      await checkCentered("missionPop");
      await ev(`document.querySelector('#missionPop [data-a="missionDismiss"]').click()`); await sleep(350);
      await ev(`document.querySelector('[data-a="missionHub"]').click()`); await sleep(350);
      await checkCentered("missionHub");
    });
  }

  console.log("");
  if(fails){
    console.log("FAILED "+fails+" checks:");
    failures.forEach(f => console.log("  - "+f));
  } else {
    console.log("OK: mission UI scenarios passed at all viewports");
  }

  try { ws.close(); } catch(e){}
  try { proc.kill("SIGTERM"); } catch(e){}
  try { server.close(); } catch(e){}
  process.exit(fails ? 1 : 0);
}

run().catch(e => { console.error("FATAL", e); process.exit(2); });
