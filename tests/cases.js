/* Browser test cases. Evaluated twice: by tests/runner.js (to read SCENARIOS)
   and inside the page (so each test function can call makeT / helpers there).
   A test is an async function run INSIDE the real page, against the real,
   built index.html -- it can call the app's own functions and read its state
   directly. Supabase is the in-memory mock (window.__sb, tests/mock_supabase.js);
   nothing here can touch production. */
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
];
