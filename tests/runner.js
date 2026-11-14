/* Browser test runner: drives a real (headless) WebKit view from the command
   line via JXA -- no node/Chrome/playwright needed on this Mac.

     tests/run.sh [name-filter]      (starts the server, then calls this file)

   Each scenario in tests/cases.js gets a brand-new WKWebView with an empty,
   non-persistent data store (fresh localStorage + IndexedDB), unless it says
   keep:true, which reuses the previous scenario's view (to test "second visit"
   behaviour). The page is served by tests/server.py with a mock Supabase. */
ObjC.import('Cocoa'); ObjC.import('WebKit');

function pump(sec){ $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(sec)); }
function readFile(path){ return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)); }

const ERR_HOOK = `window.__errs = [];
  window.addEventListener('error', e=> window.__errs.push(String(e.message) + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e=> window.__errs.push('unhandledrejection: ' + String(e.reason && e.reason.stack || e.reason)));`;

function makeView(width, height, preload){
  const cfg = $.WKWebViewConfiguration.alloc.init;
  cfg.websiteDataStore = $.WKWebsiteDataStore.nonPersistentDataStore;
  const add = src=> cfg.userContentController.addUserScript(
    $.WKUserScript.alloc.initWithSourceInjectionTimeForMainFrameOnly(src, $.WKUserScriptInjectionTimeAtDocumentStart, true));
  add(ERR_HOOK);
  if(preload) add(preload);
  const rect = $.NSMakeRect(0, 0, width, height);
  const wv = $.WKWebView.alloc.initWithFrameConfiguration(rect, cfg);
  /* a window (never shown) so layout/media queries see the real viewport size */
  const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, 0, $.NSBackingStoreBuffered, false);
  win.contentView = wv;
  return {wv, win};
}
function evalJS(wv, code, timeoutSec){
  let out, done = false;
  wv.evaluateJavaScriptCompletionHandler(code, (res, err)=>{
    out = (err && !err.isNil()) ? {err: ObjC.unwrap(err.localizedDescription) + ' ' + ObjC.unwrap(err.userInfo.objectForKey('WKJavaScriptExceptionMessage') || '')} : {val: ObjC.unwrap(res)};
    done = true;
  });
  const until = Date.now() + (timeoutSec || 20) * 1000;
  while(!done && Date.now() < until) pump(0.02);
  if(!done) return {err: 'evaluateJavaScript timed out'};
  return out;
}
function load(wv, url){
  wv.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(url)));
  const until = Date.now() + 30000;
  pump(0.1);
  while(wv.isLoading && Date.now() < until) pump(0.05);
  /* isLoading drops before late scripts settle; wait for the app's last top-level statement */
  while(Date.now() < until){
    const r = evalJS(wv, 'document.readyState === "complete"');
    if(r.val) break;
    pump(0.05);
  }
}
/* runs an async function body in the page and waits for its promise */
function runAsync(wv, src, timeoutSec){
  const token = '__r' + Math.random().toString(36).slice(2);
  const kick = evalJS(wv, `window.${token} = null; (${src})().then(v=>{ window.${token} = JSON.stringify({val: v === undefined ? null : v}); }, e=>{ window.${token} = JSON.stringify({err: String(e && e.stack || e)}); }); 0`);
  if(kick.err) return kick;
  const until = Date.now() + (timeoutSec || 60) * 1000;
  while(Date.now() < until){
    const r = evalJS(wv, `window.${token}`);
    if(r.err) return r;
    if(r.val) return JSON.parse(r.val);
    pump(0.05);
  }
  return {err: 'timed out after ' + (timeoutSec || 60) + 's'};
}

/* One process per scenario group (a scenario plus any keep:true ones after it):
   JXA's Objective-C bridge double-frees now and then when many web views are
   created and released in one process, so tests/run.sh calls this once per
   group.   runner.js <port> list   -> group start indices, one per line
            runner.js <port> <i>    -> run group i, print its result lines */
const KEEPALIVE = []; /* never let the bridge release a view or handler mid-run */
function run(argv){
  const port = argv[0], which = argv[1];
  const base = 'http://127.0.0.1:' + port;
  const dir = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('TESTS_DIR'));
  const casesSrc = readFile(dir + '/cases.js');
  const scenarios = eval(casesSrc + '\n;SCENARIOS');
  if(which === 'list') return scenarios.map((sc, i)=> sc.keep ? null : i + '\t' + sc.name).filter(x=> x !== null).join('\n');
  let view = null;
  const lines = [];
  for(let i = +which; i < scenarios.length && (i === +which || scenarios[i].keep); i++){
    const sc = scenarios[i];
    if(!view){
      view = makeView(sc.width || 1200, sc.height || 900, sc.preload); KEEPALIVE.push(view);
      load(view.wv, base + '/__test/ctl?reset=1');
    }
    const t0 = Date.now();
    load(view.wv, base + '/' + (sc.url || '?hh=nicholas-tyler'));
    evalJS(view.wv, casesSrc + '\n;0');
    const r = runAsync(view.wv, `async ()=>{ const T = makeT(); await ({ ${sc.test.toString()} }).test(T); return {fails: T.fails, checks: T.checks, notes: T.notes, errs: window.__errs}; }`, sc.timeout || 90);
    const ms = Date.now() - t0;
    let problems = [];
    if(r.err) problems.push('threw: ' + r.err);
    else {
      problems = r.val.fails.slice();
      if(r.val.errs.length) problems.push('page errors: ' + r.val.errs.join(' | '));
    }
    if(problems.length){ lines.push(`FAIL  ${sc.name}  (${ms}ms)`); problems.forEach(p=> lines.push('        ' + p)); }
    else lines.push(`ok    ${sc.name}  (${r.val.checks} checks, ${ms}ms)`);
    if(r.val && r.val.notes.length) r.val.notes.forEach(n=> lines.push('        · ' + n));
  }
  return lines.join('\n');
}
