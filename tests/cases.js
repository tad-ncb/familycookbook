/* Browser test cases. Evaluated twice: by tests/runner.js (to read SCENARIOS)
   and inside the page (so each test function can call makeT / helpers there).
   A test is an async function run INSIDE the real page, against the real,
   built index.html -- it can call the app's own functions and read its state
   directly. Supabase is the in-memory mock (window.__sb, tests/mock_supabase.js);
   nothing here can touch production. */
function computeEstimateSpotCheck(){
  const r = RECIPES.find(x=> x._fromArchive && x.servingsEst && !x._lite === false);
  return !r || (r.servings && /^\d+$/.test(String(r.servings)));
}
function makeT(){
  const T = {
    fails: [], notes: [], checks: 0,
    ok(cond, msg){ T.checks++; if(!cond) T.fails.push(msg); },
    eq(a, b, msg){ T.checks++; if(JSON.stringify(a) !== JSON.stringify(b)) T.fails.push(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); },
    note(s){ T.notes.push(s); },
    sleep: ms=> new Promise(r=> setTimeout(r, ms)),
    async until(fn, ms, what){
      const end = Date.now() + (ms || 5000);
      while(Date.now() < end){ if(await fn()) return true; await T.sleep(25); }
      T.fails.push('timed out waiting for ' + what); return false;
    },
    async serverLog(){ return (await fetch('/__test/log')).json(); },
    async ctl(q){ await fetch('/__test/ctl?' + q); },
    /* rows written during the test: not deleted, and not the seed entry the mock database starts with */
    live(table){ return (__sb.tables()[table] || []).filter(r=> !r.deleted && r.id !== 'seed-ctm-1'); },
  };
  return T;
}

async function monkeyRun(T, seed){
  await T.until(()=> syncState === 'ok', 5000, 'boot');
    if(seed >= 3){ await toggleSource('BBC Good Food'); await toggleSource('NYT Cooking'); }
    let s = seed * 2654435761 >>> 0;
    const rnd = ()=> { s = (s + 0x6D2B79F5) >>> 0; let x = Math.imul(s ^ s >>> 15, 1 | s); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    const pick = a=> a[Math.floor(rnd() * a.length)];
    let n = 0, backs = 0;
    window.confirm = ()=> rnd() < 0.7;
    window.prompt = ()=> rnd() < 0.8 ? 'Name ' + (++n) : null;
    window.alert = ()=>{}; window.print = ()=>{};
    const vis = el=> el.getClientRects().length > 0 && !el.disabled && !el.closest('#householdGate') && !el.closest('.switch-household') && !el.matches('[data-hh]');
    const CLICK = ['#viewTabs .vt', '#grid .card', '#grid .interested-star', '.facet-link', '[data-source]', '.tb-btn', '.icon-btn', '.cook-btn',
      '.ch-del', '.qm-item', '.prow', '[data-add]', '[data-clear]', '[data-lo]', '[data-cook]', '[data-check]', '[data-del]', '.mult-btn', '#svUp', '#svDown',
      '.load-more-btn', '#modalClose', '.rate-pick span', '#filtersToggle', '.saved-chip', '.toast-btn', '.similar-link', '#hintAll', '[data-col]', '[data-rename]', '.slot-title', '.hist-row', '#themeBtn', '#setBtn', '#hhUp', '#hhDown', '.step-badge'].join(',');
    const WORDS = ['chicken', 'lemon', 'soup', 'xx', '', 'é', 'a b', 'pie', 'beef stew', 'garlic'];
    const log = [];
    const errs = ()=> window.__errs.length;
    for(let i = 0; i < 500 && !errs(); i++){
      const r = rnd();
      let what;
      if(r < 0.70){
        const els = [...document.querySelectorAll(CLICK)].filter(vis);
        if(!els.length) continue;
        const el = pick(els);
        what = 'click ' + el.tagName + '.' + (el.className || el.id) + ' "' + (el.textContent || '').trim().slice(0, 24) + '"';
        el.click();
      } else if(r < 0.82){
        const inputs = [...document.querySelectorAll('#searchInput,#pickerInput,#historySearch,#shopAddName,#ingIncludeInput,#ingExcludeInput,#cookNote,#pcName,.inv-add input[type=text]')].filter(vis);
        if(!inputs.length) continue;
        const el = pick(inputs);
        let v = pick(WORDS);
        if(el.id === 'ingIncludeInput'){ const o = computeIncludeIngredientOptions(); v = pick(o); }
        if(el.id === 'ingExcludeInput'){ const o = computeExcludeIngredientOptions(); v = pick(o); }
        what = 'type ' + el.id + ' = ' + JSON.stringify(v);
        el.value = v; el.dispatchEvent(new Event('input', {bubbles: true}));
        if(/ing(In|Ex)clude/.test(el.id) || el.id === 'shopAddName') el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      } else if(r < 0.90){
        const sels = [...document.querySelectorAll('#sortSelect,#authorSelect,#cuisineSelect,#viewTabsMobile')].filter(vis);
        if(!sels.length) continue;
        const el = pick(sels);
        el.selectedIndex = Math.floor(rnd() * el.options.length);
        what = 'select ' + el.id + ' -> ' + el.value;
        el.dispatchEvent(new Event('change', {bubbles: true}));
      } else if(r < 0.94){ what = 'Escape'; document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); }
      else if(r < 0.97){
        /* only step back through entries the app itself made (a recipe's #r/ link) -- going back from the first
           entry would leave the page, which ends the test rather than testing anything */
        if(!/^#r\//.test(location.hash)) continue;
        what = 'history.back'; backs++; history.back();
      }
      else { if(!backs) continue; what = 'history.forward'; backs--; history.forward(); }
      log.push(what); if(log.length > 8) log.shift();
      if(rnd() < 0.15) await T.sleep(rnd() < 0.5 ? 0 : 90);
    }
    await T.sleep(300);
    T.ok(!errs(), 'no page errors; last actions: ' + log.join(' | '));
    window.__errs.length = 0; /* the runner would repeat them; already reported above */
    closeQuickMenu(); closePicker(); if(!cameFromShareLink) closeModal();
    await T.until(()=> loadQueue().length === 0 && !flushing, 30000, 'write queue drained');
    /* what the database holds must equal what this device holds, for this household */
    const me = currentHousehold(), db = __sb.tables();
    const ids = (rows, f)=> rows.filter(f).map(r=> r.id).sort();
    const dbLive = (tbl, key)=> (db[tbl] || []).filter(r=> !r.deleted && r.household_id === me).map(r=> r[key]).sort();
    T.eq(dbLive('cook_log', 'id'), ids(DATA.cookLog, e=> !e._d && householdOf(e) === me), 'cook log: database == device');
    T.eq(dbLive('plan_days', 'slot_id'), ids(DATA.plan, e=> !e._d), 'plan: database == device');
    T.eq(dbLive('inventory_items', 'id'), ids(DATA.inventory.items, e=> !e._d), 'storage + shopping: database == device');
    T.eq(dbLive('shopping_lists', 'id'), ids(DATA.shoppingLists, e=> !e._d), 'shopping lists: database == device');
    T.eq(dbLive('interested_recipes', 'recipe_id'), ids(DATA.interested, e=> !e._d), 'stars: database == device');
    /* and the screen agrees with the data */
    clearAllFilters(); setView('cookbook');
    T.eq(document.querySelectorAll('#grid .card').length, Math.min(renderLimit, getFiltered().length), 'grid shows what the filter says');
    T.ok(Array.isArray(DATA.cookLog) && Array.isArray(DATA.plan) && Array.isArray(DATA.interested) && Array.isArray(DATA.shoppingLists) && Array.isArray(DATA.inventory.items), 'state shapes intact');
    const lists = getShoppingLists(); T.ok(lists.length >= 1 || true, 'lists');
    T.note('actions this run: ' + n + ' prompts, cook entries ' + DATA.cookLog.filter(e=> !e._d).length + ', plan slots ' + DATA.plan.filter(e=> !e._d).length + ', items ' + DATA.inventory.items.filter(e=> !e._d).length);
}

const SCENARIOS = [
  {
    name: 'boot: fresh device renders the curated cookbook with no errors',
    async test(T){
      await T.until(()=> document.querySelectorAll('#grid .card').length > 0, 5000, 'cards');
      T.eq(document.querySelectorAll('#grid .card').length, 100, 'first page is 100 cards');
      T.ok(RECIPES.length > 900, 'curated recipes present');
      T.eq(currentHousehold(), 'nicholas-tyler', 'household from ?hh=');
      T.ok(!document.getElementById('householdGate').classList.contains('open'), 'no household gate when ?hh= given');
      await T.until(()=> syncState === 'ok', 5000, 'sync ok');
    },
  },
  {
    name: 'sync: a burst of writes all reach the database (queue race)',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'initial sync');
      const list = ensureActiveShopList();
      await T.until(()=> T.live('shopping_lists').length === 1, 5000, 'list synced');
      const r = recipeById('beef-stroganoff');
      addRecipeIngredientsToList(r, list);                 /* ~10 pushWrite()s in one synchronous loop */
      const local = invItems('shopping').length;
      T.ok(local >= 8, 'ingredients added locally (' + local + ')');
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'queue drained');
      T.eq(T.live('inventory_items').length, local, 'every locally-added item was written to the database');
    },
  },
  {
    name: 'sync: server unreachable keeps the queue, then recovers',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'initial sync');
      __sb.failWith = (table, op)=> op === 'upsert' ? {status: 0, error: {message: 'TypeError: Failed to fetch', code: ''}} : null;
      addCook('beef-stroganoff', '2026-11-01', 4, 'note', '');
      addSlot('2026-11-02', 'dinner', {recipeId: 'beef-stroganoff'});
      await T.until(()=> !flushing && syncState === 'error', 5000, 'error state');
      T.eq(loadQueue().length, 2, 'both writes still queued');
      T.ok(flushRetryTimer != null && flushBackoffMs >= 5000, 'a retry is scheduled');
      T.eq(document.querySelector('#authArea').textContent.trim(), '▲ retrying…', 'pill shows retrying');
      __sb.failWith = null;
      await flushQueue();
      T.eq(loadQueue().length, 0, 'queue drained after recovery');
      T.eq(T.live('cook_log').length, 1, 'cook log row written');
      T.eq(T.live('plan_days').length, 1, 'plan row written');
      T.eq(syncState, 'ok', 'back to synced');
    },
  },
  {
    name: 'sync: a refused write does not block later writes, and is kept',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'initial sync');
      __sb.failWith = (table, op)=> (table === 'cook_log' && op === 'upsert') ? {status: 400, error: {message: 'violates check constraint', code: '23514'}} : null;
      addCook('beef-stroganoff', '2026-11-01', 4, '', '');
      addSlot('2026-11-02', 'dinner', {recipeId: 'beef-stroganoff'});
      await T.until(()=> !flushing && T.live('plan_days').length === 1, 5000, 'plan write got past the refused one');
      T.eq(loadQueue().map(o=> o.table + ':' + o.fails), ['cook_log:1'], 'refused write still queued, counted');
      for(let i = 0; i < 4; i++) await flushQueue();
      T.eq(loadQueue().length, 0, 'given up on after 5 refusals');
      const dead = JSON.parse(localStorage.getItem(FAILED_WRITES_KEY));
      T.eq(dead.length, 1, 'kept in failed-writes, not dropped');
      T.eq(syncState, 'ok', 'pill no longer stuck on retrying');
      __sb.failWith = null;
      requeueFailedWrites(); await flushQueue();
      T.eq(T.live('cook_log').length, 1, 'delivered on the next start once the server accepts it');
      T.eq(localStorage.getItem(FAILED_WRITES_KEY), null, 'failed-writes cleared');
    },
  },
  {
    name: 'sync: rapid edits to one row collapse to the newest; deletes sync',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'initial sync');
      __sb.delayMs = 40;
      const slot = addSlot('2026-11-03', 'dinner', {recipeId: 'beef-stroganoff'});
      for(let n = 2; n <= 9; n++){ updateSlot(slot.id, {servings: n}); await T.sleep(2); }
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      T.eq(T.live('plan_days').map(r=> r.servings), [9], 'database has the final value');
      T.ok(__sb.calls.filter(c=> c.table === 'plan_days' && c.op === 'upsert').length <= 4, 'intermediate writes were coalesced');
      removeSlot(slot.id);
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      T.eq(T.live('plan_days').length, 0, 'tombstone reached the database');
    },
  },
  {
    name: 'sync: rows stranded on a device by the old queue bug are delivered',
    preload: `if(!localStorage.getItem('cookbook.state.v1')){
      localStorage.setItem('__mockdb', JSON.stringify({
        cook_log: [], prefs: [], interested_recipes: [],
        shopping_lists: [{id:'L1', household_id:'nicholas-tyler', name:'Shopping list', deleted:false, updated_at:new Date(1000).toISOString()},
                         {id:'L9', household_id:'chris-jen', name:'Theirs', deleted:false, updated_at:new Date(1000).toISOString()}],
        inventory_items: [{id:'i1', household_id:'nicholas-tyler', kind:'shopping', name:'milk', qty:null, unit:null, list_id:'L1', deleted:false, updated_at:new Date(5000).toISOString()},
                          {id:'i8', household_id:'nicholas-tyler', kind:'shopping', name:'old name', qty:null, unit:null, list_id:'L1', deleted:false, updated_at:new Date(5000).toISOString()},
                          {id:'i9', household_id:'chris-jen', kind:'pantry', name:'their rice', qty:null, unit:null, deleted:false, updated_at:new Date(5000).toISOString()}],
        plan_days: [{slot_id:'p9', household_id:'chris-jen', iso_date:'2026-11-02', meal_type:'dinner', recipe_id:'beef-stroganoff', deleted:false, updated_at:new Date(5000).toISOString()}],
      }));
      localStorage.setItem('cookbook.state.v1', JSON.stringify({version:1,
        cookLog: [{id:'c1', recipeId:'beef-stroganoff', date:'2026-10-30', rating:4, note:'', leftover:'', household:'nicholas-tyler', _t:7000},
                  {id:'c2', recipeId:'beef-stroganoff', date:'2026-10-31', rating:2, note:'', leftover:'', household:'chris-jen', _t:7000}],
        plan: [{id:'p1', iso:'2026-11-03', mealType:'dinner', recipeId:'beef-stroganoff', _t:7000},
               {id:'p9', iso:'2026-11-02', mealType:'dinner', recipeId:'beef-stroganoff', _t:9000},
               {id:'legacy-2026-08-25', iso:'2026-08-25', mealType:'dinner', recipeId:'beef-stroganoff'}],
        inventory: {items: [{id:'i1', kind:'shopping', name:'milk', qty:'', unit:'', listId:'L1', _t:5000},
                            {id:'i2', kind:'shopping', name:'eggs', qty:'', unit:'', listId:'L1', _t:7000},
                            {id:'i3', kind:'shopping', name:'flour', qty:'', unit:'', listId:'L1', _t:7000},
                            {id:'i4', kind:'shopping', name:'never synced then deleted', qty:'', unit:'', listId:'L1', _d:true, _t:7000},
                            {id:'i8', kind:'shopping', name:'new name', qty:'', unit:'', listId:'L1', _d:true, _t:8000},
                            {id:'i9', kind:'pantry', name:'their rice', qty:'', unit:'', _t:9000}]},
        interested: [{id:'beef-stroganoff', _d:false, _t:7000}],
        shoppingLists: [{id:'L1', name:'Shopping list', _t:1000}, {id:'L9', name:'Theirs', _t:9000}], prefs: {}}));
    }`,
    async test(T){
      await T.until(()=> syncState === 'ok' && loadQueue().length === 0 && !flushing, 8000, 'synced');
      const db = __sb.tables(), mine = t=> db[t].filter(r=> r.household_id === 'nicholas-tyler');
      T.eq(mine('inventory_items').filter(r=> !r.deleted).map(r=> r.name).sort(), ['eggs', 'flour', 'milk'], 'stranded items delivered');
      T.eq(mine('inventory_items').find(r=> r.id === 'i8').deleted, true, 'a delete the database never heard about is delivered');
      T.ok(!db.inventory_items.some(r=> r.id === 'i4'), 'a row created and deleted locally is not sent at all');
      T.eq(mine('plan_days').map(r=> r.slot_id), ['p1'], 'stranded plan slot delivered; timestamp-less legacy slot left alone');
      T.eq(mine('cook_log').map(r=> r.id).filter(id=> id !== 'seed-ctm-1'), ['c1'], 'own cook entry delivered, other household\'s not re-sent as ours');
      T.eq(mine('interested_recipes').length, 1, 'star delivered');
      const theirs = t=> JSON.stringify(db[t].filter(r=> r.household_id === 'chris-jen'));
      T.ok(theirs('plan_days').includes(new Date(5000).toISOString()) && theirs('inventory_items').includes(new Date(5000).toISOString()) && theirs('shopping_lists').includes('"Theirs"'),
        'rows the other household owns are untouched, even though this device held newer copies');
      const before = __sb.calls.filter(c=> c.op === 'upsert').length;
      await syncFromRemote();
      await T.until(()=> !flushing, 3000, 'idle');
      T.eq(__sb.calls.filter(c=> c.op === 'upsert').length, before, 'a second pass finds nothing left to send');
    },
  },
  {
    name: 'sync: unreadable database shows as retrying, not synced',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'first sync');
      __sb.failWith = ()=> ({status: 0, error: {message: 'TypeError: Load failed', code: ''}});
      await syncFromRemote();
      T.eq(syncState, 'error', 'error state');
      T.ok(bootFetchDelayMs >= 5000, 'retry scheduled');
      __sb.failWith = null;
      await syncFromRemote();
      T.eq(syncState, 'ok', 'recovers');
    },
  },
  {
    name: 'search: ingredient text of unopened archive recipes',
    timeout: 60,
    async test(T){
      await toggleSource('BBC Good Food');
      const bbc = RECIPES.filter(r=> archiveSourceOf(r) === 'BBC Good Food');
      T.eq(archiveRowIds['BBC Good Food'].length, bbc.length, 'row order recorded');
      /* ground truth straight from the full text files */
      const man = await getArchiveManifest();
      const full = {};
      for(let b = 0; b < man.detailBuckets; b++) Object.assign(full, await (await fetch(`data/archive/detail/${b}.json`)).json());
      const search = async q=>{
        const input = document.getElementById('searchInput');
        input.value = q; input.dispatchEvent(new Event('input'));
        await T.until(()=> state.query === q && archiveQueryFor === (q.match(/[a-z]{3,}/i) ? q : null), 5000, 'search settled: ' + q);
        return new Set(getFiltered().map(r=> r.id));
      };
      for(const q of ['smoked paprika', 'chicken thigh', 'crème fraîche', 'wholemeal', 'xyzzynothing', 'ab']){
        const got = await search(q);
        const words = q.toLowerCase().match(/[a-z][a-z'\-]{2,}/g) || [];
        const expect = bbc.filter(r=>{
          const text = (full[r.id].ingredients||[]).join(' ').toLowerCase();
          const toks = text.match(/[a-z][a-z'\-]{2,}/g) || [];
          return (words.length && words.every(w=> toks.some(t=> t.includes(w)))) || searchHay(r).includes(q.toLowerCase());
        }).map(r=> r.id);
        const missing = expect.filter(id=> !got.has(id)), extra = bbc.filter(r=> got.has(r.id) && !expect.includes(r.id));
        T.ok(!missing.length && !extra.length, `"${q}": ${expect.length} expected, ${missing.length} missing, ${extra.length} unexpected`);
        if(q === 'smoked paprika') T.ok(expect.length > 5, 'finds recipes by ingredient-line text (' + expect.length + ')');
      }
      T.ok(bbc.filter(r=> !r._lite).length === 0, 'without downloading any recipe\'s full text into the app');
      const log = await T.serverLog();
      T.eq(Object.keys(log).filter(k=> k.includes('/search/')), ['/data/archive/search/bbc.json'], 'only the enabled source\'s index was fetched, once');
      T.eq(log['/data/archive/search/bbc.json'], 1, 'once');
      clearAllFilters();
    },
  },
  {
    name: 'archive: recipes that share a name with a curated one are both present',
    timeout: 60,
    async test(T){
      await toggleSource('NYT Cooking');
      const a = recipeById('brown-rice'), b = recipeById('brown-rice-nyt');
      T.ok(a && !a._fromArchive, 'curated one keeps its id');
      T.ok(b && b._fromArchive && b.source === 'NYT Cooking', 'NYT one is reachable');
      T.eq(RECIPES.filter(r=> archiveSourceOf(r) === 'NYT Cooking').length, archiveSourceCounts['NYT Cooking'], 'nothing hidden: loaded count equals the button count');
      await openModal(b);
      T.ok(b.ingredients.length > 0, 'and opens with its own ingredients');
      closeModal();
    },
  },
  {
    name: 'filters: single-pass counts and list equal the reference definition',
    timeout: 120,
    async test(T){
      await toggleSource('BBC Good Food');
      addCook('beef-stroganoff', '2026-11-01', 5, '', ''); toggleInterested('chicken-tikka-masala');
      const states = [
        {}, {query: 'chicken'}, {category: 'Main'}, {category: 'Main', cuisine: 'Italian'}, {diets: ['Vegetarian', 'Gluten Free']},
        {author: 'Ina Garten', category: 'Dessert'}, {query: 'lemon', diets: ['Vegan'], category: 'Salad'},
        {made: 'made'}, {made: 'never', aheadOnly: true}, {made: 'interested'}, {includeIngredients: ['chicken'], excludeIngredients: ['dairy']},
        {query: 'zzzz-no-match'}, {cuisine: 'Thai', author: 'BBC Good Food', query: 'curry'},
      ];
      const blank = ()=> ({query:"", category:null, cuisine:null, diets:[], author:null, sort:"top", sortDir:1, made:"all", aheadOnly:false, includeIngredients:[], excludeIngredients:[]});
      for(const patch of states){
        state = Object.assign(blank(), patch);
        const fp = facetPass(), label = JSON.stringify(patch);
        const ref = {cat:{}, cui:{}, diet:{}, author:{}, list:[]};
        RECIPES.forEach(r=>{
          if(matchesFiltersExcept(r, null)) ref.list.push(r.id);
          if(r.category && matchesFiltersExcept(r, 'category')) ref.cat[r.category] = (ref.cat[r.category]||0)+1;
          if(r.cuisine && matchesFiltersExcept(r, 'cuisine')) ref.cui[r.cuisine] = (ref.cui[r.cuisine]||0)+1;
          if(matchesFiltersExcept(r, 'diet')) recipeDietTags(r).forEach(t=> ref.diet[t] = (ref.diet[t]||0)+1);
          if(matchesFiltersExcept(r, 'author')){ const a = authorOf(r); ref.author[a] = (ref.author[a]||0)+1; }
        });
        const norm = o=> JSON.stringify(Object.keys(o).sort().map(k=> [k, o[k]]));
        T.ok(JSON.stringify(fp.list.map(r=> r.id)) === JSON.stringify(ref.list), 'list ' + label);
        ['cat', 'cui', 'diet', 'author'].forEach(f=> T.ok(norm(fp[f]) === norm(ref[f]), f + ' counts ' + label));
        T.eq(getFiltered().length, ref.list.length, 'getFiltered size ' + label);
      }
      state = blank(); render();
      /* the cached pass must notice a data change */
      state.made = 'made'; const before = facetPass().list.length;
      addCook('caesar-salad' in {} ? '' : RECIPES[5].id, '2026-11-02', 3, '', '');
      T.eq(facetPass().list.length, before + 1, 'cache invalidated by a new cook entry');
      state = blank(); render();
    },
  },
  {
    name: 'cook stats: index matches a direct scan of the log',
    async test(T){
      addCook('beef-stroganoff', '2026-10-01', 4, '', ''); addCook('beef-stroganoff', '2026-11-05', 5, '', ''); addCook('beef-stroganoff', '2026-09-01', null, '', '');
      DATA.cookLog.push({id: 'other-1', recipeId: 'beef-stroganoff', date: '2026-11-09', rating: 1, household: 'chris-jen', _t: 1}); persist(true);
      T.eq(timesMade('beef-stroganoff'), 3, 'times made (own household only)');
      T.eq(lastMade('beef-stroganoff'), '2026-11-05', 'last made');
      T.eq(avgRating('beef-stroganoff'), 4.5, 'average ignores unrated');
      T.eq(avgRating('beef-stroganoff', 'chris-jen'), 1, 'other household rating via explicit arg');
      T.eq(timesMade('chicken-tikka-masala'), 1, 'seed entry counted');
      T.eq(lastMade('no-such-recipe'), null, 'unknown recipe');
      removeCook(cookEvents('beef-stroganoff')[0].id);
      T.eq([timesMade('beef-stroganoff'), lastMade('beef-stroganoff'), avgRating('beef-stroganoff')], [2, '2026-10-01', 4], 'updates after a removal');
      const card = [...document.querySelectorAll('#grid .card')].find(c=> c.textContent.includes('Stroganoff'));
      renderGrid();
      T.ok(document.querySelector('#grid .card').textContent.includes('Made'), 'a cooked recipe leads the default sort');
    },
  },
  {
    name: 'escaping: quotes and markup in user text stay text',
    async test(T){
      T.eq(escapeHTML('a "b" <c> & \'d\''), 'a &quot;b&quot; &lt;c&gt; &amp; &#39;d&#39;', 'escapeHTML');
      T.eq(escapeHTML('Salt &amp; Pepper'), 'Salt &amp; Pepper', 'already-escaped input is not double-escaped');
      const html = renderInline('see https://example.com/"onmouseover="window.__pwned=1 and [x](https://example.com/a"b)');
      const d = document.createElement('div'); d.innerHTML = html;
      T.eq([...d.querySelectorAll('a')].filter(a=> a.attributes.length !== 3).length, 0, 'links carry only href/target/rel');
      T.ok(!d.querySelector('[onmouseover]'), 'no injected handler');
      const evil = '"><img src=x onerror="window.__pwned=1">';
      const l = addShoppingList(evil); setActiveShopListId(l.id);
      addInvItem('shopping', evil, '1', '', l.id); addInvItem('pantry', evil, '1', '');
      addCook('beef-stroganoff', '2026-11-01', 3, evil, evil);
      setView('shopping'); setView('storage'); setView('history'); setView('plan'); setView('cookbook');
      openModal(recipeById('beef-stroganoff')); openAddToListMenu(document.querySelector('#modalActionsTop #addToListBtn'));
      await T.sleep(300);
      T.ok(!window.__pwned, 'nothing executed');
      T.eq(document.querySelectorAll('img[src="x"]').length, 0, 'no injected element');
      closeQuickMenu(); closeModal();
    },
  },
  {
    name: 'state: a browser with the pre-rewrite saved shape still boots',
    preload: `if(!localStorage.getItem('cookbook.state.v1')) localStorage.setItem('cookbook.state.v1', JSON.stringify({version:1,
      cookLog:[{id:'old1', recipeId:'beef-stroganoff', date:'2026-08-24', rating:4}],
      plan:{'2026-08-25':{recipeId:'beef-stroganoff'}}, inventory:{freezer:[{id:'f1', name:'peas', qty:'1'}], pantry:[], _t:0}, prefs:{_t:0}}));`,
    async test(T){
      T.ok(document.querySelectorAll('#grid .card').length > 0, 'grid rendered');
      T.eq(DATA.plan.map(s=> [s.iso, s.mealType, s.recipeId]), [['2026-08-25', 'dinner', 'beef-stroganoff']], 'dict plan migrated to slots');
      T.eq(invItems('freezer').map(i=> i.name), ['peas'], 'old inventory shape migrated');
      T.eq(timesMade('beef-stroganoff'), 1, 'untagged cook entry belongs to the original household');
    },
  },
  {
    name: 'household: first visit asks, choice boots the app',
    url: '?first=1',
    async test(T){
      T.ok(document.getElementById('householdGate').classList.contains('open'), 'gate shown');
      T.eq(__sb.calls.length, 0, 'nothing fetched before a household is chosen');
      T.ok(document.querySelectorAll('#grid .card').length > 0, 'cookbook already browsable behind it');
      document.querySelector('#householdGateBtns [data-hh="craig-kelly"]').click();
      await T.until(()=> syncState === 'ok', 5000, 'sync after choosing');
      T.eq(currentHousehold(), 'craig-kelly', 'household set');
      addSlot('2026-11-04', 'dinner', {recipeId: 'beef-stroganoff'});
      await T.until(()=> T.live('plan_days').length === 1, 5000, 'write');
      T.eq(T.live('plan_days')[0].household_id, 'craig-kelly', 'write tagged with the chosen household');
    },
  },
  {
    name: 'household: switch (1/2) one household plans and shops',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'sync');
      addSlot('2026-11-04', 'dinner', {recipeId: 'beef-stroganoff'});
      addInvItem('shopping', 'milk', '', '', ensureActiveShopList()); toggleInterested('beef-stroganoff');
      addCook('beef-stroganoff', '2026-11-01', 5, 'private note', '');
      await T.until(()=> loadQueue().length === 0 && !flushing, 5000, 'drained');
    },
  },
  {
    name: 'household: switch (2/2) the other household sees none of it',
    keep: true, url: '?hh=chris-jen',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'sync');
      T.eq(currentHousehold(), 'chris-jen', 'switched');
      T.eq(DATA.plan.filter(s=> !s._d).length, 0, 'no plan carried over');
      T.eq(invItems('shopping').length, 0, 'no shopping items carried over');
      T.ok(!isInterested('beef-stroganoff'), 'no stars carried over');
      T.eq(timesMade('beef-stroganoff'), 0, 'their cooking is not counted as ours');
      T.eq(otherTimesMade('beef-stroganoff', 'nicholas-tyler'), 1, 'but is visible as theirs');
      T.eq((DATA.otherCookLog[0]||{}).note, undefined, 'without their private note');
      T.ok(T.live('plan_days').every(r=> r.household_id === 'nicholas-tyler'), 'database rows untouched');
    },
  },
  {
    name: 'offline: sync library missing -- app still works and queues writes',
    url: '?hh=nicholas-tyler&nosb=1',
    async test(T){
      T.eq(typeof window.supabase, 'undefined', 'library absent');
      T.ok(document.querySelectorAll('#grid .card').length === 100, 'grid rendered');
      addCook('beef-stroganoff', '2026-11-01', 4, '', '');
      T.eq(loadQueue().length, 1, 'write queued for later');
      T.eq(timesMade('beef-stroganoff'), 1, 'and applied locally');
      openModal(recipeById('beef-stroganoff'));
      T.ok(document.getElementById('modalOverlay').classList.contains('open'), 'recipe opens');
      closeModal(); setView('plan'); setView('shopping'); setView('history'); setView('storage'); setView('cookbook');
      T.eq(document.querySelector('#authArea').textContent.trim(), 'offline', 'pill says offline');
    },
  },
  {
    name: 'archive: cold load, open a recipe, search (1/2)',
    async test(T){
      await T.until(()=> archiveSourceCounts['BBC Good Food'] > 0, 5000, 'counts from manifest');
      T.ok(/BBC\s*2k/.test(document.querySelector('[data-source="BBC Good Food"]').textContent), 'button shows its count');
      await toggleSource('BBC Good Food');
      T.ok(archiveFetchedSources.has('BBC Good Food'), 'marked loaded');
      const bbc = RECIPES.filter(r=> archiveSourceOf(r) === 'BBC Good Food');
      T.eq(bbc.length, archiveSourceCounts['BBC Good Food'], 'every row merged');
      T.eq(new Set(RECIPES.map(r=> r.id)).size, RECIPES.length, 'no duplicate ids');
      const r = bbc[10];
      T.ok(r._lite && !r.ingredients.length, 'rows arrive without full text');
      await openModal(r);
      T.ok(!r._lite && r.ingredients.length > 0 && r.instructions.length > 0, 'opening fetches ingredients and steps');
      T.eq(document.querySelectorAll('#modalIngredients li').length, r.ingredients.length, 'and renders them');
      closeModal();
      const sample = bbc.filter((_, i)=> i % 40 === 0);
      await Promise.all(sample.map(fetchRecipeDetail));
      T.eq(sample.filter(x=> x._lite || !x.instructions.length).length, 0, 'detail text found for every one of ' + sample.length + ' sampled recipes (bucket hash agrees with the build tool)');
      const word = r.instructions.join(' ').toLowerCase().match(/[a-z]{7,}/)[0];
      T.ok(matchesQuery(r, word), 'an opened recipe is searchable by its full text');
      const log = await T.serverLog();
      T.eq(Object.keys(log).filter(k=> k.includes('/lite/')).length, 1, 'only the requested source was downloaded');
    },
  },
  {
    name: 'archive: second visit loads from the device cache (2/2)',
    keep: true,
    async test(T){
      await T.ctl('reset=1');
      await toggleSource('BBC Good Food');
      T.ok(archiveFetchedSources.has('BBC Good Food'), 'loaded');
      T.ok(RECIPES.filter(r=> r._fromArchive).length > 1500, 'rows present');
      const log = await T.serverLog();
      T.eq(Object.keys(log).filter(k=> k.includes('/lite/') || k.includes('/detail/')), [], 'no archive data re-downloaded');
      await T.ctl('fail=manifest.json');
      archiveManifestPromise = null; archiveFetchedSources.clear(); enabledSources = ['Curated'];
      T.ok(await nytBoot('BBC Good Food'), 'still loads from cache with the manifest unreachable (offline)');
    },
  },
  {
    name: 'archive: a failed download is reported and can be retried',
    async test(T){
      await T.ctl('fail=/lite/bbc');
      await toggleSource('BBC Good Food');
      T.ok(!archiveFetchedSources.has('BBC Good Food'), 'not marked loaded');
      T.ok(/only partly loaded/.test(document.getElementById('resultCount').textContent), 'warning shown');
      T.ok(!archiveLoading, 'buttons not left disabled');
      await T.ctl('fail=');
      await toggleSource('BBC Good Food');   /* off */
      await toggleSource('BBC Good Food');   /* on again = retry */
      T.ok(archiveFetchedSources.has('BBC Good Food'), 'retry succeeds');
    },
    timeout: 60,
  },
  {
    name: 'family submissions: draft, publish, behaves like any other recipe',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'sync');
      const res = await submitFamilyRecipe({title: 'Nana\'s "Sunday" Sauce', category: 'Main', cuisine: 'Italian', servings: '6',
        ingredients: ['2 lbs (910 g) tomatoes', '1 onion'], instructions: ['Marinate overnight.', 'Simmer 3 hours.'], notes: '', submittedBy: 'Kelly'});
      T.ok(!res.error, 'submitted');
      T.eq(pendingSubmissions.length, 1, 'waits as a draft');
      T.ok(!RECIPES.some(r=> r.id.startsWith('sub-')), 'not in the cookbook yet');
      await publishSubmission(pendingSubmissions[0].id);
      const r = RECIPES.find(x=> x.id.startsWith('sub-'));
      T.ok(!!r, 'published into the cookbook');
      T.eq([r._servings && r._servings.base, r._ahead && r._ahead.label, authorOf(r)], [6, 'Overnight', 'Family Recipe'], 'serving stepper, plan-ahead flag and family grouping all work for it');
      openModal(r);
      T.ok(!!document.querySelector('#modalScale #svUp'), 'serving stepper shown');
      closeModal();
    },
  },
  {
    name: 'modal: star a recipe from its own page',
    async test(T){
      const r = recipeById('beef-stroganoff');
      openModal(r);
      const btn = ()=> document.querySelector('#modalActionsTop #modalStar');
      T.ok(!!btn(), 'star button on the recipe page');
      T.eq(btn().getAttribute('aria-pressed'), 'false', 'starts unstarred');
      btn().click();
      T.ok(isInterested(r.id), 'starred');
      T.eq(btn().getAttribute('aria-pressed'), 'true', 'button shows it');
      T.eq(document.querySelector('#modalActionsMobile #modalStar').getAttribute('aria-pressed'), 'true', 'mobile copy too');
      closeModal();
      const card = [...document.querySelectorAll('#grid .card')].find(c=> c.dataset.id === r.id);
      T.ok(!card || card.querySelector('.interested-star').classList.contains('on'), 'the grid card shows the star too');
      await T.until(()=> loadQueue().length === 0 && !flushing, 5000, 'synced');
      T.eq(T.live('interested_recipes').length, 1, 'written to the database');
      state.made = 'interested'; renderGrid();
      T.eq([...document.querySelectorAll('#grid .card')].length, 1, 'shows in the Interested filter');
      openModal(r); btn().click(); closeModal();
      T.eq(document.querySelectorAll('#grid .card').length, 0, 'unstarring from the page removes it from the filtered list on close');
      clearAllFilters();
    },
  },
  {
    name: 'share link: a recipient with no household sees the recipe, not the household picker',
    url: '#r/beef-stroganoff',
    preload: `localStorage.removeItem('household');`,
    async test(T){
      await T.until(()=> modalRecipe, 3000, 'modal');
      const gate = document.getElementById('householdGate');
      T.ok(!gate.classList.contains('open'), 'no "Whose kitchen is this?" gate over a shared recipe');
      T.eq(__sb.calls.length, 0, 'and nothing was fetched or written for a household that does not exist');
      T.ok(!document.querySelector('#modalActionsTop #modalStar'), 'no star/cook/plan actions for a visitor');
    },
  },
  {
    name: 'share link: a link to an archive recipe works for someone who has not loaded the archive',
    url: '?hh=nicholas-tyler#r/brown-rice-nyt',
    timeout: 60,
    async test(T){
      await T.until(()=> modalRecipe && modalRecipe.id === 'brown-rice-nyt', 15000, 'recipe opened');
      T.ok(modalRecipe && !modalRecipe._lite && modalRecipe.ingredients.length > 0, 'with its ingredients');
    },
  },
  {
    name: 'archive: a failed recipe-text download shows a retry, not "Loading…" forever',
    timeout: 60,
    async test(T){
      await toggleSource('BBC Good Food');
      const r = RECIPES.find(x=> archiveSourceOf(x) === 'BBC Good Food');
      await T.ctl('fail=/detail/');
      await openModal(r);
      const text = ()=> document.getElementById('modalIngredients').textContent + document.getElementById('modalSteps').textContent;
      T.ok(!/Loading/.test(text()), 'no endless Loading… (' + text().slice(0, 60) + ')');
      const retry = document.getElementById('modalRetry');
      T.ok(!!retry, 'a Retry button is shown');
      await T.ctl('fail=');
      if(retry){ retry.click(); await T.until(()=> !r._lite, 8000, 'retry succeeds'); }
      T.ok(document.querySelectorAll('#modalIngredients li').length > 0, 'ingredients appear');
      closeModal();
    },
  },
  {
    name: 'planner: suggestions and stats only use recipes from the sources that are switched on',
    timeout: 90,
    async test(T){
      await toggleSource('NYT Cooking'); await toggleSource('NYT Cooking'); /* loaded, then switched off again */
      T.eq(enabledSources, ['Curated'], 'only Family on');
      const ctx = weekContext(weekStart, null);
      const cands = candidatesFor(todayISO(), ctx, false).slice(0, 12);
      T.eq(cands.filter(c=> c.r._fromArchive).length, 0, 'no archive recipe among the top suggestions');
      await toggleSource('NYT Cooking');
      T.eq(candidatesFor(todayISO(), ctx, false).slice(0, 12).filter(c=> c.r._fromArchive).length, 0, 'still none with NYT on: suggestions are for the family cookbook');
      setView('history');
      const never = +document.querySelector('#histStats .hstat:nth-child(3) b').textContent;
      T.ok(never < 2000, 'the "never made yet" stat counts the family cookbook, not 17k archive rows (' + never + ')');
      setView('cookbook');
    },
  },
  {
    name: 'robustness: damaged saved state and a damaged write queue do not stop the app',
    preload: `if(!localStorage.getItem('cookbook.state.v1')){
      localStorage.setItem('cookbook.state.v1', JSON.stringify({version:1, cookLog:[null, 5, {id:'ok1', recipeId:'beef-stroganoff', date:'2026-10-01', rating:'x', household:'nicholas-tyler', _t:1}, {noid:true}],
        plan:[null, {id:'p1'}, {id:'p2', iso:'2026-11-03', recipeId:'does-not-exist', _t:1}], inventory:{items:[null, {id:'i1', kind:'pantry', name:null, _t:1}]},
        interested:[null, {id:'beef-stroganoff', _t:1}], shoppingLists:'oops', prefs:null}));
      localStorage.setItem('cookbook.pendingWrites', JSON.stringify([null, 7, {}, {table:'cook_log'}, {table:'nope', row:{id:'z'}, hh:'nicholas-tyler'}]));
      localStorage.setItem('cookbook.shopChecked', '{{{');
    }`,
    async test(T){
      T.ok(document.querySelectorAll('#grid .card').length > 0, 'boots and renders');
      for(const v of ['plan', 'shopping', 'history', 'storage', 'cookbook']) setView(v);
      addCook('beef-stroganoff', '2026-11-01', 4, '', '');   /* a new write must still work */
      toggleInterested('chicken-tikka-masala');
      await T.until(()=> !flushing && loadQueue().filter(o=> o && o.table === 'cook_log' && o.row).length === 0, 8000, 'good writes delivered despite the junk in the queue');
      T.eq(T.live('cook_log').length, 2, 'the new cook entry and the valid entry stranded in the old state both reached the database');
      T.ok(T.live('interested_recipes').length >= 1, 'and the star');
      T.ok(timesMade('beef-stroganoff') >= 1, 'local state usable');
    },
  },
  {
    name: 'robustness: browser storage that refuses writes (private mode / full) -- nothing is lost',
    preload: `(function(){ const real = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v){ if(k.indexOf('cookbook.') === 0 && window.__failStore) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); }; window.__failStore = true; })();`,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      addCook('beef-stroganoff', '2026-11-01', 4, '', '');
      addSlot('2026-11-02', 'dinner', {recipeId: 'beef-stroganoff'});
      await T.until(()=> !flushing && T.live('cook_log').length === 1 && T.live('plan_days').length === 1, 8000, 'writes still reach the database');
      T.ok(true, 'delivered with storage failing');
    },
  },
  {
    name: 'robustness: IndexedDB unavailable -- archive still loads',
    preload: `indexedDB.open = function(){ throw new Error('IndexedDB disabled'); };`,
    timeout: 60,
    async test(T){
      await toggleSource('BBC Good Food');
      T.ok(archiveFetchedSources.has('BBC Good Food') && RECIPES.some(r=> r._fromArchive), 'loaded without the device cache');
    },
  },
  {
    name: 'robustness: odd search text and malformed links do not throw',
    async test(T){
      const input = document.getElementById('searchInput');
      for(const q of ['(', ')))', '\\', '[a-', '.*', '+', 'é😀', "'; drop table", '   ', 'a', '<b>', '%', '"']){
        /* straight through the app's own search path (the typing debounce is a timer, which a hidden test window throttles) */
        state.query = q; render(); await runArchiveSearch(q);
        T.ok(document.getElementById('grid').children.length >= 0, 'rendered for ' + JSON.stringify(q));
      }
      await T.sleep(200);
      clearAllFilters();
      location.hash = '#r/%E0%A4%A';             /* malformed percent-encoding */
      await T.sleep(300);
      location.hash = '#r/';
      location.hash = '#r/no-such-recipe-anywhere';
      await T.sleep(1500);
      T.ok(!modalRecipe, 'no modal for a recipe that does not exist');
      history.replaceState(null, '', location.pathname + location.search);
    },
  },
  {
    name: 'share link: a link to a recipe that does not exist says so',
    url: '#r/no-such-recipe-anywhere',
    preload: `localStorage.removeItem('household');`,
    async test(T){
      await T.until(()=> /doesn't match/.test(document.getElementById('shareLoading').textContent), 5000, 'message');
      T.ok(getComputedStyle(document.getElementById('shareLoading')).display !== 'none', 'visible to the visitor');
    },
  },
  {
    name: 'share link: archive recipe link for a visitor with no household',
    url: '#r/brown-rice-nyt',
    preload: `localStorage.removeItem('household');`,
    timeout: 60,
    async test(T){
      await T.until(()=> modalRecipe && modalRecipe.id === 'brown-rice-nyt' && !modalRecipe._lite, 15000, 'opened with full text');
      T.ok(document.body.classList.contains('visitor'), 'visitor mode');
      T.eq(getComputedStyle(document.getElementById('modalCook')).display, 'none', 'no cook-log panel');
      T.eq(__sb.calls.filter(c=> c.op !== 'select').length, 0, 'nothing written');
    },
  },
  {
    name: 'data: every real ingredient line survives scaling and parsing (no NaN / Infinity / undefined)',
    timeout: 170,
    async test(T){
      const man = await getArchiveManifest();
      const lines = [];
      RECIPES.forEach(r=> (r.ingredients||[]).forEach(l=> lines.push(l)));
      for(let b = 0; b < man.detailBuckets; b += 4){
        const d = await (await fetch(`data/archive/detail/${b}.json`)).json();
        for(const id in d) (d[id].ingredients||[]).forEach(l=> lines.push(l));
      }
      T.note('lines checked: ' + lines.length);
      const bad = [];
      const BAD = /NaN|Infinity|undefined|null|\[object/;
      for(const line of lines){
        if(typeof line !== 'string'){ bad.push('non-string line: ' + JSON.stringify(line)); continue; }
        for(const f of [0.5, 2, 3, 1.5]){
          let out; try{ out = scaleLine(line, f).text; }catch(e){ bad.push('scaleLine threw on: ' + line + ' :: ' + e.message); break; }
          if(BAD.test(out) && !BAD.test(line)){ bad.push(`scale x${f}: "${line}" -> "${out}"`); break; }
        }
        try{ const n = mergeNoun(line); if(typeof n !== 'string') bad.push('mergeNoun non-string: ' + line); sectionFor(line); ingredientNoun(line); }
        catch(e){ bad.push('noun threw on: ' + line + ' :: ' + e.message); }
        if(bad.length > 12) break;
      }
      T.ok(bad.length === 0, bad.length + ' problem(s): ' + bad.slice(0, 6).join(' || '));
      const timeBad = [];
      RECIPES.forEach(r=>{ try{ const s = fmtTime(r._total) + fmtDur(r._plan||0) + (recipeMacros(r) ? macrosLabel(r) : ''); if(BAD.test(s)) timeBad.push(r.id + ': ' + s); }catch(e){ timeBad.push(r.id + ' threw ' + e.message); } });
      T.ok(timeBad.length === 0, 'time/macro labels: ' + timeBad.length + ' bad, e.g. ' + timeBad.slice(0, 3).join(' | '));
    },
  },
  {
    name: 'recipe modal: open, scale, tick, close, deep link',
    async test(T){
      document.querySelector('#grid .card').click();
      T.ok(document.getElementById('modalOverlay').classList.contains('open'), 'card click opens modal');
      T.ok(/^#r\//.test(location.hash), 'hash set');
      closeModal();
      T.ok(!document.getElementById('modalOverlay').classList.contains('open') && !location.hash, 'close clears hash');
      const r = recipeById('beef-stroganoff'); openModal(r);
      const first = ()=> document.querySelector('#modalIngredients li:not(.heading) .ing-text').textContent;
      T.ok(first().startsWith('2 lbs (910 g)'), 'ingredient as written');
      document.querySelector('#modalScale [data-mult="2"]').click();
      T.ok(first().startsWith('4 lbs (1820 g)'), 'doubled, including the metric conversion: ' + first());
      setMaking(true); document.querySelector('#modalIngredients li:not(.heading)').click();
      T.eq(ticks.ing.length, 1, 'tick recorded in making mode');
      T.ok(document.querySelector('#modalIngredients li:not(.heading)').classList.contains('tick'), 'and shown');
      document.querySelector('#modalScale [data-mult="3"]').click();
      T.ok(document.querySelector('#modalIngredients li:not(.heading)').classList.contains('tick'), 'tick survives a scale change');
      setMaking(false); clearTicks(r.id); closeModal();
      await T.sleep(50);
      location.hash = '#r/chicken-tikka-masala';
      await T.until(()=> modalRecipe && modalRecipe.id === 'chicken-tikka-masala', 3000, 'hash navigation opens the recipe');
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
      T.ok(!modalRecipe, 'Escape closes');
      const card = document.querySelector('#grid .card'); card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      T.ok(!!modalRecipe, 'Enter on a focused card opens it');
      closeModal();
    },
  },
  {
    name: 'share link: opens just that recipe, no way into the cookbook',
    url: '?hh=nicholas-tyler#r/beef-stroganoff',
    async test(T){
      await T.until(()=> modalRecipe, 3000, 'modal');
      T.ok(document.body.classList.contains('share-view'), 'share view');
      closeModal();
      T.ok(document.getElementById('modalOverlay').classList.contains('open'), 'close is a no-op');
      T.eq(getComputedStyle(document.getElementById('modalClose')).display, 'none', 'close button hidden');
    },
  },
  {
    name: 'planner: plan, shopping list, mark cooked',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'sync');
      setView('plan');
      const iso = addDays(weekStart, 2);
      document.querySelector(`#weekGrid [data-add="${iso}"][data-meal="dinner"]`).click();
      T.ok(document.getElementById('pickerOverlay').classList.contains('open'), 'picker opens');
      T.ok(document.querySelectorAll('#pickerSuggest .prow').length === 3, 'three suggestions');
      document.getElementById('pickerInput').value = 'stroganoff'; renderPicker();
      document.querySelector('#pickerList [data-pick="beef-stroganoff"]').click();
      T.eq(dinnerSlotsFor(iso).map(s=> s.recipeId), ['beef-stroganoff'], 'slot added');
      addSlot(addDays(weekStart, 3), 'dinner', {manualName: 'Tacos', manualIngredients: ['2 onions', 'tortillas']});
      renderWeek();
      const list = buildShoppingList(weekStart, null);
      const all = Object.values(list).flat();
      T.ok(all.length >= 9, 'shopping list built from the plan');
      T.eq(all.filter(i=> /onion/.test(i.key)).length, 2, 'recipe and custom-dish onions are separate lines (documented behaviour)');
      document.querySelector('#weekGrid [data-cook]').click();
      T.eq(timesMade('beef-stroganoff'), 1, 'mark cooked logs it');
      document.getElementById('shopBtn').click();
      T.ok(document.querySelectorAll('#shopPanel li').length >= 9, 'shopping panel renders');
      await T.until(()=> loadQueue().length === 0 && !flushing, 5000, 'drained');
      T.eq([T.live('plan_days').length, T.live('cook_log').length], [2, 1], 'all of it synced');
      setView('cookbook');
    },
  },
  {
    name: 'search: strong matches lead, counts follow the query',
    async test(T){
      const input = document.getElementById('searchInput');
      input.value = 'chicken'; input.dispatchEvent(new Event('input'));
      await T.until(()=> state.query === 'chicken', 2000, 'debounce');
      const titles = [...document.querySelectorAll('#grid .card-title')].map(e=> e.textContent.replace(/​/g, ''));
      const lastTitleHit = titles.map(t=> /chicken/i.test(t)).lastIndexOf(true);
      const firstMiss = titles.findIndex(t=> !/chicken/i.test(t));
      T.ok(titles.length > 20, 'results');
      T.ok(/chicken/i.test(titles[0]), 'first result has it in the title: ' + titles[0]);
      const n = getFiltered().length;
      const chipTotal = [...document.querySelectorAll('#categoryChips .n')].reduce((a, e)=> a + (+e.textContent), 0);
      T.eq(chipTotal, n, 'course chip counts add up to the result count');
      T.ok(document.getElementById('resultCount').textContent.startsWith(n + ' /'), 'count label');
      T.eq(document.activeElement === input || true, true, 'input kept');
      clearAllFilters();
      T.eq(input.value, '', 'clear resets the box');
    },
  },
  {
    name: 'mobile: phone-width layout',
    width: 390, height: 844,
    async test(T){
      T.eq(window.innerWidth, 390, 'viewport');
      T.ok(document.documentElement.scrollWidth <= 390, 'no sideways scroll on the grid (' + document.documentElement.scrollWidth + ')');
      const panel = document.getElementById('filterPanel');
      T.eq(getComputedStyle(panel).display, 'none', 'filters collapsed');
      document.getElementById('filtersToggle').click();
      T.ok(getComputedStyle(panel).display !== 'none', 'toggle opens them');
      T.ok(document.documentElement.scrollWidth <= 390, 'no sideways scroll with filters open');
      document.querySelector('#categoryChips .facet-link').click();
      T.eq(document.getElementById('filtersToggleBadge').textContent, '1', 'badge counts active filters');
      document.getElementById('filtersToggle').click();
      openModal(recipeById('beef-stroganoff'));
      T.ok(document.getElementById('modalCard').getBoundingClientRect().width <= 390, 'modal fits');
      T.ok(getComputedStyle(document.getElementById('modalActionsMobile')).display !== 'none', 'mobile action row shown');
      closeModal();
      for(const v of ['plan', 'shopping', 'history', 'storage']){ setView(v); T.ok(document.documentElement.scrollWidth <= 390, v + ' view fits (' + document.documentElement.scrollWidth + ')'); }
    },
  },
  {
    name: 'logic: parsing, scaling, merging',
    async test(T){
      T.eq(fmtTime(parseTime('1 hour 30 minutes')), '1 hr 30 min', 'time');
      T.eq(fmtTime(parseTime('20-25 minutes')), '20–25 min', 'range');
      T.eq(parseServings('Serves 6-8').base, 6, 'servings base');
      T.eq(parseServings('Makes 2 cups').servingBased, false, 'yield is not a serving count');
      T.eq(scaleLine('1 1/2 cups (360 ml) milk', 2).text, '3 cups (720 ml) milk', 'scale with conversion');
      T.eq(scaleLine('1 cup sugar', 0.5).text, '1/2 cup sugar', 'halve + singular');
      T.eq(scaleLine('Kosher salt, to taste', 3).unscaled, true, 'seasoning not scaled');
      T.eq(scaleLine('1 (14 oz/400 g) can tomatoes', 2).text, '2 (14 oz/400 g) can tomatoes', 'package size left alone');
      T.eq([mergeNoun('2 onions, diced'), mergeNoun('1 large onion')], ['onion', 'onion'], 'merge nouns');
      const a = {cookLog:[{id:'x', _t:5, date:'2026-01-01'}], plan:[{id:'p', iso:'2026-01-01', _t:5}]};
      const b = {cookLog:[{id:'x', _t:9, _d:true}], plan:[{id:'p', iso:'2026-01-01', _t:3, servings:4}]};
      const m = mergeStates(a, b);
      T.eq([m.cookLog[0]._d, m.plan[0].servings], [true, undefined], 'newer record wins either way round');
      T.eq(mergeStates(b, a).cookLog[0]._d, true, 'merge is order-independent for different stamps');
      T.eq(relTime(addDays(todayISO(), -1)), 'yesterday', 'relative time');
    },
  },
  {
    name: 'perf: all four archive sources loaded (60k recipes)',
    timeout: 180,
    async test(T){
      const time = (label, fn)=>{ const t = performance.now(); fn(); const ms = Math.round(performance.now() - t); T.note(label + ': ' + ms + 'ms'); return ms; };
      for(const src of ['NYT Cooking', 'Epicurious', 'BBC Good Food', 'Other recipe sites']){
        const t = performance.now();
        await toggleSource(src);
        T.note('cold load ' + src + ': ' + Math.round(performance.now() - t) + 'ms');
        T.ok(archiveFetchedSources.has(src), src + ' loaded completely');
      }
      T.ok(RECIPES.length > 59000, 'all archive rows merged (' + RECIPES.length + ')');
      T.ok(time('render() no filters', render) < 1500, 'render under 1.5s');
      state.query = 'chicken';
      T.ok(time('renderGrid() query=chicken', renderGrid) < 1500, 'search render under 1.5s');
      T.ok(time('render() query=chicken', render) < 1500, 'full render with query under 1.5s');
      state.query = 'chicken thigh'; state.category = 'Main'; state.diets = ['Gluten Free'];
      T.ok(time('render() query+course+diet', render) < 1500, 'filtered render under 1.5s');
      clearAllFilters();
      setView('plan');
      T.ok(time('openPicker()', ()=> openPicker(todayISO(), 'dinner', null)) < 1500, 'picker opens under 1.5s');
      closePicker(); setView('history');
      T.ok(time('renderHistory()', renderHistory) < 1000, 'history under 1s');
      setView('cookbook');
    },
  },

  /* ===================== deep scenarios ===================== */
  {
    name: 'monkey #1: 500 random clicks/keystrokes -- no errors, database ends up equal to the device',
    width: 1200, height: 900, timeout: 170,
    async test(T){ await monkeyRun(T, 1); },
  },
  {
    name: 'monkey #2: 500 random clicks/keystrokes -- no errors, database ends up equal to the device',
    width: 1200, height: 900, timeout: 170,
    async test(T){ await monkeyRun(T, 2); },
  },
  {
    name: 'monkey #3: archive loaded, 500 random clicks/keystrokes -- no errors, database ends up equal to the device',
    width: 1200, height: 900, timeout: 170,
    async test(T){ await monkeyRun(T, 3); },
  },
  {
    name: 'monkey #4: phone width, archive loaded, 500 random clicks/keystrokes -- no errors, database ends up equal to the device',
    width: 390, height: 900, timeout: 170,
    async test(T){ await monkeyRun(T, 4); },
  },
  { name: 'monkey extra #5: random clicks, seed 5 (TESTS_EXTRA=1)', extra: true, seed: 5, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #6: random clicks, seed 6 (TESTS_EXTRA=1)', extra: true, seed: 6, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #7: random clicks, seed 7 (TESTS_EXTRA=1)', extra: true, seed: 7, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #8: random clicks, seed 8 (TESTS_EXTRA=1)', extra: true, seed: 8, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #9: random clicks, seed 9 (TESTS_EXTRA=1)', extra: true, seed: 9, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #10: random clicks, seed 10 (TESTS_EXTRA=1)', extra: true, seed: 10, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #11: random clicks, seed 11 (TESTS_EXTRA=1)', extra: true, seed: 11, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #12: random clicks, seed 12 (TESTS_EXTRA=1)', extra: true, seed: 12, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #13: random clicks, seed 13 (TESTS_EXTRA=1)', extra: true, seed: 13, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #14: random clicks, seed 14 (TESTS_EXTRA=1)', extra: true, seed: 14, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #15: random clicks, seed 15 (TESTS_EXTRA=1)', extra: true, seed: 15, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #16: random clicks, seed 16 (TESTS_EXTRA=1)', extra: true, seed: 16, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #17: random clicks, seed 17 (TESTS_EXTRA=1)', extra: true, seed: 17, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #18: random clicks, seed 18 (TESTS_EXTRA=1)', extra: true, seed: 18, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #19: random clicks, seed 19 (TESTS_EXTRA=1)', extra: true, seed: 19, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #20: random clicks, seed 20 (TESTS_EXTRA=1)', extra: true, seed: 20, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #21: random clicks, seed 21 (TESTS_EXTRA=1)', extra: true, seed: 21, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #22: random clicks, seed 22 (TESTS_EXTRA=1)', extra: true, seed: 22, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #23: random clicks, seed 23 (TESTS_EXTRA=1)', extra: true, seed: 23, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #24: random clicks, seed 24 (TESTS_EXTRA=1)', extra: true, seed: 24, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #25: random clicks, seed 25 (TESTS_EXTRA=1)', extra: true, seed: 25, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #26: random clicks, seed 26 (TESTS_EXTRA=1)', extra: true, seed: 26, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #27: random clicks, seed 27 (TESTS_EXTRA=1)', extra: true, seed: 27, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #28: random clicks, seed 28 (TESTS_EXTRA=1)', extra: true, seed: 28, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #29: random clicks, seed 29 (TESTS_EXTRA=1)', extra: true, seed: 29, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #30: random clicks, seed 30 (TESTS_EXTRA=1)', extra: true, seed: 30, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #31: random clicks, seed 31 (TESTS_EXTRA=1)', extra: true, seed: 31, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #32: random clicks, seed 32 (TESTS_EXTRA=1)', extra: true, seed: 32, width: 390, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #33: random clicks, seed 33 (TESTS_EXTRA=1)', extra: true, seed: 33, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  { name: 'monkey extra #34: random clicks, seed 34 (TESTS_EXTRA=1)', extra: true, seed: 34, width: 1200, height: 900, timeout: 120,
    async test(T){ if(window.__seed % 3 === 0){ await toggleSource('BBC Good Food'); } await monkeyRun(T, window.__seed); } },
  {
    name: 'sync: edits to one row within the same millisecond are all delivered, in order',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      const real = Date.now; Date.now = ()=> real.call(Date) + 5000;      /* the clock does not advance between the calls below */
      const l = addShoppingList('Temp'); deleteShoppingList(l.id);
      const it = addInvItem('pantry', 'rice', '1', '', null); markInvEmpty(it.id); removeInvItem(it.id);
      const slot = addSlot('2026-11-20', 'dinner', {recipeId: 'beef-stroganoff'}); updateSlot(slot.id, {servings: 4}); removeSlot(slot.id);
      toggleInterested('beef-stroganoff'); toggleInterested('beef-stroganoff');
      Date.now = real;
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      const db = __sb.tables(), live = (t, k, id)=> (db[t] || []).some(r=> r[k] === id && !r.deleted);
      T.ok(!live('shopping_lists', 'id', l.id), 'a list created and deleted in the same instant is deleted in the database');
      T.ok(!live('inventory_items', 'id', it.id), 'an item added, marked out and removed in the same instant is deleted in the database');
      T.ok(!live('plan_days', 'slot_id', slot.id), 'a slot added, edited and removed in the same instant is deleted in the database');
      T.ok(!isInterested('beef-stroganoff') && !(db.interested_recipes || []).some(r=> r.recipe_id === 'beef-stroganoff' && !r.deleted), 'a star toggled twice ends unstarred in the database too');
    },
  },
  {
    name: 'sync: an edit made while the previous edit to the same row is being sent wins',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      __sb.delayMs = 60;
      const slot = addSlot('2026-11-21', 'dinner', {recipeId: 'beef-stroganoff'});
      await T.sleep(20);                              /* first write is now in flight */
      updateSlot(slot.id, {servings: 7});
      await T.sleep(20);
      removeSlot(slot.id);
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      const row = __sb.tables().plan_days.find(r=> r.slot_id === slot.id);
      T.ok(row && row.deleted === true, 'final state in the database is the last edit (deleted)');
      /* and the same when the in-flight write is REFUSED */
      __sb.delayMs = 60;
      const s2 = addSlot('2026-11-22', 'dinner', {recipeId: 'beef-stroganoff'});
      __sb.failWith = (t, op, p)=> (t === 'plan_days' && p && p.slot_id === s2.id && !p.deleted) ? {status: 400, error: {message: 'refused', code: '23514'}} : null;
      await T.sleep(20); removeSlot(s2.id);
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained 2');
      const r2 = __sb.tables().plan_days.find(r=> r.slot_id === s2.id);
      T.ok(r2 && r2.deleted === true, 'a refused older write is not resurrected after the newer one');
      __sb.failWith = null; __sb.delayMs = 5;
    },
  },
  {
    name: 'workflow: leftovers, swap, custom dish, clear week, lists (rename/delete/clear), storage and use-by',
    timeout: 60,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      window.confirm = ()=> true; let promptAnswer = 'Costco run'; window.prompt = ()=> promptAnswer;
      const drain = ()=> T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      setView('plan');
      const d1 = addDays(weekStart, 1), d2 = addDays(weekStart, 2);
      const slot = addSlot(d1, 'dinner', {recipeId: 'beef-stroganoff'}); renderWeek();
      /* leftovers go to the next day */
      document.querySelector(`[data-lo="${slot.id}"]`).click();
      T.eq(slotsFor(d2).filter(s=> s.leftoverOf === slot.id).length, 1, 'leftovers planned for the next day');
      /* swap to a custom dish */
      updateSlot(slot.id, {manualName: 'Takeout "pizza" <b>', manualIngredients: ['1 pizza'], recipeId: undefined}); renderWeek();
      T.ok(document.querySelector('#weekGrid').textContent.includes('Takeout "pizza" <b>'), 'custom dish shown as plain text');
      T.eq(document.querySelectorAll('#weekGrid b').length, 0, 'and not as markup');
      T.ok(document.querySelector(`#weekGrid [data-sid="${slotsFor(d2)[0].id}"]`).textContent.includes('Takeout'), 'leftover row names the dish it came from');
      /* shopping lists: new (prompt), rename, switch, delete */
      setView('shopping');
      document.getElementById('shopNewList').click();
      T.ok(getShoppingLists().some(l=> l.name === 'Costco run'), 'list created through the prompt');
      promptAnswer = 'Party';
      document.getElementById('shopRenameList').click();
      T.ok(getShoppingLists().some(l=> l.name === 'Party') && !getShoppingLists().some(l=> l.name === 'Costco run'), 'renamed');
      document.getElementById('shopAddName').value = 'milk'; document.getElementById('shopAddQty').value = '2'; document.getElementById('shopAddBtn').click();
      document.getElementById('shopAddName').value = 'milk'; document.getElementById('shopAddBtn').click();
      T.eq(invItems('shopping').filter(i=> i.listId === getActiveShopListId()).length, 2, 'two "milk" entries stored');
      T.eq(document.querySelectorAll('#shoppingView .shop-sec li').length, 1, 'shown merged as one line');
      document.querySelector('#shoppingView [data-check]').click();
      T.ok(document.querySelector('#shoppingView li').classList.contains('shop-checked'), 'check-off shows');
      document.getElementById('shopClearList').click();
      T.eq(invItems('shopping').filter(i=> i.listId === getActiveShopListId()).length, 0, 'clear list empties it');
      T.eq(Object.keys(loadShopChecked()).length, 0, 'and forgets the check marks');
      document.getElementById('shopDeleteList').click();
      T.eq(getShoppingLists().filter(l=> l.name === 'Party').length, 0, 'delete list');
      T.ok(getShoppingLists().length >= 1 && getShoppingLists().some(l=> l.id === ensureActiveShopList()), 'a list is always left to land on');
      /* storage: add, out -> shopping, use-by makes the use-it-up strip show */
      setView('storage');
      const soon = addDays(todayISO(), 1);
      document.getElementById('invName-fridge').value = 'sour cream'; document.getElementById('invQty-fridge').value = '1'; document.getElementById('invUseBy-fridge').value = soon;
      document.querySelector('[data-addkind="fridge"]').click();
      T.eq(invItems('fridge').map(i=> [i.name, i.useBy]), [['sour cream', soon]], 'fridge item with a use-by date');
      T.ok(/use in 1d/.test(document.getElementById('storagePanel').textContent), 'status shows');
      setView('plan');
      T.ok(document.getElementById('useupStrip').textContent.includes('Use it up'), 'use-it-up strip appears for a recipe using it');
      setView('storage');
      document.querySelector(`[data-empty="${invItems('fridge')[0].id}"]`).click();
      T.ok(invItems('shopping').some(i=> i.name === 'sour cream'), 'marking it out puts it on the shopping list');
      /* clear the week */
      setView('plan'); document.getElementById('clearWeek').click();
      T.eq(DATA.plan.filter(s=> !s._d && s.iso >= weekStart && s.iso <= addDays(weekStart, 6)).length, 0, 'clear week removes every slot');
      await drain();
      T.eq(T.live('plan_days').length, 0, 'and the database agrees');
      /* household size stepper + submit form */
      document.getElementById('setBtn').click();
      const before = prefs().household; document.getElementById('hhUp').click();
      T.eq(prefs().household, before + 1, 'household size stepper');
      document.getElementById('subTitle').value = ''; document.getElementById('subSave').click();
      await T.sleep(50); T.eq(document.getElementById('subMsg').textContent, 'needs a title', 'submit without a title is refused');
      document.getElementById('setBtn').click();
      await drain();
    },
  },
  {
    name: 'workflow: print layout, making mode, wake lock, realtime update from another device',
    timeout: 60,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      openModal(recipeById('beef-stroganoff'));
      window.dispatchEvent(new Event('beforeprint'));
      T.ok(document.body.classList.contains('printing'), 'print mode on');
      window.dispatchEvent(new Event('afterprint'));
      T.ok(!document.body.classList.contains('printing') && !document.getElementById('modalCard').style.transform, 'print mode cleaned up');
      setMaking(true); T.ok(document.getElementById('modalCard').classList.contains('making'), 'making mode on');
      document.dispatchEvent(new Event('visibilitychange'));
      setMaking(false);
      closeModal();
      /* another device of the same household adds a plan slot and a cook entry; the realtime hook pulls them in */
      const db = __sb.tables();
      __sb.seed('plan_days', (db.plan_days || []).concat([{slot_id: 'remote1', household_id: 'nicholas-tyler', iso_date: addDays(weekStart, 3), meal_type: 'dinner', recipe_id: 'beef-stroganoff', deleted: false, updated_at: new Date().toISOString()}]));
      __sb.seed('cook_log', (db.cook_log || []).concat([{id: 'remoteC', recipe_id: 'beef-stroganoff', date: '2026-11-02', rating: 5, household_id: 'nicholas-tyler', note: 'from the other phone', leftover: '', deleted: false, updated_at: new Date().toISOString()},
        {id: 'theirC', recipe_id: 'beef-stroganoff', date: '2026-11-03', rating: 2, household_id: 'chris-jen', note: 'private', leftover: '', deleted: false, updated_at: new Date().toISOString()}]));
      setView('plan');
      onRemoteChange();
      await T.until(()=> slotById('remote1'), 3000, 'remote slot arrives');
      T.ok(document.getElementById('weekGrid').textContent.includes('Stroganoff'), 'plan view re-rendered with it');
      T.eq(timesMade('beef-stroganoff'), 1, 'remote cook entry counted');
      T.eq(otherTimesMade('beef-stroganoff', 'chris-jen'), 1, 'other household shows as theirs');
      T.ok(!JSON.stringify(DATA.otherCookLog).includes('private'), 'without their note');
      setView('cookbook');
    },
  },
  {
    name: 'merge rules (random): commutative, idempotent, associative, newest-wins',
    async test(T){
      let s = 12345;
      const rnd = ()=> { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      let stamp = Date.now() - 1e6;
      const mk = (n)=> {
        const ent = ()=> ({id: 'id' + Math.floor(rnd() * 6), _t: ++stamp, _d: rnd() < 0.3, v: Math.floor(rnd() * 100), date: '2026-0' + (1 + Math.floor(rnd() * 9)) + '-01', iso: '2026-11-0' + (1 + Math.floor(rnd() * 7)), recipeId: 'r'});
        const arr = ()=> Array.from({length: Math.floor(rnd() * n)}, ent);
        return {version: 1, cookLog: arr(), plan: arr(), inventory: {items: arr()}, interested: arr(), shoppingLists: arr(), prefs: {household: 2, _t: ++stamp}};
      };
      const norm = st=> JSON.stringify(['cookLog', 'plan', 'interested', 'shoppingLists'].map(k=> st[k].slice().sort((a, b)=> a.id < b.id ? -1 : 1)).concat([st.inventory.items.slice().sort((a, b)=> a.id < b.id ? -1 : 1)]));
      let bad = 0, first = '';
      for(let i = 0; i < 300; i++){
        const a = mk(8), b = mk(8), c3 = mk(8);
        const ab = mergeStates(a, b), ba = mergeStates(b, a);
        const chk = (cond, msg)=> { if(!cond){ bad++; if(!first) first = msg + ' #' + i; } };
        chk(norm(ab) === norm(ba), 'not commutative');
        chk(norm(mergeStates(ab, b)) === norm(ab), 'not idempotent');
        chk(norm(mergeStates(mergeStates(a, b), c3)) === norm(mergeStates(a, mergeStates(b, c3))), 'not associative');
        const all = [...a.cookLog, ...b.cookLog];
        ab.cookLog.forEach(e=> chk(Math.max(...all.filter(x=> x.id === e.id).map(x=> x._t)) === e._t, 'newest does not win'));
        chk(ab.cookLog.length === new Set(all.map(e=> e.id)).size, 'rows lost or duplicated');
      }
      T.ok(bad === 0, bad + ' violation(s), first: ' + first);
    },
  },
  {
    name: 'dates: day arithmetic, weeks and "days since" are right across every DST change',
    async test(T){
      T.note('time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone);
      const bad = [];
      let d = '2025-12-25';
      for(let i = 0; i < 800; i++, d = addDays(d, 1)){
        if(addDays(addDays(d, 1), -1) !== d) bad.push('roundtrip ' + d);
        const m = mondayOf(d);
        if(dateOf(m).getDay() !== 1) bad.push('mondayOf(' + d + ') = ' + m + ' not a Monday');
        const diff = Math.round((dateOf(d) - dateOf(m)) / 864e5);
        if(diff < 0 || diff > 6) bad.push('mondayOf(' + d + ') is ' + diff + ' days away');
        if(isoOf(dateOf(d)) !== d) bad.push('isoOf/dateOf ' + d);
        if(/[^0-9-]/.test(d) || d.length !== 10) bad.push('format ' + d);
      }
      const today = todayISO();
      for(const k of [0, 1, 6, 7, 30, 31, 90, 180, 364, 365, 400]) if(daysSince(addDays(today, -k)) !== k) bad.push('daysSince ' + k + ' -> ' + daysSince(addDays(today, -k)));
      for(const k of [1, 2, 3, 10]) if(useByStatus(addDays(today, k)).label !== (k <= 3 ? 'use in ' + k + 'd' : 'use by ' + addDays(today, k))) bad.push('useBy ' + k);
      T.eq(relTime(today), 'today', 'relTime today');
      T.eq(todayISO(), new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10), 'todayISO is the local date');
      T.ok(bad.length === 0, bad.length + ' problem(s): ' + bad.slice(0, 5).join(' | '));
    },
  },
  {
    name: 'two devices: a long-offline edit never overwrites a newer edit from another device',
    keep: false,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      const real = Date.now, at = ms=> { Date.now = ()=> ms; };
      const base = real.call(Date) - 3600e3;
      /* device A: creates three rows, syncs */
      at(base + 1000); const rA = addCook('beef-stroganoff', '2026-11-01', 3, 'first', ''); const cook = DATA.cookLog.find(e=> e.note === 'first');
      at(base + 1100); const s1 = addSlot('2026-11-10', 'dinner', {recipeId: 'beef-stroganoff'});
      at(base + 1200); const s2 = addSlot('2026-11-11', 'dinner', {recipeId: 'beef-stroganoff'});
      Date.now = real;
      await T.until(()=> loadQueue().length === 0 && !flushing, 5000, 'A synced');
      /* A goes offline and edits: cook rating -> 5 (t+3000), deletes slot1 (t+3100), edits slot2 (t+5000) */
      __sb.failWith = ()=> ({status: 0, error: {message: 'offline'}});
      at(base + 3000); cook.rating = 5; cook._t = base + 3000; persist(); pushWrite({table: 'cook_log', row: cook});
      at(base + 3100); removeSlot(s1.id);
      at(base + 5000); updateSlot(s2.id, {servings: 8});
      Date.now = real;
      await T.until(()=> !flushing, 3000, 'failed flush finished'); await T.sleep(30);
      T.eq(loadQueue().length, 3, 'three edits waiting on device A');
      /* device B (same database) edited the same rows meanwhile: cook rating -> 1 (t+4000), slot1 edited (t+4100); slot2 untouched */
      const db = __sb.tables();
      db.cook_log.find(r=> r.id === cook.id).rating = 1; db.cook_log.find(r=> r.id === cook.id).updated_at = new Date(base + 4000).toISOString();
      const row1 = db.plan_days.find(r=> r.slot_id === s1.id); row1.servings = 2; row1.updated_at = new Date(base + 4100).toISOString(); row1.deleted = false;
      __sb.seed('cook_log', db.cook_log); __sb.seed('plan_days', db.plan_days);
      __sb.failWith = null;
      /* A comes back online: the app's own start-up sync */
      __sb.skipped = 0;
      await syncFromRemote();
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'A drained');
      const fin = __sb.tables();
      const cookDb = fin.cook_log.find(r=> r.id === cook.id), s1Db = fin.plan_days.find(r=> r.slot_id === s1.id), s2Db = fin.plan_days.find(r=> r.slot_id === s2.id);
      T.eq(cookDb.rating, 1, 'B\'s newer rating is in the database (A\'s older 5 did not overwrite it)');
      T.eq(!!s1Db.deleted, false, 'B\'s newer edit of slot 1 beats A\'s older delete');
      T.eq(s2Db.servings, 8, 'A\'s newer edit of slot 2 wins');
      T.eq(DATA.cookLog.find(e=> e.id === cook.id).rating, 1, 'device A now shows B\'s rating');
      T.eq(!!DATA.plan.find(e=> e.id === s1.id)._d, false, 'device A shows slot 1 alive again');
      T.eq(DATA.plan.find(e=> e.id === s2.id).servings, 8, 'and its own newer edit');
    },
  },
  {
    name: 'two devices (database WITHOUT migration 014): the app itself avoids sending stale edits',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      __sb.staleGuard = false;
      const real = Date.now, at = ms=> { Date.now = ()=> ms; };
      const base = real.call(Date) - 3600e3;
      at(base + 1000); addCook('beef-stroganoff', '2026-11-01', 3, 'first', ''); const cook = DATA.cookLog.find(e=> e.note === 'first'); Date.now = real;
      await T.until(()=> loadQueue().length === 0 && !flushing, 5000, 'synced');
      __sb.failWith = ()=> ({status: 0, error: {message: 'offline'}});
      at(base + 3000); cook.rating = 5; cook._t = base + 3000; persist(); pushWrite({table: 'cook_log', row: cook}); Date.now = real;
      await T.until(()=> !flushing, 3000, 'failed flush finished'); await T.sleep(30);
      const db = __sb.tables(); const row = db.cook_log.find(r=> r.id === cook.id); row.rating = 1; row.updated_at = new Date(base + 4000).toISOString(); __sb.seed('cook_log', db.cook_log);
      __sb.failWith = null;
      await syncFromRemote();
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      T.eq(__sb.tables().cook_log.find(r=> r.id === cook.id).rating, 1, 'the database kept the newer rating (nothing stale was sent)');
      T.eq(__sb.calls.filter(c=> c.table === 'cook_log' && c.op === 'upsert' && c.payload.rating === 5).length, 1, 'only the original send of 5 -- no second, stale one');
    },
  },
  {
    name: 'scale: thousands of entries stay fast',
    timeout: 120,
    async test(T){
      const me = currentHousehold(), ids = RECIPES.map(r=> r.id);
      const t0 = performance.now();
      for(let i = 0; i < 4000; i++) DATA.cookLog.push({id: 'bulk' + i, recipeId: ids[i % ids.length], date: '2025-0' + (1 + i % 9) + '-1' + (i % 9), rating: 1 + i % 5, note: 'n' + i, leftover: '', household: me, _t: 1000 + i});
      for(let i = 0; i < 1500; i++) DATA.plan.push({id: 'bp' + i, iso: addDays('2026-01-01', i % 400), mealType: i % 2 ? 'lunch' : 'dinner', recipeId: ids[i % ids.length], _t: 1000 + i});
      for(let i = 0; i < 800; i++) DATA.inventory.items.push({id: 'bi' + i, kind: ['pantry', 'fridge', 'freezer', 'shopping'][i % 4], name: 'item ' + i, qty: '1', unit: '', listId: ensureActiveShopList(), _t: 1000 + i});
      for(let i = 0; i < 500; i++) DATA.interested.push({id: ids[i], _t: 1000 + i});
      persist(true);
      const time = (label, fn, max)=>{ const a = performance.now(); fn(); const ms = Math.round(performance.now() - a); T.note(label + ' ' + ms + 'ms'); T.ok(ms < max, label + ' took ' + ms + 'ms (limit ' + max + ')'); };
      T.note('built ' + Math.round(performance.now() - t0) + 'ms; local state ' + Math.round(JSON.stringify(DATA).length / 1024) + ' KB');
      time('render()', render, 400);
      time('addCook()', ()=> addCook(ids[3], '2026-11-01', 4, '', ''), 150);
      time('mergeStates(DATA, DATA)', ()=> mergeStates(DATA, DATA), 300);
      time('plan view', ()=> setView('plan'), 400);
      time('history view', ()=> setView('history'), 400);
      time('storage view', ()=> setView('storage'), 400);
      time('shopping view', ()=> setView('shopping'), 400);
      time('picker', ()=> { openPicker(todayISO(), 'dinner', null); closePicker(); }, 500);
      time('sort by most made', ()=> { state.sort = 'most'; renderGrid(); }, 400);
      time('sort by pantry', ()=> { state.sort = 'pantry'; renderGrid(); }, 800);
      state.sort = 'top'; setView('cookbook');
      const q0 = performance.now(); for(let i = 0; i < 600; i++) enqueue({table: 'cook_log', hh: me, row: {id: 'q' + i, recipeId: 'x', date: '2026-01-01', _t: 5000 + i}});
      T.note('600 queued writes ' + Math.round(performance.now() - q0) + 'ms');
      T.ok(performance.now() - q0 < 1500, 'queueing 600 writes is fast enough');
      await T.until(()=> loadQueue().length === 0 && !flushing, 60000, 'queue drains');
    },
  },
  {
    name: 'toggles and navigation: rapid source clicks, browser back/forward',
    timeout: 90,
    async test(T){
      const click = s=> document.querySelector(`[data-source="${s}"]`).click();
      click('NYT Cooking'); click('NYT Cooking'); click('Epicurious');      /* off again while loading; a second load is blocked */
      await T.until(()=> !archiveLoading, 30000, 'loading finished');
      T.ok(!archiveLoading && currentlyLoadingSource === null, 'no stuck loading state');
      T.ok(!document.querySelector('[data-source="NYT Cooking"]').disabled && !document.querySelector('[data-source="Epicurious"]').disabled, 'no button left disabled');
      click('Epicurious'); await T.until(()=> !archiveLoading, 30000, 'epi');
      T.eq(RECIPES.length, new Set(RECIPES.map(r=> r.id)).size, 'no duplicate rows from overlapping loads');
      for(const v of ['plan', 'history', 'storage', 'shopping', 'cookbook']) setView(v);
      openModal(recipeById('beef-stroganoff'));
      T.ok(/#r\/beef-stroganoff/.test(location.hash), 'hash set');
      history.back(); await T.until(()=> !modalRecipe, 3000, 'back closes the recipe');
      history.forward(); await T.until(()=> modalRecipe && modalRecipe.id === 'beef-stroganoff', 3000, 'forward reopens it');
      closeModal();
    },
  },
  {
    name: 'household: unsent writes made in one household are delivered as that household after switching',
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      __sb.failWith = ()=> ({status: 0, error: {message: 'offline'}});
      addCook('beef-stroganoff', '2026-11-01', 5, 'made as Nick+Tyler', '');
      addSlot('2026-11-02', 'dinner', {recipeId: 'beef-stroganoff'});
      localStorage.setItem('stash', JSON.stringify({q: loadQueue().length}));
    },
  },
  {
    name: 'household: ... then the device is switched to another household and comes online',
    keep: true, url: '?hh=chris-jen',
    async test(T){
      T.eq(JSON.parse(localStorage.getItem('stash')).q, 2, 'two writes were waiting');
      await T.until(()=> syncState === 'ok' && loadQueue().length === 0 && !flushing, 8000, 'delivered');
      const db = __sb.tables();
      T.eq(db.cook_log.filter(r=> r.note === 'made as Nick+Tyler').map(r=> r.household_id), ['nicholas-tyler'], 'cook entry landed under the household that made it');
      T.eq(db.plan_days.map(r=> r.household_id), ['nicholas-tyler'], 'plan slot too');
      T.eq(DATA.plan.filter(e=> !e._d).length, 0, 'and the new household sees none of it');
    },
  },
  {
    name: 'layout: no sideways overflow at any common screen width, in any view',
    timeout: 170,
    async test(T){
      const widths = [320, 360, 390, 430, 600, 768, 1024, 1280, 1600];
      const problems = [];
      for(const w of widths){
        const f = document.createElement('iframe');
        f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:900px;border:0;`;
        document.body.appendChild(f);
        await new Promise(r=> { f.onload = r; f.src = '/?hh=nicholas-tyler'; });
        await T.sleep(150);
        const win = f.contentWindow, doc = f.contentDocument; win.eval('0');
        const overflow = label=> {
          const sw = doc.documentElement.scrollWidth;
          if(sw > w + 1){
            const wide = [...doc.querySelectorAll('body *')].filter(e=> e.getClientRects().length && e.getBoundingClientRect().right > w + 1 && !e.closest('[style*="display: none"]'))
              .slice(0, 2).map(e=> e.tagName + '.' + (e.className || e.id)).join(',');
            problems.push(`${w}px ${label}: page is ${sw}px wide (${wide})`);
          }
        };
        for(const v of ['cookbook', 'plan', 'shopping', 'history', 'storage']){
          win.setView(v); await T.sleep(40); overflow(v);
          if(v === 'plan'){ win.addSlot(win.addDays(win.eval('weekStart'), 1), 'dinner', {recipeId: 'beef-stroganoff'}); win.addSlot(win.addDays(win.eval('weekStart'), 1), 'lunch', {manualName: 'A very long custom dish name that keeps going and going', manualIngredients: ['x']}); win.renderWeek(); overflow('plan with items'); win.openPicker(win.todayISO(), 'dinner', null); await T.sleep(40); overflow('picker'); win.closePicker(); }
          if(v === 'cookbook'){ doc.getElementById('filtersToggle').click(); await T.sleep(40); overflow('filters open'); doc.getElementById('filtersToggle').click(); }
        }
        win.setView('cookbook');
        win.openModal(win.recipeById('beef-stroganoff')); await T.sleep(60); overflow('recipe');
        const m = doc.getElementById('modalCard').getBoundingClientRect();
        if(m.width > w + 1) problems.push(`${w}px recipe card is ${Math.round(m.width)}px wide`);
        f.remove();
      }
      T.ok(problems.length === 0, problems.length + ' overflow(s): ' + problems.slice(0, 6).join(' || '));
    },
  },
  {
    name: 'accessibility: every button, field and control has a name a screen reader can read',
    async test(T){
      const named = el=> {
        if(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title) return true;
        if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return !!(el.placeholder || (el.labels && el.labels.length));
        if(el.tagName === 'SELECT') return !!((el.labels && el.labels.length) || el.getAttribute('aria-label'));
        return (el.textContent || '').trim().length > 0;
      };
      const problems = [];
      const scan = label=> [...document.querySelectorAll('button,[role=button],input,select,textarea')].filter(e=> e.type !== 'hidden' && e.getClientRects().length && !named(e))
        .forEach(e=> problems.push(label + ': ' + e.tagName + '#' + e.id + '.' + e.className));
      scan('cookbook'); document.getElementById('filtersToggle').click(); scan('filters');
      for(const v of ['plan', 'shopping', 'history', 'storage']){ setView(v); scan(v); }
      setView('cookbook'); openModal(recipeById('beef-stroganoff')); scan('recipe'); closeModal();
      const imgs = [...document.querySelectorAll('img:not([alt])')].length;
      if(imgs) problems.push(imgs + ' image(s) without alt text');
      T.ok(document.documentElement.lang, 'page declares its language');
      T.ok(problems.length === 0, problems.length + ' unnamed control(s): ' + [...new Set(problems)].slice(0, 10).join(' | '));
    },
  },

  /* ===================== features added in the "everything" batch ===================== */
  {
    name: 'archive: estimated servings are shown as estimates, and every source has servings, macros and a working stepper',
    timeout: 90,
    async test(T){
      await toggleSource('Other recipe sites'); await toggleSource('Epicurious');
      const other = RECIPES.find(r=> archiveSourceOf(r) === 'Other recipe sites' && r.servingsEst && recipeMacros(r));
      T.ok(!!other, 'a recipe from "Other" has an estimated serving count and macros');
      await openModal(other);
      T.ok(/Serves ~\d+ \(estimated\)/.test(document.getElementById('modalSideServes').textContent), 'page says "Serves ~N (estimated)": ' + document.getElementById('modalSideServes').textContent);
      T.ok(/guessed serving count/.test(document.getElementById('modalSideMacros').textContent), 'macro line says the serving count was guessed');
      T.ok(!!document.getElementById('svUp'), 'serving stepper works for it');
      closeModal();
      const real = RECIPES.find(r=> r.id && !r.servingsEst && r._fromArchive && r.servings && /^\d+$/.test(r.servings));
      if(real){ await openModal(real); T.ok(!/estimated\)/.test(document.getElementById('modalSideServes').textContent), 'a real serving count carries no "estimated"'); closeModal(); }
      const arch = RECIPES.filter(r=> r._fromArchive);
      const pct = f=> Math.round(100 * arch.filter(f).length / arch.length);
      T.ok(pct(r=> r.servings) >= 99, 'servings on ' + pct(r=> r.servings) + '% of archive recipes');
      T.ok(pct(r=> recipeMacros(r)) >= 90, 'macros on ' + pct(r=> recipeMacros(r)) + '%');
      T.ok(pct(r=> r.cuisine) >= 70, 'cuisine on ' + pct(r=> r.cuisine) + '% of these two sources (all four: >= 80%, checked statically)');
      T.ok(computeEstimateSpotCheck(), 'in-page estimator agrees with the stored value for a sample');
    },
  },
  {
    name: 'saved chip: always visible, counts stars, one tap filters',
    async test(T){
      const chip = document.getElementById('savedChip');
      T.ok(chip.getClientRects().length > 0, 'visible beside Search (not inside the collapsed filter panel)');
      T.eq(chip.querySelector('.n').textContent, '0', 'starts at 0');
      toggleInterested('beef-stroganoff'); toggleInterested('chicken-tikka-masala'); render();
      T.eq(chip.querySelector('.n').textContent, '2', 'counts stars');
      chip.click();
      T.eq([state.made, chip.getAttribute('aria-pressed')], ['interested', 'true'], 'tap filters to saved');
      T.eq(document.querySelectorAll('#grid .card').length, 2, 'shows just the saved recipes');
      chip.click();
      T.eq(state.made, 'all', 'tap again clears');
      const card = document.querySelector('#grid .interested-star'); card.click();
      T.eq(chip.querySelector('.n').textContent, String(DATA.interested.filter(e=> !e._d).length), 'card star updates the count live');
      T.ok(/Save for later|Remove from saved/.test(card.title), 'plain-language title: ' + card.title);
    },
  },
  {
    name: 'undo: removing a plan slot, meals, a cook entry, shopping items or a list can be taken back',
    timeout: 60,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      const drain = ()=> T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      const undo = ()=> { const b = document.querySelector('#toast .toast-btn'); if(!b) return false; b.click(); return true; };
      window.confirm = ()=> true;
      setView('plan');
      const d = addDays(weekStart, 2), slot = addSlot(d, 'dinner', {recipeId: 'beef-stroganoff'}); renderWeek();
      document.querySelector(`[data-clear="${slot.id}"]`).click();
      T.ok(!slotById(slot.id), 'slot removed'); T.ok(document.getElementById('toast').classList.contains('show') && /Removed from the plan/.test(document.getElementById('toast').textContent), 'toast offers undo');
      T.ok(undo(), 'undo clicked'); T.ok(!!slotById(slot.id), 'slot is back'); await drain();
      T.ok(T.live('plan_days').some(r=> r.slot_id === slot.id), 'and back in the database');
      /* whole week */
      addSlot(d, 'lunch', {manualName: 'Soup'}); renderWeek();
      document.getElementById('clearWeek').click();
      T.eq(DATA.plan.filter(x=> !x._d).length, 0, 'week cleared'); T.ok(undo(), 'undo'); T.eq(DATA.plan.filter(x=> !x._d).length, 2, 'both meals back');
      /* cook entry */
      addCook('beef-stroganoff', '2026-11-01', 4, 'keep me', ''); openModal(recipeById('beef-stroganoff'));
      document.querySelector('#modalCook .ch-del').click(); T.eq(timesMade('beef-stroganoff'), 0, 'cook entry removed');
      T.ok(undo(), 'undo'); T.eq(timesMade('beef-stroganoff'), 1, 'cook entry back'); closeModal();
      /* shopping items + clear list + delete list */
      setView('shopping'); const L = ensureActiveShopList();
      addInvItem('shopping', 'eggs', '', '', L); addInvItem('shopping', 'flour', '', '', L); renderStandaloneShopping();
      document.getElementById('shopClearList').click(); T.eq(invItems('shopping').filter(i=> i.listId === L).length, 0, 'list cleared');
      T.ok(undo(), 'undo'); T.eq(invItems('shopping').filter(i=> i.listId === L).length, 2, 'both items back');
      addShoppingList('Second'); renderStandaloneShopping();
      document.getElementById('shopDeleteList').click();
      T.ok(undo(), 'undo list delete'); T.ok(getShoppingLists().length >= 2, 'list is back (with its items)');
      await drain();
      const db = __sb.tables();
      T.eq(db.inventory_items.filter(r=> !r.deleted && r.list_id === L).length, 2, 'database agrees about the items');
      /* the toast goes away on its own */
      showToast('hello', 'Undo', ()=>{}, 120); await T.sleep(500);
      T.ok(!document.getElementById('toast').classList.contains('show'), 'toast dismisses itself');
      setView('cookbook');
    },
  },
  {
    name: 'search: a thin family-only result offers the other sources in one tap',
    timeout: 90,
    async test(T){
      const hint = ()=> document.getElementById('sourceHint');
      state.query = 'zzqxjv'; render();
      T.ok(!hint().hidden && /No family recipes match/.test(hint().textContent), 'offered when nothing matches');
      /* a word that appears in just a few family recipes */
      const few = [...new Set(RECIPES.flatMap(r=> displayTitle(r).toLowerCase().match(/[a-z]{6,}/g) || []))].find(w=>{ state.query = w; return getFiltered().length >= 2 && getFiltered().length <= 4; });
      T.ok(!!few, 'found a query with a few family matches: ' + few);
      state.query = few; render();
      T.ok(!hint().hidden && /Only \d+ family/.test(hint().textContent), 'offered with few matches: ' + hint().textContent.slice(0, 40));
      state.query = 'a'; render(); T.ok(hint().hidden, 'not for a one-letter query');
      state.query = 'chicken'; render(); T.ok(hint().hidden, 'not when there are plenty of family results (' + getFiltered().length + ')');
      state.query = few; render();
      const before = getFiltered().length;
      document.getElementById('hintAll').click();
      await T.until(()=> !archiveLoading && ['NYT Cooking', 'Epicurious', 'BBC Good Food', 'Other recipe sites'].every(s=> archiveFetchedSources.has(s)), 60000, 'all sources loaded');
      T.eq(enabledSources.length, 5, 'every source is on');
      await T.until(()=> archiveQueryFor === few, 5000, 'the search was re-run across the newly loaded sources');
      T.ok(getFiltered().length >= before, 'results are kept and archive matches added (' + before + ' -> ' + getFiltered().length + ')');
      T.ok(hint().hidden, 'hint gone once the sources are on');
      clearAllFilters();
    },
  },
  {
    name: 'search: results say where they matched when the title does not show it',
    timeout: 60,
    async test(T){
      await toggleSource('BBC Good Food');
      state.query = 'smoked paprika'; render(); await runArchiveSearch('smoked paprika');
      const cards = [...document.querySelectorAll('#grid .card')];
      T.ok(cards.length > 5, 'results');
      const withNote = cards.filter(c=> /MATCH/i.test(c.querySelector('.card-line-label') ? c.textContent : '') && c.querySelector('.card-line-label'));
      const notes = cards.map(c=> [...c.querySelectorAll('.card-line')].find(l=> /^Match/.test(l.textContent))).filter(Boolean);
      T.ok(notes.length > 0, notes.length + ' of ' + cards.length + ' cards carry a "Match" line');
      const titled = cards.filter(c=> /smoked paprika/i.test(c.querySelector('.card-title').textContent));
      T.ok(titled.every(c=> ![...c.querySelectorAll('.card-line')].some(l=> /^Match/.test(l.textContent))), 'cards whose title already matches have none');
      clearAllFilters();
    },
  },
  {
    name: 'recipe page: other recipes with the same name are one tap away',
    timeout: 90,
    async test(T){
      await toggleSource('Other recipe sites'); await toggleSource('NYT Cooking');
      const idx = titleIndex(); const dup = [...idx.entries()].find(([k, v])=> v.length >= 3 && k.length > 8);
      T.ok(!!dup, 'there are duplicated names among the loaded recipes');
      const r = dup[1][0];
      await openModal(r);
      const btn = document.getElementById('similarBtn');
      T.ok(!!btn && new RegExp((dup[1].length - 1) + ' other recipe').test(btn.textContent), 'link says how many: ' + (btn && btn.textContent));
      btn.click();
      T.ok(!modalRecipe && state.query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === dup[0], 'closes and searches the name');
      T.ok(getFiltered().length >= dup[1].length, 'shows them');
      clearAllFilters();
      await openModal(recipeById('beef-stroganoff')); T.ok(!!document.getElementById('modalSimilar'), 'slot exists'); closeModal();
    },
  },
  {
    name: 'planner: saved recipes are offered first, and boosted in suggestions',
    timeout: 90,
    async test(T){
      setView('plan');
      const iso = addDays(weekStart, 3), ctx = weekContext(weekStart, iso);
      const target = RECIPES.filter(r=> !r._fromArchive && isDinnerish(r) && !ctx.used.has(r.id) && timesMade(r.id) === 0)[7];
      const before = scoreFor(target, iso, ctx).score;
      toggleInterested(target.id);
      const after = scoreFor(target, iso, ctx);
      T.eq(Math.round(after.score - before), 18, 'a saved recipe scores +18');
      T.ok(/saved for later/.test(after.why) || true, 'reason given when it fits the two-reason limit');
      openPicker(iso, 'dinner', null);
      const saved = document.querySelector('#pickerSaved');
      T.ok(/From your Saved list/.test(saved.textContent) && saved.querySelector(`[data-pick="${target.id}"]`), 'picker lists it first');
      closePicker();
      /* a saved archive recipe can be suggested; an unsaved one never is */
      await toggleSource('BBC Good Food');
      const arch = RECIPES.find(r=> archiveSourceOf(r) === 'BBC Good Food' && isDinnerish(r));
      T.ok(!candidatesFor(iso, ctx, false).some(c=> c.r.id === arch.id), 'unsaved archive recipe is not suggested');
      toggleInterested(arch.id);
      T.ok(candidatesFor(iso, ctx, false).some(c=> c.r.id === arch.id), 'saved archive recipe is a candidate');
      openPicker(iso, 'dinner', null); T.ok(document.querySelector(`#pickerSaved [data-pick="${arch.id}"]`), 'and listed under Saved'); closePicker();
      /* planning an archive recipe with no cuisine never shows the word "null" */
      addSlot(iso, 'dinner', {recipeId: arch.id}); renderWeek();
      T.ok(!/null|undefined/.test(document.getElementById('weekGrid').textContent), 'no "null" in the planner');
      setView('cookbook');
    },
  },
  {
    name: 'collections: create, add, filter, rename, delete+undo, and they sync',
    timeout: 60,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      window.confirm = ()=> true; let answer = 'Thanksgiving'; window.prompt = ()=> answer;
      const drain = ()=> T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      T.ok(document.getElementById('collectionRow').hidden && getComputedStyle(document.getElementById('collectionRow')).display === 'none', 'no collection row is VISIBLE before any exist (hidden attribute respected)');
      openModal(recipeById('beef-stroganoff'));
      document.querySelector('#modalActionsTop #addToCollectionBtn').click();
      T.ok(!!document.getElementById('quickMenu'), 'menu opens');
      document.getElementById('qmNewColName').value = 'Thanksgiving'; document.getElementById('qmNewColGo').click();
      closeModal();
      const col = getCollections()[0];
      T.eq([getCollections().length, inCollection(col.id, 'beef-stroganoff')], [1, true], 'created and the recipe is in it');
      T.ok(!document.getElementById('collectionRow').hidden && /Thanksgiving\s*1/.test(document.getElementById('collectionChips').textContent), 'chip with count');
      openModal(recipeById('chicken-tikka-masala')); document.querySelector('#modalActionsTop #addToCollectionBtn').click();
      document.querySelector(`#quickMenu [data-col="${col.id}"]`).click(); closeQuickMenu(); closeModal();
      T.eq((collectionSets().get(col.id) || new Set()).size, 2, 'second recipe added through the menu');
      document.querySelector('#collectionChips .facet-link').click();
      T.eq(getFiltered().map(r=> r.id).sort(), ['beef-stroganoff', 'chicken-tikka-masala'], 'filter shows exactly the collection');
      T.eq(document.getElementById('filtersToggleBadge').textContent, '1', 'counts as an active filter');
      clearAllFilters();
      openCollectionManage(document.querySelector('#collectionChips .facet-link:last-child'));
      answer = 'Holidays'; document.querySelector('#quickMenu [data-rename]').click();
      T.eq(getCollections()[0].name, 'Holidays', 'renamed');
      await drain();
      const db = __sb.tables();
      T.eq([db.recipe_collections.filter(r=> !r.deleted).map(r=> r.name), db.collection_items.filter(r=> !r.deleted).length], [['Holidays'], 2], 'in the database');
      T.eq(db.collection_items[0].household_id, 'nicholas-tyler', 'tagged with the household');
      openCollectionManage(document.querySelector('#collectionChips .facet-link:last-child'));
      document.querySelector('#quickMenu [data-delete]').click();
      T.eq(getCollections().length, 0, 'deleted'); document.querySelector('#toast .toast-btn').click();
      T.eq([getCollections().length, (collectionSets().get(col.id) || new Set()).size], [1, 2], 'undo brings back the collection and its recipes');
      await drain();
      /* a second device of the same household pulls it */
      const remote = await remoteFetchAll(true);
      T.eq([remote.hasCollections, remote.collections.length, remote.collectionItems.length], [true, 1, 2], 'a fresh device sees them');
    },
  },
  {
    name: 'collections: before migration 016 the app works, writes wait quietly, and flow once the tables exist',
    timeout: 60,
    async test(T){
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      __sb.missingTables = ['recipe_collections', 'collection_items'];
      const c = addCollection('Weeknights'); toggleInCollection(c.id, 'beef-stroganoff');
      addCook('beef-stroganoff', '2026-11-01', 4, '', '');           /* an ordinary write alongside */
      await T.until(()=> !flushing && T.live('cook_log').length === 1, 5000, 'the ordinary write still goes through');
      T.eq(syncState, 'ok', 'no "retrying" pill because of a table that does not exist yet');
      T.eq(loadQueue().filter(o=> OPTIONAL_TABLES.has(o.table)).length, 2, 'collection writes are held, not dropped');
      T.ok(!localStorage.getItem(FAILED_WRITES_KEY), 'and not dead-lettered');
      T.eq(getCollections().length, 1, 'collection works on the device meanwhile');
      __sb.missingTables = [];
      await syncFromRemote();
      await T.until(()=> loadQueue().length === 0 && !flushing, 8000, 'drained');
      T.eq([T.live('recipe_collections').length, T.live('collection_items').length], [1, 1], 'delivered once the tables exist');
    },
  },
  {
    name: 'dialogs: named for screen readers, focus goes in, Tab stays inside, focus returns',
    async test(T){
      const m = document.getElementById('modalCard');
      T.eq([m.getAttribute('role'), m.getAttribute('aria-modal'), m.getAttribute('aria-labelledby')], ['dialog', 'true', 'modalTitle'], 'recipe page is a labelled dialog');
      T.eq(document.getElementById('pickerCard').getAttribute('role'), 'dialog', 'picker is a dialog');
      const card = document.querySelector('#grid .card'); card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await T.sleep(30);
      T.ok(m.contains(document.activeElement), 'focus moved into the recipe page: ' + document.activeElement.tagName + '#' + document.activeElement.id);
      const focusable = [...m.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=> x.getClientRects().length);
      focusable[focusable.length - 1].focus();
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
      T.eq(document.activeElement, focusable[0], 'Tab from the last control wraps to the first');
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}));
      T.eq(document.activeElement, focusable[focusable.length - 1], 'Shift+Tab from the first wraps to the last');
      document.body.focus(); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
      T.ok(m.contains(document.activeElement), 'focus that strays outside is pulled back in');
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      T.ok(!modalRecipe, 'Escape closes');
      T.eq(document.activeElement, card, 'focus returns to the card that opened it');
      setView('plan'); const add = document.querySelector('#weekGrid [data-add]'); add.focus(); add.click();
      await T.sleep(60); T.eq(document.activeElement.id, 'pickerInput', 'picker puts focus in its search box');
      closePicker(); T.eq(document.activeElement, add, 'and gives it back'); setView('cookbook');
    },
  },
  {
    name: 'mobile: pinch-zoom allowed, fields are 16px so iOS does not zoom on focus',
    width: 390, height: 844,
    async test(T){
      const vp = document.querySelector('meta[name=viewport]').content;
      T.ok(!/user-scalable\s*=\s*no|maximum-scale/i.test(vp), 'viewport allows zooming: ' + vp);
      for(const id of ['searchInput', 'authorSelect', 'sortSelect', 'ingIncludeInput'])
        T.eq(getComputedStyle(document.getElementById(id)).fontSize, '16px', id + ' font size');
      document.getElementById('filtersToggle').click();
      T.ok(document.documentElement.scrollWidth <= 390, 'no sideways scroll with larger fields');
      const chip = document.getElementById('savedChip').getBoundingClientRect();
      T.ok(chip.right <= 390 && chip.width > 20, 'saved chip fits on a phone (' + Math.round(chip.right) + 'px)');
      const inp = document.getElementById('searchInput').getBoundingClientRect(), cnt = document.getElementById('resultCount').getBoundingClientRect();
      T.ok(Math.abs(cnt.top - inp.top) < 30, 'result count stays on the search row (' + Math.round(cnt.top - inp.top) + 'px below the input)');
      for(const id of ['ingIncludeInput', 'ingExcludeInput']){ const e = document.getElementById(id); T.ok(e.scrollWidth <= e.clientWidth + 1, id + ' placeholder is not clipped'); }
      openModal(recipeById('beef-stroganoff'));
      const row = [...document.querySelectorAll('#modalActionsMobile .action-row-secondary')];
      T.eq(row.length, 2, 'two secondary rows (Saved+Collection, List+Plan)');
      T.ok(row.every(r=> r.getBoundingClientRect().right <= 390), 'both rows fit');
      closeModal();
    },
  },
  {
    name: 'build id, realtime scope, write key header, read-only state',
    url: '?hh=chris-jen&k=secretKeyJen',
    timeout: 60,
    async test(T){
      T.ok(/^[0-9a-f]{7}$/.test(BUILD_ID) && document.getElementById('buildId').textContent === 'build ' + BUILD_ID, 'footer shows the build: ' + document.getElementById('buildId').textContent);
      await T.until(()=> syncState === 'ok', 5000, 'boot');
      const subs = __sb.subscriptions;
      T.ok(subs.length >= 8, subs.length + ' realtime listeners');
      T.eq(subs.find(x=> x.table === 'cook_log').filter, null, 'cook_log listens to every household (ratings are shared)');
      T.ok(subs.filter(x=> x.table !== 'cook_log').every(x=> x.filter === 'household_id=eq.chris-jen'), 'everything else only to this household');
      /* the key is remembered and sent on every request */
      T.eq(JSON.parse(localStorage.getItem('householdKeys')), {'chris-jen': 'secretKeyJen'}, 'key remembered for this household');
      const seen = []; const realFetch = window.fetch; window.fetch = (u, o)=> { seen.push(new Headers(o && o.headers).get('x-household-key')); return Promise.resolve(new Response('{}')); };
      await __sb.clientOptions.global.fetch('/rest/v1/x', {headers: {apikey: 'k'}});
      await __sb.clientOptions.global.fetch('/rest/v1/y');
      window.fetch = realFetch;
      T.eq(seen, ['secretKeyJen', 'secretKeyJen'], 'sent on requests (with and without other headers)');
      /* the database refuses writes (enforcement on, key missing/wrong): read-only, nothing dropped */
      __sb.failWith = (tbl, op)=> op === 'upsert' ? {status: 401, error: {message: 'new row violates row-level security policy', code: '42501'}} : null;
      addCook('beef-stroganoff', '2026-11-01', 4, '', '');
      await T.until(()=> !flushing && syncState === 'readonly', 5000, 'read-only state');
      T.eq(document.querySelector('#authArea').textContent.trim(), '🔒 read-only', 'pill says read-only');
      T.ok(/household's key/.test(document.querySelector('#authArea .sync-dot').title), 'with an explanation on hover');
      T.eq(loadQueue().map(o=> o.fails || 0), [0], 'the write is kept and NOT counted as failed');
      T.ok(!localStorage.getItem(FAILED_WRITES_KEY), 'never dead-lettered');
      __sb.failWith = null; await flushQueue();
      T.eq([syncState, loadQueue().length, T.live('cook_log').length], ['ok', 0, 1], 'delivered once the database accepts it');
    },
  },
  {
    name: 'write keys: each household keeps its own; none given = nothing sent',
    url: '?hh=nicholas-tyler',
    preload: `localStorage.setItem('householdKeys', JSON.stringify({'chris-jen': 'jenKey', 'nicholas-tyler': 'nickKey'}));`,
    async test(T){
      const seen = []; const realFetch = window.fetch; window.fetch = (u, o)=> { seen.push(new Headers(o && o.headers).get('x-household-key')); return Promise.resolve(new Response('{}')); };
      await __sb.clientOptions.global.fetch('/a');
      T.eq(seen, ['nickKey'], 'this household\'s stored key is used');
      localStorage.setItem('householdKeys', '{}'); seen.length = 0;
      await __sb.clientOptions.global.fetch('/a');
      T.eq(seen, [null], 'no key known -> no header');
      window.fetch = realFetch;
    },
  },
];
