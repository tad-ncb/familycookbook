/* Captured once, at the very first line of app logic to run -- true only when
   the page was LOADED with a #r/<id> hash already in the URL (i.e. someone
   followed a direct recipe link), never when a hash appears later because
   someone clicked a card while browsing. Drives the stripped-down "shared
   recipe" landing view -- see openModal() and the body.share-view CSS. */
const cameFromShareLink = /^#r\//.test(location.hash||'');
if(cameFromShareLink) document.body.classList.add('share-view');

/* ============================================================
   COMMITTED BASELINE  —  merged from exports and pushed to git.
   Live edits accumulate in localStorage and overlay this.
   ============================================================ */
const SEED_STATE = {
  "version": 1,
  "cookLog": [
    { "id": "seed-ctm-1", "recipeId": "chicken-tikka-masala", "date": "2026-08-23", "rating": 5, "note": "", "leftover": "", "household": "deemer-berdux", "_t": 1788264000000 }
  ],
  "plan": [],
  "inventory": { "items": [] },
  "prefs": {}
};

/* ---------------- state layer ---------------- */
const LS_KEY = 'cookbook.state.v1';
/* 'shopping' isn't a physical storage location -- it's reused as a kind so
   standalone/auto-added shopping-list entries ride the same synced table
   and CRUD helpers as the three real storage tiers. */
const INVENTORY_KINDS = ['pantry','fridge','freezer'];
function blankState(){ return {version:1, cookLog:[], plan:[], inventory:{items:[]}, interested:[], shoppingLists:[], prefs:{}}; }
/* Deletes are tombstones (_d) rather than removals, and every mutable record carries
   a _t stamp -- without both, a delete on one device is silently undone by the other. */
function newer(x, y){ return ((y && y._t)||0) >= ((x && x._t)||0) ? y : x; }
/* Browsers with localStorage saved before the multi-slot rewrite (2026-08-24)
   have DATA.plan as a dict keyed by iso-date instead of an array of slots --
   spreading a plain object throws (it's not iterable), which would otherwise
   crash the whole script before anything renders. Migrate it into the new
   shape instead of trusting the shape blindly. */
function normalizePlanArray(p){
  if(Array.isArray(p)) return p;
  if(p && typeof p === 'object'){
    return Object.keys(p).map(iso=>{
      const e = p[iso];
      if(!e) return null;
      return Object.assign({id:'legacy-'+iso, iso, mealType:'dinner'}, e);
    }).filter(Boolean);
  }
  return [];
}
/* same defensive migration for inventory: old shape was {freezer:[],pantry:[]}
   instead of a flat {items:[]}. */
function normalizeInventoryItems(inv){
  if(!inv || typeof inv !== 'object') return [];
  if(Array.isArray(inv.items)) return inv.items;
  const out = [];
  ['freezer','pantry'].forEach(kind=>{
    (Array.isArray(inv[kind]) ? inv[kind] : []).forEach(it=> out.push(Object.assign({kind}, it)));
  });
  return out;
}
function mergeStates(base, over){
  const m = new Map();
  [...(base.cookLog||[]), ...(over.cookLog||[])].forEach(e=>{
    if(!e || !e.id) return;
    const prev = m.get(e.id);
    m.set(e.id, prev ? newer(prev, e) : e);
  });
  /* plan is a flat array of meal slots (one day can hold several dishes
     across lunch/dinner), each with its own id -- merged the same way as
     cookLog/inventory rather than as one blob per day. */
  const pm = new Map();
  [...normalizePlanArray(base.plan), ...normalizePlanArray(over.plan)].forEach(e=>{
    if(!e || !e.id) return;
    const prev = pm.get(e.id);
    pm.set(e.id, prev ? newer(prev, e) : e);
  });
  const plan = [...pm.values()].filter(e=> !(e._d && (Date.now() - (e._t||0)) > 60*864e5));
  const im = new Map();
  [...normalizeInventoryItems(base.inventory), ...normalizeInventoryItems(over.inventory)].forEach(e=>{
    if(!e || !e.id) return;
    const prev = im.get(e.id);
    im.set(e.id, prev ? newer(prev, e) : e);
  });
  /* "Interested" shortlist: a recipe id is either interested or not, tombstoned
     the same way as cookLog/inventory so an un-star on one device isn't undone
     by a stale re-fetch from another. One row per recipe (id IS the recipe id,
     not a generated uid), same pattern as inventory items. */
  const ntm = new Map();
  [...(base.interested||[]), ...(over.interested||[])].forEach(e=>{
    if(!e || !e.id) return;
    const prev = ntm.get(e.id);
    ntm.set(e.id, prev ? newer(prev, e) : e);
  });
  /* Named shopping lists -- same tombstone pattern as everything else above,
     one row per list (id is a generated uid, not tied to any recipe). */
  const slm = new Map();
  [...(base.shoppingLists||[]), ...(over.shoppingLists||[])].forEach(e=>{
    if(!e || !e.id) return;
    const prev = slm.get(e.id);
    slm.set(e.id, prev ? newer(prev, e) : e);
  });
  const bp = base.prefs || {}, op = over.prefs || {};
  return {
    version: 1,
    cookLog: [...m.values()].sort((a,b)=> (b.date||'').localeCompare(a.date||'')),
    plan,
    inventory: {items: [...im.values()]},
    interested: [...ntm.values()],
    shoppingLists: [...slm.values()],
    prefs: ((op._t||0) >= (bp._t||0)) ? Object.assign({}, bp, op) : Object.assign({}, op, bp)
  };
}
function loadLocal(){ try{ const r=localStorage.getItem(LS_KEY); return r?JSON.parse(r):null; }catch(e){ return null; } }
let DATA = mergeStates(SEED_STATE, loadLocal() || blankState());
function persist(fromSync){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(DATA)); }catch(e){}
  if(!fromSync && typeof scheduleSync === 'function') scheduleSync();
}
function uid(){ return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

/* ---------------- households ---------------- */
/* Re-activated 2026-09-11 for a second real household ("berdux" / Jen and
   Chris) sharing this cookbook. No login, no code -- access control is
   just "don't send the wrong link to the wrong people," same trust model
   the rest of this app already uses. Each household gets its own URL
   (?hh=berdux vs. the bare URL / ?hh=deemer-berdux), remembered in
   localStorage after the first visit so it doesn't need to be in every
   link forever -- and it's changeable any time from Settings, in case a
   link gets reused on the wrong device.
   The old email-lookup switcher (HOUSEHOLD_MAP) and the cross-household
   "3x us / 2x them" cook-panel comparison were both removed rather than
   restored -- the former added a login-like step nobody wanted, the latter
   was confusing and nobody asked for it back. */
const HOUSEHOLD_LABEL = { 'deemer-berdux': 'Nick and Tyler', 'berdux': 'Jen and Chris' };
const HOUSEHOLD_STORAGE_KEY = 'household';
/* Deliberately returns null, never a guessed default, when neither signal
   is present -- a silent fallback here is exactly how one household's
   device could end up reading and writing into the other's meal plan/
   shopping list/pantry without anyone noticing. Callers that need a
   guaranteed value must go through resolveHousehold() below, which blocks
   on an explicit choice instead of guessing. */
function currentHousehold(){
  const fromUrl = new URLSearchParams(location.search).get('hh');
  if(fromUrl && HOUSEHOLD_LABEL[fromUrl]){
    try{ localStorage.setItem(HOUSEHOLD_STORAGE_KEY, fromUrl); }catch(e){}
    return fromUrl;
  }
  let stored;
  try{ stored = localStorage.getItem(HOUSEHOLD_STORAGE_KEY); }catch(e){}
  return (stored && HOUSEHOLD_LABEL[stored]) ? stored : null;
}
function setHousehold(hh){
  if(!HOUSEHOLD_LABEL[hh]) return;
  try{ localStorage.setItem(HOUSEHOLD_STORAGE_KEY, hh); }catch(e){}
  location.reload();
}
/* cook_log rows written before household scoping existed have no tag --
   they all belong to the original (only) household. */
function householdOf(e){ return e.household || 'deemer-berdux'; }

/* "Interested" -- a lightweight shortlist, distinct from cook history: for
   "does this look good while browsing", "maybe for the bring-a-side ask",
   or "not sure yet but a candidate for this week's plan" -- cases where you
   want to flag something before committing to actually cooking it. Shared
   between the two of you within a household (no per-person split), but NOT
   across households as of 2026-09-11 -- Tyler decided this and cook_log's
   ratings/last-made should behave oppositely: interested/hearts private
   per household, ratings/last-made visible across them. See migrations/
   002_interested_recipes_household_id.sql, remoteFetchAll, and runOp. */
function isInterested(id){ return DATA.interested.some(e=>e.id===id && !e._d); }
function toggleInterested(id){
  const on = !isInterested(id);
  const entry = {id, _d: !on, _t: Date.now()};
  DATA.interested = [...DATA.interested.filter(e=>e.id!==id), entry];
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'interested_recipes', row: entry});
}
function cookEvents(id){ return DATA.cookLog.filter(e=>e.recipeId===id && !e._d).sort((a,b)=>(b.date||'').localeCompare(a.date||'')); }
function cookEventsFor(id, household){ return cookEvents(id).filter(e=>householdOf(e)===household); }
function timesMade(id){ return cookEvents(id).length; }
function lastMade(id){ const e=cookEvents(id); return e.length ? e[0].date : null; }
function avgRating(id, household){
  const h = household || currentHousehold();
  const rs = cookEventsFor(id, h).map(e=>e.rating).filter(n=>typeof n==='number' && n>0);
  return rs.length ? rs.reduce((a,b)=>a+b,0)/rs.length : null;
}

/* ---------------- the other household's cook history (read-only) ---------------- */
/* Ratings and last-made ARE meant to be visible across households (unlike
   interested/plan/shopping/inventory) -- but always clearly attributed to
   whichever household they belong to, never blended into one number, and
   never touching DATA.cookLog (see remoteFetchAll's otherCookLog comment)
   so lastMade()/candidatesFor()'s "haven't made this in a while" planning
   logic stays scoped to your own household's cooking only. */
function otherHouseholdId(){ return Object.keys(HOUSEHOLD_LABEL).find(h=>h!==currentHousehold()); }
function otherCookEvents(id){
  return (DATA.otherCookLog||[]).filter(e=>e.recipeId===id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}
function otherTimesMade(id){ return otherCookEvents(id).length; }
function otherLastMade(id){ const e=otherCookEvents(id); return e.length ? e[0].date : null; }
function otherAvgRating(id){
  const rs = otherCookEvents(id).map(e=>e.rating).filter(n=>typeof n==='number' && n>0);
  return rs.length ? rs.reduce((a,b)=>a+b,0)/rs.length : null;
}
function addCook(recipeId, date, rating, note, leftover){
  const row = {id:uid(), recipeId, date, rating: rating||null, note: note||'', leftover: leftover||'', household: currentHousehold(), _t: Date.now()};
  DATA.cookLog.unshift(row);
  DATA.cookLog.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'cook_log', row});
}
function removeCook(evId){
  const e = DATA.cookLog.find(x=>x.id===evId);
  if(e){ e._d = true; e._t = Date.now(); }
  persist();
  if(e && typeof pushWrite === 'function') pushWrite({table:'cook_log', row:e});
}

function todayISO(){ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function daysSince(iso){
  if(!iso) return null;
  const a=new Date(iso+'T00:00:00'), b=new Date(todayISO()+'T00:00:00');
  return Math.round((b-a)/86400000);
}
function relTime(iso){
  const d = daysSince(iso);
  if(d===null) return '';
  if(d<=0) return 'today';
  if(d===1) return 'yesterday';
  if(d<7) return d+' days ago';
  if(d<14) return 'last week';
  if(d<61) return Math.round(d/7)+' weeks ago';
  if(d<365) return Math.round(d/30)+' months ago';
  const y=Math.round(d/365); return y===1?'a year ago':y+' years ago';
}

/* ---------------- formatting helpers ---------------- */
/* Some scraped/imported recipe text (curated and archive alike -- archive
   text lives in Supabase, not visible to grep here, so this can't be fixed
   by patching a few known strings) already contains literal HTML entities
   like "&amp;" instead of a bare "&". Escaping that again turns it into
   "&amp;amp;", which the browser then displays as the literal text
   "&amp;" on screen. Decoding the handful of entities escapeHTML itself
   produces, before re-escaping, makes this idempotent regardless of
   whether the source already contains a literal "&" or an escaped one. */
function escapeHTML(s){
  const unescaped = String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  return unescaped.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
/* zero-width space after slashes -> lets long titles/cuisines wrap without a visible gap */
function zwsp(s){ return String(s).replace(/\/(?!​)/g, '/​'); }
function renderInline(s){
  let out = zwsp(escapeHTML(s)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  /* zwsp() already broke every URL's slashes apart with zero-width spaces for
     wrapping (e.g. "Original recipe: https://.../ndujachicken/") -- match that
     exact broken-up shape, strip the zero-width spaces back out for a working
     href, but keep them in the visible text so the link still wraps. Markdown
     links ("[NYT Link](url)") and bare URLs are handled in ONE pass -- doing
     them as two separate regexes let the bare-URL rule re-match a URL that
     was already consumed into a markdown link's href, corrupting it. */
  const urlPat = 'https?:\\/​?\\/​?[^\\s<)]+';
  const linkRe = new RegExp('\\[([^\\]]+)\\]\\((' + urlPat + ')\\)|(' + urlPat + ')', 'g');
  out = out.replace(linkRe, (m, mdText, mdUrl, bareUrl) => {
    const url = (mdUrl || bareUrl).replace(/​/g, '');
    const text = mdText || bareUrl;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  return out;
}
/* dishes with a native-language name and an English one show both, e.g.
   "Pasteis de Nata (Custard Tarts, Belem Style)" -- everywhere else falls
   back to the existing shortTitle/title behavior unchanged. */
function combinedTitle(r){ return r.nativeName ? (r.nativeName + ' (' + r.title + ')') : null; }
/* small words (articles/conjunctions/short prepositions) read better lowercase
   mid-title -- "Chicken with Roquefort", not "Chicken With Roquefort" -- but
   never touch the first word, and never touch a word that isn't in simple
   Capitalized form (leaves ALL-CAPS acronyms like "BBQ" alone). */
const TITLE_MINOR_WORDS = new Set(['a','an','and','as','at','but','by','for','from','if','in',
  'into','near','nor','of','off','on','onto','or','over','per','so','than','the','to','up','via','vs','with','yet']);
function smartTitleCase(title){
  if(!title) return title;
  return title.split(' ').map((w,i)=>{
    if(i===0) return w;
    const lower = w.toLowerCase();
    return (TITLE_MINOR_WORDS.has(lower) && /^[A-Z][a-z']*$/.test(w)) ? lower : w;
  }).join(' ');
}
function displayTitle(r){ return smartTitleCase(combinedTitle(r) || r.shortTitle || r.title); }

/* ---------------- time parsing ---------------- */
function roundUp5(n){ return Math.ceil(n/5)*5; }
function parseTime(str){
  if(!str) return null;
  const s = String(str).toLowerCase();
  let qual = null;
  if(/\b(under|less than|up to)\b/.test(s)) qual = 'under';
  else if(/\b(at least|minimum|overnight)\b/.test(s) || /\bplus\b/.test(s)) qual = 'atleast';
  const rng = s.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)/);
  if(rng){
    const mult = /^h/.test(rng[3]) ? 60 : 1;
    return {min: parseFloat(rng[1])*mult, max: parseFloat(rng[2])*mult, qual, raw:str};
  }
  let total = 0, found = false;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?)\b/);  if(h){ total += parseFloat(h[1])*60; found = true; }
  const m = s.match(/(\d+(?:\.\d+)?)\s*(minutes?|mins?)\b/); if(m){ total += parseFloat(m[1]);    found = true; }
  if(!found){ const n = s.match(/(\d+(?:\.\d+)?)/); if(n){ total = parseFloat(n[1]); found = true; } }
  if(!found) return null;
  return {min: total, max: total, qual, raw: str};
}
function fmtDur(mins){
  mins = Math.max(0, Math.round(mins));
  if(mins < 60) return mins + ' min';
  const h = Math.floor(mins/60), m = mins % 60;
  return m ? h + ' hr ' + m + ' min' : h + ' hr';
}
function fmtTime(t){
  if(!t) return '';
  const lo = roundUp5(t.min), hi = roundUp5(t.max);
  if(t.qual === 'under')   return '≤' + fmtDur(hi);
  if(t.qual === 'atleast') return fmtDur(lo) + '+';
  if(lo !== hi) return (hi < 60) ? (lo + '–' + hi + ' min') : (fmtDur(lo) + '–' + fmtDur(hi));
  return fmtDur(lo);
}
function totalTime(r){
  const p = parseTime(r.prepTime), c = parseTime(r.cookTime);
  if(!p && !c) return parseTime(r.totalTime); /* no prep/cook split known (e.g. bulk NYT import) -- fall back to the raw total */
  const min = (p?p.min:0) + (c?c.min:0);
  const max = (p?p.max:0) + (c?c.max:0);
  const qual = ((p&&p.qual==='atleast')||(c&&c.qual==='atleast')) ? 'atleast'
             : ((p&&p.qual==='under')||(c&&c.qual==='under')) ? 'under' : null;
  return {min, max, qual};
}
function planMinutes(r){ const t = totalTime(r); return t ? roundUp5(t.max) : null; }

/* ---------------- plan-ahead detection ---------------- */
const AHEAD_RULES = [
  [/\bovernight\b/i,                                   'Overnight',   12*60],
  [/\bthaw(ed|ing)?\b/i,                               'Thaw ahead',  12*60],
  [/\b(the )?(day|night) before\b/i,                   'Day before',  12*60],
  [/\bnext day\b/i,                                    'Day before',  12*60],
  [/\b(marinate|marinating)\b/i,                       'Marinate',     4*60],
  [/\b(refrigerate|chill|rest|rise|soak|brine)[^.]{0,60}?(\d+)\s*(?:to\s*\d+\s*)?hours?/i, 'Plan ahead', 0],
  [/\bat least (\d+)\s*hours?\b/i,                     'Plan ahead',   0]
];
/* Sentences about keeping leftovers mention the same words ("refrigerator for 24 hours")
   but say nothing about starting early -- exclude them before matching. */
const STORAGE_RE = /\b(stor(e|ed|es|age)|leftovers?|keeps?|will keep|freezes?|freezer for|for up to|lasts?)\b/i;
function detectAhead(r){
  const hay = [r.prepTime, r.cookTime, r.notes||'', ...(r.instructions||[])].join(' \n ');
  const sentences = hay.split(/(?<=[.!?])\s+|\n/).filter(s=> s && !STORAGE_RE.test(s));
  for(const [re, label, mins] of AHEAD_RULES){
    for(const sentence of sentences){
      const m = sentence.match(re);
      if(!m) continue;
      let minutes = mins;
      if(!minutes){
        const num = m.slice(1).map(x=>parseFloat(x)).find(x=>!isNaN(x));
        minutes = (num || 2) * 60;
      }
      if(minutes >= 120) return {label, minutes};
    }
  }
  return null;
}

/* ---------------- servings + scaling ---------------- */
function parseServings(s){
  const str = String(s===undefined||s===null ? '' : s).trim();
  if(!str) return null;
  const m = str.match(/(\d+)/);
  if(!m) return null;
  const servingWord  = /servings?\b/i.test(str);
  const pureNum      = /^\d+\s*(?:(?:-|–|to)\s*\d+)?$/i.test(str);
  const servesPrefix = /^serves\b/i.test(str);
  /* only a real serving count drives the +/- stepper; "Makes 2 cups",
     "16-18 cookies" and "Two 12-inch pizzas" get multipliers only. */
  const servingBased = pureNum || servesPrefix || servingWord;
  let base = parseInt(m[1],10);
  if(servingWord){ const sm = str.match(/(\d+)\s*servings?/i); if(sm) base = parseInt(sm[1],10); }
  return { base, servingBased, raw: str };
}
function parseQty(tok){
  tok = tok.trim();
  let m = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/); if(m) return +m[1] + (+m[2]/+m[3]);
  m = tok.match(/^(\d+)\/(\d+)$/);             if(m) return +m[1]/+m[2];
  return parseFloat(tok);
}
function fmtNum(n, integerOnly){
  if(!isFinite(n)) return '';
  if(integerOnly) return String(n < 1 ? Math.round(n*10)/10 : Math.round(n));
  if(n >= 10) return String(Math.round(n));
  if(Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
  const whole = Math.floor(n), frac = n - whole;
  const cands = [[1,2],[1,3],[2,3],[1,4],[3,4],[1,8],[3,8],[5,8],[7,8],[1,6],[5,6]];
  let best=null, bd=1;
  cands.forEach(([a,b])=>{ const d=Math.abs(frac-a/b); if(d<bd){ bd=d; best=[a,b]; } });
  if(bd < 0.045) return (whole ? whole+' ' : '') + best[0]+'/'+best[1];
  return String(Math.round(n*100)/100);
}
const NOSCALE_PHRASE = /\b(to taste|for serving|for garnish|for greasing|for frying|for dusting|for sprinkling|for brushing|for the top|for cooking|cooking spray|as needed|serving suggestion)\b/i;
const SEASONING_HEAD = /^(kosher |sea |flaky |fine |coarse |table |freshly ground |freshly cracked |ground |cracked )*(salt|black pepper|white pepper|pepper)\b/i;
/* Seasonings don't scale linearly. Test the HEAD NOUN, not the whole line -- otherwise
   a product name like "Tomato Paste, No Salt Added" gets wrongly frozen. */
function isNoScale(line){
  if(NOSCALE_PHRASE.test(line)) return true;
  const rest = line
    .replace(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*[A-Za-z]*\.?\s*/, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  return SEASONING_HEAD.test(rest);
}
const UNIT_RE = /^(lbs?|pounds?|oz|ounces?|g|kg|ml|l|liters?|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|sprigs?|slices?|bunch|bunches|inch|quarts?|pints?|sticks?)\b/i;
const METRIC_RE = /^\s*(g|kg|ml|l)\b/i;
/* units that inflect in English; metric abbreviations and Tbsp/tsp never do */
const PLURALS = [['cups','cup'],['lbs','lb'],['pounds','pound'],['ounces','ounce'],['cloves','clove'],
                 ['sprigs','sprig'],['slices','slice'],['cans','can'],['sticks','stick'],
                 ['tablespoons','tablespoon'],['teaspoons','teaspoon'],['quarts','quart'],['pints','pint']];
function inflect(unit, qty){
  if(!unit) return unit;
  const plural = qty > 1;
  for(const [p,s] of PLURALS){
    if(unit.toLowerCase()===p) return plural ? unit : matchCase(unit, s);
    if(unit.toLowerCase()===s) return plural ? matchCase(unit, p) : unit;
  }
  return unit;
}
function matchCase(src, out){ return /^[A-Z]/.test(src) ? out.charAt(0).toUpperCase()+out.slice(1) : out; }
function scaleLine(line, f){
  if(f === 1) return {text: line, unscaled: false};
  if(isNoScale(line)) return {text: line, unscaled: true};
  const lead = line.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(\s*)([A-Za-z]*)/);
  if(!lead) return {text: line, unscaled: false};
  const hasUnit = UNIT_RE.test(lead[3]);
  const qty = parseQty(lead[1]) * f;
  const metricLead = METRIC_RE.test(lead[3]);
  let out = fmtNum(qty, metricLead) + lead[2] + inflect(lead[3], qty) + line.slice(lead[0].length);
  if(hasUnit){
    /* the first parenthetical is a unit conversion of the leading qty -> scale it too.
       a bare count like "1 (14 oz/400 g) can" has no unit, so its package size is left alone. */
    out = out.replace(/\(([^)]*)\)/, (whole, inner)=>{
      if(!/\d/.test(inner)) return whole;
      const scaled = inner.replace(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(\s*[A-Za-z]*)/g, (mm, num, tail)=>{
        const v = parseQty(num) * f;
        return fmtNum(v, METRIC_RE.test(tail)) + (tail ? tail.replace(/[A-Za-z]+$/, u=>inflect(u, v)) : '');
      });
      return '(' + scaled + ')';
    });
  }
  return {text: out, unscaled: false};
}
function servingsLabel(s){
  const str = String(s);
  return /^(makes|serves)\b/i.test(str) ? str : 'Serves ' + str;
}

/* ---------------- rough per-serving macro estimate ---------------- */
/* Deliberately a heuristic, same spirit as the rest of this file's
   estimates (weight/time guesses) -- ingredient text is matched against a
   ~50-entry keyword table of per-100g macros, quantities are converted to
   grams via generic (not ingredient-specific) unit weights, and the whole
   thing is skipped rather than shown if too little of the recipe's mass
   could be matched. This is nutrition-label-adjacent, not nutrition-label
   accurate -- no ingredient database or API involved, just enough to say
   "roughly a 600-calorie dinner" at a glance. */
const UNIT_GRAMS = {
  g:1, gram:1, grams:1, kg:1000, ml:1, milliliter:1, milliliters:1, l:1000, liter:1000, liters:1000,
  oz:28, ounce:28, ounces:28, lb:454, lbs:454, pound:454, pounds:454,
  cup:225, cups:225, tbsp:15, tablespoon:15, tablespoons:15, tsp:5, teaspoon:5, teaspoons:5,
  clove:3, cloves:3, stick:113, sticks:113, can:400, cans:400
};
const UNIT_GRAMS_NO_UNIT = 50; /* bare counts: "2 eggs", "1 onion", "3 tortillas" */
const MACRO_KEYWORD_RULES = [
  [/chicken breast/i, {kcal:165, protein:31, carbs:0, fat:3.6}],
  [/chicken thigh|\bchicken\b/i, {kcal:220, protein:26, carbs:0, fat:12}],
  [/ground beef|\bbeef\b|steak/i, {kcal:250, protein:26, carbs:0, fat:17}],
  [/ground turkey|\bturkey\b/i, {kcal:150, protein:24, carbs:0, fat:7}],
  [/\bpork\b/i, {kcal:242, protein:27, carbs:0, fat:14}],
  [/\bbacon\b/i, {kcal:541, protein:37, carbs:1.4, fat:42}],
  [/sausage|chorizo/i, {kcal:300, protein:15, carbs:2, fat:26}],
  [/\blamb\b/i, {kcal:294, protein:25, carbs:0, fat:21}],
  [/\bduck\b/i, {kcal:337, protein:19, carbs:0, fat:28}],
  [/salmon/i, {kcal:208, protein:20, carbs:0, fat:13}],
  [/shrimp|prawn/i, {kcal:99, protein:24, carbs:0.2, fat:0.3}],
  [/\btuna\b/i, {kcal:132, protein:28, carbs:0, fat:1}],
  [/\bfish\b|cod|tilapia|halibut/i, {kcal:105, protein:23, carbs:0, fat:1}],
  [/\begg\b|\beggs\b/i, {kcal:143, protein:13, carbs:1.1, fat:10}],
  [/\btofu\b/i, {kcal:76, protein:8, carbs:1.9, fat:4.8}],
  [/black beans|kidney beans|\bbeans?\b|chickpea|lentil/i, {kcal:130, protein:9, carbs:22, fat:0.5}],
  [/\bbutter\b/i, {kcal:717, protein:0.9, carbs:0.1, fat:81}],
  [/olive oil|vegetable oil|canola oil|sesame oil|\boil\b/i, {kcal:884, protein:0, carbs:0, fat:100}],
  [/heavy cream/i, {kcal:340, protein:2.1, carbs:2.8, fat:36}],
  [/sour cream/i, {kcal:198, protein:2.4, carbs:4.6, fat:20}],
  [/cream cheese/i, {kcal:342, protein:6, carbs:4, fat:34}],
  [/\bcream\b/i, {kcal:340, protein:2.1, carbs:2.8, fat:36}],
  [/parmesan|parmigiano|grana padano|pecorino/i, {kcal:431, protein:38, carbs:4, fat:29}],
  [/mozzarella|cheddar|\bfeta\b|ricotta|\bcheese\b/i, {kcal:350, protein:23, carbs:2.5, fat:28}],
  [/whole milk|\bmilk\b|buttermilk/i, {kcal:61, protein:3.2, carbs:4.8, fat:3.3}],
  [/yogurt|yoghurt/i, {kcal:59, protein:10, carbs:3.6, fat:0.4}],
  [/white rice|\brice\b/i, {kcal:130, protein:2.7, carbs:28, fat:0.3}],
  [/brown rice/i, {kcal:112, protein:2.6, carbs:24, fat:0.9}],
  [/pasta|spaghetti|noodle|orzo|macaroni/i, {kcal:158, protein:5.8, carbs:31, fat:0.9}],
  [/quinoa/i, {kcal:120, protein:4.4, carbs:21, fat:1.9}],
  [/\boats?\b|oatmeal/i, {kcal:389, protein:17, carbs:66, fat:7}],
  [/\bbread\b/i, {kcal:265, protein:9, carbs:49, fat:3.2}],
  [/tortilla/i, {kcal:218, protein:5.7, carbs:36, fat:5.4}],
  [/all-purpose flour|\bflour\b/i, {kcal:364, protein:10, carbs:76, fat:1}],
  [/brown sugar/i, {kcal:380, protein:0, carbs:98, fat:0}],
  [/\bsugar\b/i, {kcal:387, protein:0, carbs:100, fat:0}],
  [/\bhoney\b/i, {kcal:304, protein:0.3, carbs:82, fat:0}],
  [/maple syrup/i, {kcal:260, protein:0, carbs:67, fat:0.2}],
  [/sweet potato(es)?/i, {kcal:86, protein:1.6, carbs:20, fat:0.1}],
  [/\bpotato(es)?\b/i, {kcal:77, protein:2, carbs:17, fat:0.1}],
  [/\bonions?\b|\bshallots?\b|\bscallions?\b|\bleeks?\b/i, {kcal:40, protein:1.1, carbs:9.3, fat:0.1}],
  [/\bginger\b/i, {kcal:80, protein:1.8, carbs:18, fat:0.8}],
  [/\bgarlic\b/i, {kcal:149, protein:6.4, carbs:33, fat:0.5}],
  [/\bcarrot/i, {kcal:41, protein:0.9, carbs:10, fat:0.2}],
  [/\btomato/i, {kcal:18, protein:0.9, carbs:3.9, fat:0.2}],
  [/bell pepper|\bpepper\b(?!corn)/i, {kcal:31, protein:1, carbs:6, fat:0.3}],
  [/broccoli/i, {kcal:34, protein:2.8, carbs:7, fat:0.4}],
  [/brussels sprout/i, {kcal:43, protein:3.4, carbs:9, fat:0.3}],
  [/\bzucchini\b|courgette/i, {kcal:17, protein:1.2, carbs:3.1, fat:0.3}],
  [/\bceler(y|iac)\b/i, {kcal:16, protein:0.7, carbs:3, fat:0.2}],
  [/spinach/i, {kcal:23, protein:2.9, carbs:3.6, fat:0.4}],
  [/lettuce|\bgreens\b|\bkale\b|cabbage/i, {kcal:20, protein:1.6, carbs:4, fat:0.2}],
  [/mushroom/i, {kcal:22, protein:3.1, carbs:3.3, fat:0.3}],
  [/avocado/i, {kcal:160, protein:2, carbs:8.5, fat:15}],
  [/almond|walnut|pecan|cashew|pistachio|\bnuts?\b/i, {kcal:600, protein:20, carbs:20, fat:52}],
  [/sesame seeds?/i, {kcal:573, protein:17, carbs:23, fat:50}],
  [/peanut butter/i, {kcal:588, protein:25, carbs:20, fat:50}],
  [/coconut milk/i, {kcal:230, protein:2.3, carbs:6, fat:24}],
  [/\bapple\b/i, {kcal:52, protein:0.3, carbs:14, fat:0.2}],
  [/\bbanana\b/i, {kcal:89, protein:1.1, carbs:23, fat:0.3}],
  [/lemon|lime/i, {kcal:29, protein:1.1, carbs:9.3, fat:0.3}],
  [/\borange\b/i, {kcal:47, protein:0.9, carbs:12, fat:0.1}],
  [/soy sauce/i, {kcal:53, protein:8, carbs:4.9, fat:0.1}],
  [/oyster sauce/i, {kcal:51, protein:1.4, carbs:11, fat:0.3}],
  [/worcestershire/i, {kcal:78, protein:0, carbs:19, fat:0}],
  [/dijon|\bmustard\b/i, {kcal:66, protein:4, carbs:5, fat:4}],
  [/\bmirin\b/i, {kcal:225, protein:0.3, carbs:49, fat:0}],
  [/ketchup/i, {kcal:112, protein:1.2, carbs:27, fat:0.3}],
  [/mayonnaise/i, {kcal:680, protein:1, carbs:1, fat:75}],
  [/\bstock\b|\bbroth\b/i, {kcal:8, protein:1.2, carbs:0.7, fat:0.2}],
  [/white wine|red wine|dry wine/i, {kcal:82, protein:0.1, carbs:2.6, fat:0}],
  [/\bbeer\b/i, {kcal:43, protein:0.5, carbs:3.6, fat:0}],
  /* From here down: explicit near-zero entries. These exist to fix the
     matched/total COVERAGE ratio below, not because they move the calorie
     total -- salt/water/dried herbs & spices at typical recipe quantities
     contribute negligible calories either way, but left unmatched they
     were dragging otherwise-well-covered recipes under the 35% threshold. */
  [/\bsalt\b/i, {kcal:0, protein:0, carbs:0, fat:0}],
  [/\bwater\b/i, {kcal:0, protein:0, carbs:0, fat:0}],
  [/black pepper|peppercorn/i, {kcal:0, protein:0, carbs:0, fat:0}],
  [/baking (powder|soda)/i, {kcal:0, protein:0, carbs:0, fat:0}],
  [/\bcornstarch\b/i, {kcal:381, protein:0.3, carbs:91, fat:0.1}],
  [/vanilla (extract|paste|bean)/i, {kcal:288, protein:0.1, carbs:13, fat:0.1}],
  [/vinegar/i, {kcal:19, protein:0, carbs:0.4, fat:0}],
  [/cinnamon|cumin|paprika|oregano|turmeric|coriander|nutmeg|allspice|chili (flakes|powder)|curry powder|bay leaves?|\bthyme\b|rosemary|\bsage\b|\bdill\b|\bbasil\b|parsley|cilantro|\bmint\b|red pepper flakes|\byeast\b|cream of tartar/i, {kcal:0, protein:0, carbs:0, fat:0}]
];
/* Many ingredient lines in this dataset already carry a metric conversion
   in parentheses -- "2-4 lbs (910 g-1.8 kg) chicken", "6 tsp (30 ml)
   turmeric" -- which is both more precise than the generic UNIT_GRAMS table
   (a cup of flour and a cup of milk don't weigh the same, but the recipe's
   own author already did that conversion per ingredient) and immune to the
   leading-quantity regex's range problem below (ranges average cleanly).
   Preferred over the generic table whenever present. */
function parenGrams(line){
  const m = line.match(/\(([^)]*)\)/);
  if(!m) return null;
  const nums = [...m[1].matchAll(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\b/gi)];
  if(!nums.length) return null;
  const vals = nums.map(mm=>{
    const v = parseFloat(mm[1]), u = mm[2].toLowerCase();
    return (u==='kg'||u==='l') ? v*1000 : v;
  });
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
/* _servings.base is the recipe's as-written low end of a range (e.g. "6-8"
   -> 6), which is correct for the +/- stepper's starting point but would
   understate the true serving count for macro math, inflating per-serving
   calories. Use the range's midpoint here instead, independent of the
   stepper's base. */
function macroServingBase(r){
  const str = String(r.servings||'').trim();
  const m = str.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i);
  if(m) return (parseFloat(m[1])+parseFloat(m[2]))/2;
  return r._servings && r._servings.base;
}
function estimateMacros(r){
  const base = macroServingBase(r);
  if(!base) return null;
  let kcal=0, protein=0, carbs=0, fat=0, matchedGrams=0, totalGrams=0;
  (r.ingredients||[]).forEach(line=>{
    if(!line || line.trim().endsWith(':')) return;
    if(isNoScale(line)) return;
    let grams = parenGrams(line);
    const lead = line.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(\s*)([A-Za-z]*)/);
    if(grams != null){
      /* use it as-is */
    } else if(lead && parseQty(lead[1])){
      const unit = lead[3].toLowerCase().replace(/\.$/,'');
      const perUnit = UNIT_GRAMS[unit];
      grams = parseQty(lead[1]) * (perUnit!==undefined ? perUnit : UNIT_GRAMS_NO_UNIT);
    } else {
      grams = UNIT_GRAMS_NO_UNIT;
    }
    totalGrams += grams;
    const rule = MACRO_KEYWORD_RULES.find(([re])=> re.test(line));
    if(rule){
      const m = rule[1];
      kcal += grams/100*m.kcal; protein += grams/100*m.protein;
      carbs += grams/100*m.carbs; fat += grams/100*m.fat;
      matchedGrams += grams;
    }
  });
  /* Under a third of the recipe's estimated mass identified -> too little
     signal to put a number in front of someone. Silence, not a bad guess. */
  if(totalGrams < 10 || matchedGrams/totalGrams < 0.35) return null;
  return {
    kcal: Math.round(kcal/base), protein: Math.round(protein/base),
    carbs: Math.round(carbs/base), fat: Math.round(fat/base)
  };
}
/* r._macros is precomputed at load for the curated set (see the RECIPES
   forEach below); archive rows instead carry the same numbers as flat
   kcal/protein/carbs/fat columns fetched straight from nyt_recipes (see
   NYT_LITE_COLUMNS + migrations/004-005) -- recipeMacros() normalizes
   either shape to one object so callers don't need to care which. */
function recipeMacros(r){
  if(r._macros) return r._macros;
  if(r.kcal!=null) return {kcal:r.kcal, protein:r.protein, carbs:r.carbs, fat:r.fat};
  return null;
}
function macrosLabel(r){
  const m = recipeMacros(r);
  return m ? `≈${m.kcal} cal per serving · ${m.protein}g protein · ${m.carbs}g carbs · ${m.fat}g fat (estimated)` : '—';
}

/* ---------------- derived index ---------------- */
RECIPES.forEach(r=>{
  r._ahead    = detectAhead(r);
  r._servings = parseServings(r.servings);
  r._total    = totalTime(r);
  r._plan     = planMinutes(r);
  r._macros   = estimateMacros(r);
});

/* ---------------- app state ---------------- */
/* "Which databases of recipes are in play" is one unified set of 5 source
   tiers now, not a separate "include the archive at all" switch plus a
   second "hide within it" filter -- Curated (the ~955 baked into the page)
   sits alongside NYT Cooking / Epicurious / Other recipe sites (RecipeNLG:
   Food.com, food52, Gordon Ramsay, etc.) / BBC Good Food as 5 equal,
   independently-toggleable buttons. Curated starts on (instant, zero
   network cost); the other 4 start off (each is a real tens-of-thousands-
   row fetch/filter cost) until asked for. Deliberately NOT remembered
   across visits (no localStorage) -- every fresh load/refresh starts back
   at curated-only, and pulling in more is a per-visit opt-in, not a sticky
   preference (this was an explicit correction after an earlier version
   persisted it). */
const CURATED_TIER = 'Curated';
const ARCHIVE_SOURCE_LABELS = [CURATED_TIER, 'NYT Cooking', 'Epicurious', 'Other recipe sites', 'BBC Good Food'];
function archiveSourceOf(r){
  if(!r._fromArchive) return CURATED_TIER;
  const id = r.id || '';
  if(id.startsWith('rnlg-')) return 'Other recipe sites';
  if(id.startsWith('epi-')) return 'Epicurious';
  if(id.startsWith('bbcgf-')) return 'BBC Good Food';
  if(r.source === 'NYT Cooking') return 'NYT Cooking';
  return 'Other recipe sites';
}
let enabledSources = [CURATED_TIER];
/* Approximate row counts for the 4 archive source buttons -- declared here
   (not down by loadArchiveSourceCounts/toggleSource where it's used) because
   the very first boot render() call happens before that point in the file,
   and a `let` is in its temporal dead zone until its declaration line
   actually runs -- syncToolbar() reading this too early threw a
   ReferenceError that silently aborted that whole render() call, which is
   what broke the author/cuisine dropdowns, the sync-status display, and
   card click wiring all at once (everything after that point in the boot
   sequence never ran). */
let archiveSourceCounts = {};
/* Each of the 4 archive sources fetches independently now, not as one
   shared ~60k-row pull -- turning on just NYT (~19k rows) used to also
   download Epicurious/BBC/Other (adding up to the full ~60k) since they
   all shared one bulk fetch, which is what made a single button take 37
   seconds. archiveFetchedSources tracks which ones have been individually
   fetched so re-toggling a source that's already loaded is just a filter
   change, same as before. */
let archiveFetchedSources = new Set();
/* Precomputed + indexed server-side (see add_archive_source_column.sql) --
   was a mix of `source = '...'` and `id LIKE 'prefix-%'`, the latter unable
   to use a normal index (forces a sequential table scan). BBC in
   particular was consistently the slowest of the 4 buttons despite having
   the fewest rows, because a sequential scan wastes proportionally more
   work finding its ~2%-of-the-table share than NYT's ~32% share. An
   indexed equality lookup makes every source equally fast regardless of
   its size. */
const ARCHIVE_SOURCE_FILTERS = {
  'NYT Cooking': q => q.eq('archive_source', 'nyt'),
  'Epicurious': q => q.eq('archive_source', 'epicurious'),
  'BBC Good Food': q => q.eq('archive_source', 'bbc'),
  'Other recipe sites': q => q.eq('archive_source', 'other'),
};
let archiveLoading = false;
/* Which specific source is currently mid-fetch, if any -- syncToolbar used
   to show "Loading…" on every ENABLED source whenever archiveLoading was
   true (not just the one actually fetching), which is why an already-
   loaded, already-toggled-on source would randomly flash "Loading…" while
   a completely different button was fetching. */
let currentlyLoadingSource = null;
let state = { query:"", category:null, cuisine:null, diets:[], author:null, sort:"top", sortDir:1, made:"all", aheadOnly:false, includeIngredients:[], excludeIngredients:[] };
const COURSE_ORDER = ["Appetizer","Salad","Soup","Bread","Side","Main","Dessert","Breakfast","Drink"];
const STALE_DAYS = 75;   /* "had it, but not in 2-3 months" */

function uniqueSorted(arr){ return [...new Set(arr)].sort((a,b)=>a.localeCompare(b)); }
function orderByList(values, order){
  const set = new Set(values);
  const known = order.filter(v=>set.has(v));
  const unknown = [...set].filter(v=>!order.includes(v)).sort((a,b)=>a.localeCompare(b));
  return [...known, ...unknown];
}
const ALL_CATEGORIES = orderByList(RECIPES.map(r=>r.category), COURSE_ORDER);
const ALL_CUISINES   = uniqueSorted(RECIPES.map(r=>r.cuisine));
/* Diet is computed from actual ingredients (ingredientDietary), not trusted
   from NYT's own scraped tags -- cross-checking those against ingredients
   turned up ~1,453 recipes (8%) where the tag flatly contradicted what's in
   the recipe (e.g. "Vegetarian" halibut, "Vegan" pizza with cheese). A recipe
   with no ingredientDietary hits for a category defaults to compliant, same
   blind spot as any ingredient-derived check -- an untagged/long-tail
   ingredient could in principle be missed -- but that's a much smaller and
   more honest failure mode than trusting a label that's already known wrong
   8% of the time. */
const MEAT_SEAFOOD_DIETARY_TAGS = ['poultry','beef','pork','lamb','fish','shellfish','game'];
const DIET_DEFINITIONS = {
  'Vegetarian':  r => !(r.ingredientDietary||[]).some(t=>MEAT_SEAFOOD_DIETARY_TAGS.includes(t)),
  'Vegan':       r => !(r.ingredientDietary||[]).some(t=>MEAT_SEAFOOD_DIETARY_TAGS.includes(t) || t==='dairy' || t==='egg'),
  'Gluten Free': r => !(r.ingredientDietary||[]).includes('gluten'),
  'Dairy Free':  r => !(r.ingredientDietary||[]).includes('dairy'),
};
function recipeDietTags(r){ return Object.keys(DIET_DEFINITIONS).filter(d=>DIET_DEFINITIONS[d](r)); }
const ALL_DIETS = Object.keys(DIET_DEFINITIONS);
const DIET_ABBREV = {Vegetarian:'V', Vegan:'VG', 'Gluten Free':'GF', 'Dairy Free':'DF'};
function countFor(field, value){ return RECIPES.filter(r=>matchesFiltersExcept(r, field) && r[field]===value).length; }
function countForTag(tag){ return RECIPES.filter(r=>matchesFiltersExcept(r, 'diet') && recipeDietTags(r).includes(tag)).length; }

/* ---------------- ingredient include/exclude filter ----------------
   ingredientCore  = the recipe's actual named ingredients/proteins (e.g.
                      "chicken breast" counts, but "chicken broth" does not --
                      broths/stocks/sauces/fats are derivatives, not the thing
                      itself). Used for "must include X".
   ingredientAll   = every ingredient the recipe touches in any form,
                      derivatives included. Used for "must NOT include X" --
                      excluding "mushroom" should also catch mushroom broth.
   ingredientDietary = allergen/diet category tags (dairy, gluten, shellfish,
                      poultry, etc.), also derivative-inclusive, for exclusions
                      like "no dairy" that should match butter/milk/cheese/etc.
                      as a group rather than requiring the literal word "dairy".

   Options lists are computed fresh (not cached) since the NYT recipes merge
   into RECIPES asynchronously after first paint -- same pattern as
   computeAllAuthors() above. */
function computeIncludeIngredientOptions(){
  const set = new Set();
  RECIPES.forEach(r=>(r.ingredientCore||[]).forEach(x=>set.add(x)));
  return [...set].sort((a,b)=>a.localeCompare(b));
}
function computeExcludeIngredientOptions(){
  const set = new Set();
  RECIPES.forEach(r=>{
    (r.ingredientAll||[]).forEach(x=>set.add(x));
    (r.ingredientDietary||[]).forEach(x=>set.add(x));
  });
  return [...set].sort((a,b)=>a.localeCompare(b));
}
const DIETARY_TAG_SET = new Set(['dairy','egg','gluten','alcohol','poultry','tree nut','shellfish','soy','fish','pork','beef','peanut','lamb']);
function ingredientOptionLabel(value){
  return DIETARY_TAG_SET.has(value) ? `${value} (any form)` : value;
}
function passesIngredientFilters(r){
  const core = r.ingredientCore || [];
  const all = r.ingredientAll || [];
  const dietary = r.ingredientDietary || [];
  const includeOk = state.includeIngredients.every(tag=>core.includes(tag));
  const excludeOk = !state.excludeIngredients.some(tag=>all.includes(tag) || dietary.includes(tag));
  return includeOk && excludeOk;
}

/* ---------------- author/cookbook filter ---------------- */
/* Named-author and named-book/site sources were normalized (2026-09-02) so each
   one starts with a stable prefix -- Ina Garten has several distinct books, all
   still prefixed "Ina Garten," so they group under one filter value. Anything
   with NO identifiable book/author/site (plain "Cookbook photo", handwritten
   cards, "Family recipe", etc.) falls into "Individual/Unknown". NYT Cooking
   gets its own dedicated bucket (matched via the tag, not source prefix) rather
   than being excluded -- it's just one more option here, on top of its separate
   "Hide NYT" toggle. */
const AUTHOR_GROUPS = [
  // named people
  ['Kalaya (Nok Suntaranon)', 'Kalaya (Nok Suntaranon)'],
  ['Jet Tila', 'Jet Tila'],
  ['Ina Garten', 'Ina Garten'],
  ['Molly Baz', 'Molly Baz'],
  ['Meera Sodha', 'Meera Sodha'],
  ['Alison Roman', 'Alison Roman'],
  ["America's Test Kitchen", "America's Test Kitchen"],
  ['Paul Hollywood', 'Paul Hollywood'],
  ['The Great British Bake Off', 'The Great British Bake Off'],
  ['Mary Berry', 'Mary Berry'],
  // named books (no personal author attached)
  ['"Family Thai" cookbook', 'Family Thai'],
  ['Macedonia: The Cookbook', 'Macedonia: The Cookbook'],
  ['Homemade-ish', 'Homemade-ish'],
  ['Big Bites: Time to Eat!', 'Big Bites: Time to Eat!'],
  ['Alexis deBoschnek, "Nights and Weekends"', 'Nights and Weekends'],
  ['German cookbook (ebook)', 'German Cookbook (ebook)'],
  ['Life-Changing Salads', 'Life-Changing Salads'],
  ["Lidia's From Our Family Table to Yours", "Lidia's From Our Family Table to Yours"],
  ["Lidia's Italy in America", "Lidia's Italy in America"],
  ['Cookie encyclopedia photo', 'Cookie Encyclopedia'],
  ['Authentic Portuguese Cooking', 'Authentic Portuguese Cooking'],
  ['Easy German Cookbook', 'Easy German Cookbook'],
  ['"Night + Market" cookbook', 'Night + Market'],
  ['Cauliflower Power', 'Cauliflower Power'],
  ['The Balkan Kitchen', 'The Balkan Kitchen'],
  ['Nadiya Hussain, "Nadiya\'s Family Favourites"', "Nadiya's Family Favourites"],
  ['Reilly Meehan, "A Little Bit Extra"', 'A Little Bit Extra'],
  ['Ben Mims, "Crumbs"', 'Crumbs (Ben Mims)'],
  ['Prue Leith, "Life\'s Too Short to Stuff a Mushroom"', "Life's Too Short to Stuff a Mushroom"],
  ['Sur La Table cooking class handout', 'Sur La Table Class'],
  ['Favorite Family Recipes', 'Favorite Family Recipes'],
  // named websites/brands
  ['allrecipes.com', 'AllRecipes'], ['Allrecipes.com', 'AllRecipes'],
  ['epicurious.com', 'Epicurious'],
  ['foodnetwork.com', 'FoodNetwork'],
  ['Food.com', 'Food.com'],
  ['Cooks.com', 'Cooks.com'],
  ['Delish.com', 'Delish'],
  ['Simply Recipes', 'Simply Recipes'],
  ['weight-watchers-points-plus-recipes.com', 'Weight Watchers'], ['Weight Watchers', 'Weight Watchers'],
  ['kraftfoods.com', 'Kraft'], ['Kraft Foods', 'Kraft'],
  ['rockrecipes.com', 'Rock Recipes'],
  ['woocancook.com', 'WooCanCook'],
  ['feelgoodfoodie.net', 'Feel Good Foodie'],
  ['myrecipes.com', 'MyRecipes'],
  ['tasteofhome.com', 'Taste of Home'],
  ['food52.com', 'Food52'],
  ['foodandwine.com', 'Food & Wine'],
  ['seriouseats.com', 'Serious Eats'],
  ['cookstr.com', 'Cookstr'],
  ['vegetariantimes.com', 'Vegetarian Times'],
  ['chowhound.com', 'Chowhound'],
  ['recipeland.com', 'RecipeLand'],
  ['Gordon Ramsay', 'Gordon Ramsay'],
  /* BBC Good Food import stores source as "BBC Good Food (Author Name)" per row --
     specific-author entries must come before the generic catch-all below since
     AUTHOR_GROUPS.find() takes the first prefix match; only authors who are
     independently famous (Mary Berry, Paul Hollywood, Gordon Ramsay -- already
     matched above/below) or who have >=20 recipes in this import get their own
     bucket, everyone else falls through to the generic "BBC Good Food" entry */
  ['BBC Good Food (Gordon Ramsay)', 'Gordon Ramsay'],
  ['BBC Good Food (Mary Berry)', 'Mary Berry'],
  ['BBC Good Food (Paul Hollywood)', 'Paul Hollywood'],
  ['BBC Good Food (Barney Desmazery)', 'Barney Desmazery'],
  ['BBC Good Food (Cassie Best)', 'Cassie Best'],
  ['BBC Good Food (Sarah Cook)', 'Sarah Cook'],
  ['BBC Good Food (Miriam Nice)', 'Miriam Nice'],
  ['BBC Good Food (Sara Buenfeld)', 'Sara Buenfeld'],
  ['BBC Good Food (Sophie Godwin)', 'Sophie Godwin'],
  ['BBC Good Food (Mary Cadogan)', 'Mary Cadogan'],
  ['BBC Good Food (Jane Hornby)', 'Jane Hornby'],
  ['BBC Good Food (James Martin)', 'James Martin'],
  ['BBC Good Food (Lulu Grimes)', 'Lulu Grimes'],
  ['BBC Good Food (Elena Silcock)', 'Elena Silcock'],
  ['BBC Good Food (Jennifer Joyce)', 'Jennifer Joyce'],
  ['BBC Good Food (John Torode)', 'John Torode'],
  ['BBC Good Food (Tom Kerridge)', 'Tom Kerridge'],
  ['BBC Good Food (Chelsie Collins)', 'Chelsie Collins'],
  ['BBC Good Food (Angela Nilsen)', 'Angela Nilsen'],
  ['BBC Good Food (Rosie Birkett)', 'Rosie Birkett'],
  ['BBC Good Food (Emma Lewis)', 'Emma Lewis'],
  ['BBC Good Food', 'BBC Good Food'],
];
const UNKNOWN_AUTHOR = 'Individual/Unknown';
const NYT_AUTHOR = 'NYT Cooking';
const FAMILY_AUTHOR = 'Family Recipe';
function isFamilyRecipe(r){ return authorOf(r) === FAMILY_AUTHOR; }
function authorOf(r){
  if((r.tags||[]).includes('NYT Cooking')) return NYT_AUTHOR;
  const src = r.source || '';
  const hit = AUTHOR_GROUPS.find(([prefix]) => src.startsWith(prefix));
  if(hit) return hit[1];
  /* a genuinely family-sourced recipe ("Family recipe", "Handwritten family
     recipe card", "Family recipe card (grandmother's original)", etc.) is a
     different provenance than an anonymous "Cookbook photo" -- worth its own
     filterable bucket rather than both landing in Individual/Unknown. Checked
     as a substring, not a prefix, since "family" shows up mid-string in most
     of these phrasings. */
  if(/family/i.test(src)) return FAMILY_AUTHOR;
  return UNKNOWN_AUTHOR;
}
function countForAuthor(a){ return RECIPES.filter(r=>authorOf(r)===a).length; }
/* One pass tallying every author's count at once -- computeAllAuthors used
   to call countForAuthor (itself a full RECIPES.filter() scan) once per
   candidate in a .filter(), then AGAIN twice per comparison inside a
   .sort() -- with 50-150+ distinct authors once archive sources are
   merged in, that's thousands of full-array scans on every single
   render(), a major contributor to toggling a source feeling exactly as
   slow as loading one. */
/* Combinatorial: "how many would I get if I also picked this author," under
   every OTHER currently active filter -- same idea as countFor/countForTag
   for category/cuisine/diet, just for Author/Cookbook. A recipe still counts
   toward its own author here even while state.author is already set to it
   (matchesFiltersExcept('author') leaves that one dimension unconstrained),
   which is what keeps the currently-selected option's own count from
   collapsing to itself alone. */
function computeAuthorCounts(){
  const m = {};
  RECIPES.forEach(r=>{
    if(!matchesFiltersExcept(r, 'author')) return;
    const a = authorOf(r); m[a] = (m[a]||0)+1;
  });
  return m;
}
/* computed fresh every call, NOT a one-time const -- NYT Cooking's real count
   (and technically the whole option list) depends on the async NYT fetch having
   merged into RECIPES by the time this runs, which hasn't happened yet the very
   first time the toolbar builds. See syncToolbar(), which calls this on every
   render() rather than baking options in once like the toolbar's other controls. */
function computeAllAuthors(){
  const present = new Set(RECIPES.map(authorOf));
  const named = AUTHOR_GROUPS.map(g=>g[1]).filter((v,i,a)=>a.indexOf(v)===i).filter(a=>present.has(a));
  const rest = [];
  if(present.has(NYT_AUTHOR)) rest.push(NYT_AUTHOR);
  if(present.has(FAMILY_AUTHOR)) rest.push(FAMILY_AUTHOR);
  if(present.has(UNKNOWN_AUTHOR)) rest.push(UNKNOWN_AUTHOR);
  /* A one-or-two-recipe author is mostly dropdown clutter -- their recipes
     are still fully in the catalog and findable by search/other filters,
     just not worth a named entry of their own in an already-long list. */
  const counts = computeAuthorCounts();
  return named.concat(rest).filter(a=>(counts[a]||0) > 2).sort((a,b)=> (counts[b]||0) - (counts[a]||0));
}

function renderChips(){
  /* countFor/countForTag each did a full RECIPES.filter() scan PER chip --
     36 separate full-array scans (9 categories + 23 cuisines + 4 diets)
     every single render(), which is what made toggling a source (even
     just turning one OFF, no network involved) feel exactly as slow as
     loading one in the first place once tens of thousands of archive rows
     were merged in. One single pass over RECIPES computes every chip's
     count at once instead. */
  const catCounts = {}, cuiCounts = {}, dietCounts = {};
  RECIPES.forEach(r=>{
    if(r.category && matchesFiltersExcept(r, 'category')) catCounts[r.category] = (catCounts[r.category]||0)+1;
    if(r.cuisine && matchesFiltersExcept(r, 'cuisine')) cuiCounts[r.cuisine] = (cuiCounts[r.cuisine]||0)+1;
    if(matchesFiltersExcept(r, 'diet')) recipeDietTags(r).forEach(tag=>{ dietCounts[tag] = (dietCounts[tag]||0)+1; });
  });
  const catWrap = document.getElementById('categoryChips');
  catWrap.innerHTML = '';
  ALL_CATEGORIES.forEach((cat,i)=>{
    /* forces a line break every 5th chip on mobile (see .chip-break) so 9
       categories read as an even 5-then-4 instead of however many happen
       to fit before the row's natural wrap point (was landing on 6-then-3). */
    if(i>0 && i%5===0){
      const brk = document.createElement('div');
      brk.className = 'chip-break';
      catWrap.appendChild(brk);
    }
    const chip = document.createElement('span');
    chip.className = 'facet-link' + (state.category===cat ? ' active':'');
    chip.innerHTML = `${cat} <span class="n">${catCounts[cat]||0}</span>`;
    chip.onclick = ()=>{ state.category = state.category===cat ? null : cat; render(); };
    catWrap.appendChild(chip);
  });
  const cuiWrap = document.getElementById('cuisineChips');
  cuiWrap.innerHTML = '';
  ALL_CUISINES.forEach(c=>{
    const chip = document.createElement('span');
    chip.className = 'facet-link' + (state.cuisine===c ? ' active':'');
    chip.innerHTML = `${zwsp(escapeHTML(c))} <span class="n">${cuiCounts[c]||0}</span>`;
    chip.onclick = ()=>{ state.cuisine = state.cuisine===c ? null : c; render(); };
    cuiWrap.appendChild(chip);
  });
  const cuiSelect = document.getElementById('cuisineSelect');
  cuiSelect.innerHTML = `<option value="">All cuisines</option>` + ALL_CUISINES.map(c=>
    `<option value="${escapeHTML(c)}"${state.cuisine===c?' selected':''}>${escapeHTML(c)} (${cuiCounts[c]||0})</option>`).join('');
  cuiSelect.onchange = ()=>{ state.cuisine = cuiSelect.value || null; render(); };
  const dietWrap = document.getElementById('dietChips');
  dietWrap.innerHTML = '';
  ALL_DIETS.forEach(d=>{
    const chip = document.createElement('span');
    /* multi-select, unlike Course/Cuisine -- Vegan and Gluten Free aren't
       mutually exclusive the way Appetizer/Main are, so picking one
       shouldn't clear the other. Two labels ride together (.diet-full/
       .diet-abbr) -- desktop shows the full word, mobile swaps to just the
       abbreviation (V/VG/GF/DF) so all 4 fit as one equal-width row instead
       of wrapping. */
    chip.className = 'facet-link' + (state.diets.includes(d) ? ' active':'');
    chip.innerHTML = `<span class="diet-full">${zwsp(escapeHTML(d))}</span><span class="diet-abbr">${escapeHTML(DIET_ABBREV[d]||d)}</span> <span class="n">${dietCounts[d]||0}</span>`;
    chip.onclick = ()=>{
      state.diets = state.diets.includes(d) ? state.diets.filter(x=>x!==d) : [...state.diets, d];
      render();
    };
    dietWrap.appendChild(chip);
  });
  renderIngredientChips();
}

function renderIngredientChips(){
  const includeList = document.getElementById('ingIncludeOptions');
  includeList.innerHTML = computeIncludeIngredientOptions()
    .filter(v=>!state.includeIngredients.includes(v))
    .map(v=>`<option value="${escapeHTML(v)}">`).join('');
  const excludeList = document.getElementById('ingExcludeOptions');
  excludeList.innerHTML = computeExcludeIngredientOptions()
    .filter(v=>!state.excludeIngredients.includes(v))
    .map(v=>`<option value="${escapeHTML(v)}">`).join('');

  const includeWrap = document.getElementById('ingIncludeChips');
  includeWrap.innerHTML = '';
  state.includeIngredients.forEach(tag=>{
    const chip = document.createElement('span');
    chip.className = 'facet-link active';
    chip.innerHTML = `${zwsp(escapeHTML(tag))} <span class="n">✕</span>`;
    chip.onclick = ()=>{ state.includeIngredients = state.includeIngredients.filter(t=>t!==tag); render(); };
    includeWrap.appendChild(chip);
  });
  const excludeWrap = document.getElementById('ingExcludeChips');
  excludeWrap.innerHTML = '';
  state.excludeIngredients.forEach(tag=>{
    const chip = document.createElement('span');
    chip.className = 'facet-link active';
    chip.innerHTML = `${zwsp(escapeHTML(ingredientOptionLabel(tag)))} <span class="n">✕</span>`;
    chip.onclick = ()=>{ state.excludeIngredients = state.excludeIngredients.filter(t=>t!==tag); render(); };
    excludeWrap.appendChild(chip);
  });
}

function matchesQuery(recipe, q){
  if(!q) return true;
  const t = q.toLowerCase();
  const localHit = [recipe.title, recipe.shortTitle, recipe.source, recipe.cuisine, recipe.category, recipe.notes,
          ...(recipe.tags||[]), ...(recipe.ingredients||[]), ...(recipe.instructions||[])]
    .filter(Boolean).join(' ').toLowerCase().includes(t);
  if(localHit) return true;
  /* archive rows that haven't been opened yet (see _lite / fetchRecipeDetail)
     don't have their ingredients/instructions text on hand locally to search
     -- archiveQueryHits is the server-side full-text fallback's answer for
     the current query (see runArchiveSearch), so a "wok"-style match buried
     in instructions text still surfaces even though that text was never
     downloaded in bulk. */
  return recipe._lite && archiveQueryFor === q && archiveQueryHits.has(recipe.id);
}
function passesMade(r){
  const n = timesMade(r.id), last = lastMade(r.id), d = daysSince(last);
  switch(state.made){
    case 'never':       return n === 0;
    case 'made':        return n > 0;
    case 'recent':      return n > 0 && d !== null && d < 30;
    case 'interested':  return isInterested(r.id);
    default:            return true;
  }
}
/* `exclude` leaves one facet's own dimension unconstrained so its per-value
   counts (see countFor/countForTag below) show "how many would I get if I
   also picked this," under every OTHER currently active filter -- rather
   than a fixed global count that ignores whatever's already selected. */
function matchesFiltersExcept(r, exclude){
  return (exclude==='category' || !state.category || r.category===state.category) &&
    (exclude==='cuisine' || !state.cuisine  || r.cuisine ===state.cuisine)  &&
    (exclude==='diet'    || state.diets.every(d=>recipeDietTags(r).includes(d))) &&
    (exclude==='author'  || !state.author || authorOf(r)===state.author) &&
    (!state.aheadOnly || r._ahead) &&
    enabledSources.includes(archiveSourceOf(r)) &&
    passesIngredientFilters(r) &&
    passesMade(r) && matchesQuery(r, state.query);
}
function getFiltered(){
  let list = RECIPES.filter(r=>matchesFiltersExcept(r, null));
  const byTitle = (a,b)=>a.title.localeCompare(b.title);
  const sorters = {
    /* Default on load: highest rated, then most cooked, then most recently
       cooked, then (family is already handled below as an outer partition,
       ahead of any of this) alphabetical as the final tiebreak. */
    top: (a,b)=>{
      const ra = avgRating(a.id)||0, rb = avgRating(b.id)||0;
      if(rb !== ra) return rb - ra;
      const ma = timesMade(a.id), mb = timesMade(b.id);
      if(mb !== ma) return mb - ma;
      const la = lastMade(a.id), lb = lastMade(b.id);
      if(la !== lb){ if(!la) return 1; if(!lb) return -1; return lb.localeCompare(la); }
      return byTitle(a,b);
    },
    az: byTitle,
    recent: (a,b)=>{ const A=lastMade(a.id), B=lastMade(b.id);
                     if(!A && !B) return byTitle(a,b); if(!A) return 1; if(!B) return -1;
                     return B.localeCompare(A) || byTitle(a,b); },
    stale:  (a,b)=>{ const A=lastMade(a.id), B=lastMade(b.id);
                     if(!A && !B) return byTitle(a,b); if(!A) return -1; if(!B) return 1;
                     return A.localeCompare(B) || byTitle(a,b); },
    most:   (a,b)=> timesMade(b.id)-timesMade(a.id) || byTitle(a,b),
    rating: (a,b)=>{ const A=avgRating(a.id)||-1, B=avgRating(b.id)||-1; return B-A || byTitle(a,b); },
    quick:  (a,b)=>{ const A=a._plan===null?1e9:a._plan, B=b._plan===null?1e9:b._plan; return A-B || byTitle(a,b); },
    newest: (a,b)=> addedDateOf(b).localeCompare(addedDateOf(a)) || byTitle(a,b),
    pantry: (a,b)=> inventoryMatchRatio(b)-inventoryMatchRatio(a) || byTitle(a,b)
  };
  const base = sorters[state.sort] || byTitle;
  const dir = state.sortDir || 1;
  /* family recipes are the actual point of a *family* cookbook -- they win
     the sort outright, not just as a tiebreak. A tiebreak only kicks in when
     the chosen sort's own criterion ties, which "Newest Added" essentially
     never does (an import's fixed addedDate reliably beats an older family
     recipe's) -- so a family recipe could still lose to whatever was most
     recently imported. Partitioning first, independent of sort direction,
     means no sort mode can ever put a non-family recipe above one.
     On the default "Top" sort specifically, a genuine 5-star recipe outranks
     even that family partition -- the best of the whole cookbook belongs at
     the very top of the default view, family or not. Explicit sort modes
     (A-Z, Newest, etc) are left alone: someone who picked A-Z wants strict
     alphabetical order, not a 5-star bucket jumping the alphabet. */
  return list.sort((a,b)=>{
    if(state.sort === 'top' || !state.sort){
      const fiveA = (avgRating(a.id)||0) === 5, fiveB = (avgRating(b.id)||0) === 5;
      if(fiveA !== fiveB) return fiveA ? -1 : 1;
    }
    const fa = isFamilyRecipe(a), fb = isFamilyRecipe(b);
    if(fa !== fb) return fa ? -1 : 1;
    return dir === -1 ? -base(a,b) : base(a,b);
  });
}

/* ---------------- toolbar ---------------- */
/* Shared by the Clear filters button (inside the filter panel) and the
   quick-clear button next to Search (outside it, beside the Filters
   toggle) -- same reset either way, just reachable without opening the
   panel first. */
function clearAllFilters(){
  state = {query:"", category:null, cuisine:null, diets:[], author:null, sort:"top", sortDir:1, made:"all", aheadOnly:false, includeIngredients:[], excludeIngredients:[]};
  document.getElementById('searchInput').value = '';
  document.getElementById('ingIncludeInput').value = '';
  document.getElementById('ingExcludeInput').value = '';
  render();
}
function renderToolbar(){
  const tb = document.getElementById('toolbar');
  if(!tb.dataset.built){
    tb.dataset.built = '1';
    tb.innerHTML = `
      <div class="tb-group compact-group" id="showGroup">
        <label class="tb-name mobile-hide-label">Show</label>
        <button class="tb-btn" data-made="never">Never made</button>
        <button class="tb-btn" data-made="made">Made</button>
        <!-- "+ Plan ahead" is an independent toggle that combines with whichever
             Show state is active, not a mutually-exclusive 3rd Show option --
             sharing this row is just to save vertical space, not a grouping claim. -->
        <button class="tb-btn" id="aheadBtn" title="Needs extra prep (marinate/rest/chill ahead)">Needs Prep</button>
        <button class="tb-btn" data-made="interested">★ Interested</button>
        <!-- Own row, deterministically -- Never made/Made/Needs Extra Prep/
             Interested stretch (flex:1) to fill THEIR row, which otherwise
             left no space for Clear filters to also land on that same line;
             wrapping this trio in its own flex-basis:100% group guarantees
             they always render together on the next row instead of however
             the wrap happens to fall out. -->
        <div class="sort-row">
          <button class="tb-btn clear-btn" id="clearFilters">Clear filters</button>
          <select class="tb-select" id="sortSelect">
            <option value="top">Sort by</option>
            <option value="az">A – Z</option>
            <option value="recent">Recently made</option>
            <option value="stale">Longest since made</option>
            <option value="most">Most made</option>
            <option value="rating">Highest rated</option>
            <option value="quick">Quickest</option>
            <option value="newest">Newest added</option>
            <option value="pantry">What I can make now</option>
          </select>
          <button class="tb-btn" id="sortDirBtn" title="Reverse sort order">↓</button>
        </div>
      </div>`;
    document.getElementById('sortSelect').onchange = e=>{ state.sort = e.target.value; renderGrid(); };
    document.getElementById('sortDirBtn').onclick = ()=>{ state.sortDir = (state.sortDir === -1) ? 1 : -1; syncToolbar(); renderGrid(); };
    tb.querySelectorAll('[data-made]').forEach(b=>{
      /* clicking the already-active button toggles back to "all" -- with the
         "All" button removed, this is the only way back to the unfiltered view */
      b.onclick = ()=>{ state.made = (state.made === b.dataset.made) ? 'all' : b.dataset.made; renderToolbar(); renderGrid(); };
    });
    document.getElementById('aheadBtn').onclick = ()=>{ state.aheadOnly = !state.aheadOnly; renderToolbar(); renderGrid(); };
    document.getElementById('authorSelect').onchange = e=>{ state.author = e.target.value || null; renderGrid(); };
    document.getElementById('clearFilters').onclick = clearAllFilters;
  }
  const srcTb = document.getElementById('sourceToolbar');
  if(!srcTb.dataset.built){
    srcTb.dataset.built = '1';
    /* This sits above .controls (Search/Course/Cuisine/etc), not inside the
       collapsible filter panel -- "which databases of recipes are even in
       play" is a different kind of decision than "which of those recipes
       match", and burying it behind the mobile Filters toggle would hide
       something that changes what Search itself can find at all. */
    srcTb.innerHTML = `
      <div class="tb-group compact-group">
        <label class="tb-name mobile-hide-label">Recipes from</label>
        <button class="tb-btn" data-source="${CURATED_TIER}">Family <span class="n">${RECIPES.filter(r=>!r._fromArchive).length}</span></button>
        <button class="tb-btn" data-source="NYT Cooking" data-label="NYT">NYT</button>
        <button class="tb-btn" data-source="Epicurious" data-label="Epicurious">Epicurious</button>
        <button class="tb-btn" data-source="BBC Good Food" data-label="BBC">BBC</button>
        <button class="tb-btn" data-source="Other recipe sites" data-label="Other">Other</button>
      </div>`;
    srcTb.querySelectorAll('[data-source]').forEach(b=>{
      b.onclick = ()=> toggleSource(b.dataset.source);
    });
  }
  syncToolbar();
}
function syncToolbar(){
  const tb = document.getElementById('toolbar');
  tb.querySelectorAll('[data-made]').forEach(b=> b.classList.toggle('on', b.dataset.made===state.made));
  document.getElementById('aheadBtn').classList.toggle('on', state.aheadOnly);
  const srcTb = document.getElementById('sourceToolbar');
  srcTb.querySelectorAll('[data-source]').forEach(b=>{
    const src = b.dataset.source;
    b.classList.toggle('on', enabledSources.includes(src));
    if(src === CURATED_TIER) return;
    /* Only disable a button if it specifically needs a NEW fetch that's
       currently blocked by another one in flight -- an already-loaded
       source stays clickable (instant toggle) regardless of what else is
       loading. And "Loading…" only ever shows on the ONE button actually
       fetching (currentlyLoadingSource), not on every other enabled
       source too (that compound condition used to match any of them). */
    b.disabled = archiveLoading && !archiveFetchedSources.has(src);
    /* whole-k counts with no parens ("NYT 19k" not "NYT (18.7k)") -- close
       enough to the physical one-line budget that dropping the decimal and
       the parens (vs the earlier attempt) was enough to fit all 5, without
       giving up the numbers entirely like the previous round did. */
    const count = archiveSourceCounts[src];
    /* innerHTML + a .n span, not plain textContent -- matches the exact
       count styling Course/Cuisine/Diet chips already use (smaller,
       muted), instead of the count rendering at the same size/weight as
       the button's own label. */
    b.innerHTML = (src === currentlyLoadingSource) ? 'Loading…'
      : count != null ? `${b.dataset.label} <span class="n">${fmtCompactCount(count)}</span>` : b.dataset.label;
    if(count != null) b.title = `~${count.toLocaleString()} recipes`;
  });
  /* rebuilt fresh every call (not baked in once like the other controls) --
     NYT Cooking's real count depends on the async fetch having merged into
     RECIPES, which isn't true yet the first time the toolbar is built. */
  const authorSel = document.getElementById('authorSelect');
  const authorCounts = computeAuthorCounts();
  authorSel.innerHTML = '<option value="">All authors/cookbooks</option>' +
    computeAllAuthors().map(a=>`<option value="${escapeHTML(a)}">${escapeHTML(a)} (${authorCounts[a]||0})</option>`).join('');
  authorSel.value = state.author || '';
  document.getElementById('sortSelect').value = state.sort;
  const dirBtn = document.getElementById('sortDirBtn');
  dirBtn.textContent = (state.sortDir === -1) ? '↑' : '↓';
  dirBtn.classList.toggle('on', state.sortDir === -1);
}
function exportData(){
  const payload = JSON.stringify(DATA, null, 2);
  const blob = new Blob([payload], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cookbook-state-' + todayISO() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  if(navigator.clipboard) navigator.clipboard.writeText(payload).catch(()=>{});
}
function importData(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const fr = new FileReader();
  fr.onload = ()=>{
    try{
      DATA = mergeStates(DATA, JSON.parse(fr.result));
      persist(); render();
      alert('Imported. ' + DATA.cookLog.filter(e=>!e._d).length + ' cook entries now on file.');
    }catch(err){ alert('That file could not be read as cookbook data.'); }
  };
  fr.readAsText(f);
  e.target.value = '';
}

/* ---------------- grid ---------------- */
function starStr(n){ const k=Math.max(0,Math.min(5,Math.round(n))); return '★★★★★'.slice(0,k) + '☆☆☆☆☆'.slice(0,5-k); }
/* card-level time is just the total, as a single stat tag alongside course/
   cuisine -- servings only matters once you're actually cooking, so it's
   modal-only now, same as the prep/cook breakdown. */
/* Inline Labels layout: Type/Time/With(or Made)/Author/Added all render as
   one small caps label + plain text per line, directly under the title --
   no badges, no separate footer, all the same visual weight (including
   Plan Ahead/Overnight, which used to be its own standalone badge). */
function cardLine(label, value){
  return `<p class="card-line"><span class="card-line-label">${label}</span>${value}</p>`;
}
function cardLinesHTML(r){
  const lines = [];
  const n = timesMade(r.id), last = lastMade(r.id), avg = avgRating(r.id);
  /* a recipe you've actually cooked is more worth knowing at a glance than
     what course/cuisine it is -- put Made first, ahead of everything else,
     rather than buried below Type/Time. A never-made card still leads with
     Type as before, since there's no Made line to promote. */
  if(n > 0){
    let made = `Made ${n}× · ${relTime(last)}`;
    if(avg) made += ` ${starStr(avg)}`;
    lines.push(cardLine('Made', made));
  }

  const typeParts = [r.category, r.cuisine].filter(Boolean).map(x=>zwsp(escapeHTML(x)));
  /* "needs extra prep" (the old standalone Ahead line) folds into the Type line
     instead of being its own line -- an optional line that only sometimes
     appears pushes every line below it into a different spot from card to
     card, so anything that can be blank rides along on a line that's already
     shown instead of getting a line of its own. */
  if(r._ahead) typeParts.push('Needs Extra Prep');
  if(typeParts.length) lines.push(cardLine('Type', typeParts.join(', ')));
  if(r._total) lines.push(cardLine('Time', fmtTime(r._total)));

  if(n===0){
    /* "Never made" is true for most cards -- not worth the space. Show a
       quick ingredient preview instead, so the card hints at the dish
       without needing to open it. */
    const preview = ingredientPreview(r);
    if(preview.length) lines.push(cardLine('With', preview.map(escapeHTML).join(', ')));
  }
  return lines.join('');
}
/* pantry staples that are almost always present and say nothing distinctive
   about the dish -- rank them last so the preview leads with what actually
   matters (the protein, the standout vegetable/spice), not "garlic, salt". */
const BORING_INGREDIENTS = new Set([
  'salt','kosher salt','sea salt','black pepper','pepper','white pepper','garlic',
  'onion','olive oil','vegetable oil','oil','canola oil','butter','sugar','flour',
  'water','baking soda','baking powder','cornstarch','all-purpose flour',
]);
function ingredientPreview(r){
  const core = r.ingredientCore || [];
  const ranked = [...core].sort((a,b) => (BORING_INGREDIENTS.has(a)?1:0) - (BORING_INGREDIENTS.has(b)?1:0));
  return ranked.slice(0,5);
}
/* rendering every matching recipe as a full DOM card doesn't scale once the
   catalog is ~45k+ -- with no filter active that's tens of thousands of card
   elements rebuilt on every keystroke/chip click, which is what actually made
   the site feel frozen (not the network fetch). Cap what's rendered per page
   and reveal more on demand instead; renderLimit resets to one page whenever
   the filters themselves changed since the last render (tracked via a cheap
   signature), so "load more" doesn't also silently reset when you just typed
   another search-box keystroke. */
const RENDER_PAGE = 100;
let renderLimit = RENDER_PAGE;
let lastFilterSig = null;
function filterSignature(){
  return JSON.stringify([state.query, state.category, state.cuisine, state.diets, state.author,
    state.made, state.aheadOnly, enabledSources, state.includeIngredients, state.excludeIngredients]);
}
function renderGrid(){
  const grid = document.getElementById('grid');
  const filtered = getFiltered();
  const sig = filterSignature();
  if(sig !== lastFilterSig){ renderLimit = RENDER_PAGE; lastFilterSig = sig; }
  grid.innerHTML = '';
  /* Shows in place of the count while an archive source is mid-fetch --
     same fixed-width box (see .result-count), so this doesn't introduce
     its own layout shift the way the raw "Loading…" text would. */
  document.getElementById('resultCount').innerHTML = archiveLoading
    ? `<span class="loading-spin">&#8635;</span> Loading…`
    : `${filtered.length} / ${RECIPES.length}`;
  const made = DATA.cookLog.filter(e=>!e._d).length;
  document.getElementById('footerCount').textContent =
    `${RECIPES.length} recipes catalogued, and counting.` + (made ? `  ${made} meals logged.` : '');
  if(filtered.length===0){
    grid.innerHTML = `<div class="empty-state">Nothing on file matches that yet &mdash; try another search or clear a filter.</div>`;
    document.getElementById('loadMoreWrap').innerHTML = '';
    return;
  }
  const toShow = filtered.slice(0, renderLimit);
  toShow.forEach(r=>{
    const card = document.createElement('div');
    card.className = 'card';
    /* Top-right overlay, not a line of their own -- floats over the title's
       own top-right corner (title already reserves that space via its own
       right padding) instead of taking a dedicated row anywhere. */
    const familyMark = isFamilyRecipe(r)
      ? `<svg class="family-mark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Family recipe"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1v-9"/></svg>`
      : '';
    card.innerHTML = `
      <div class="card-icons">
        <button class="interested-star${isInterested(r.id)?' on':''}" title="${isInterested(r.id)?'Remove from interested':'Mark as interested'}" aria-label="Mark as interested">${isInterested(r.id)?'★':'☆'}</button>
        ${familyMark}
      </div>
      <h3 class="card-title${r.nativeName?' dual-name':''}">${zwsp(escapeHTML(displayTitle(r)))}</h3>
      <div class="card-lines">${cardLinesHTML(r)}</div>`;
    card.onclick = ()=> openModal(r);
    const star = card.querySelector('.interested-star');
    star.onclick = (e)=>{
      e.stopPropagation();
      toggleInterested(r.id);
      star.classList.toggle('on');
      star.textContent = star.classList.contains('on') ? '★' : '☆';
      star.title = star.classList.contains('on') ? 'Remove from interested' : 'Mark as interested';
      if(state.made === 'interested' && !star.classList.contains('on')) renderGrid();
    };
    grid.appendChild(card);
  });
  const moreWrap = document.getElementById('loadMoreWrap');
  const remaining = filtered.length - toShow.length;
  moreWrap.innerHTML = remaining > 0
    ? `<button class="load-more-btn" id="loadMoreBtn">Show ${Math.min(RENDER_PAGE, remaining)} more (${remaining} left)</button>`
    : '';
  if(remaining > 0) document.getElementById('loadMoreBtn').onclick = ()=>{ renderLimit += RENDER_PAGE; renderGrid(); };
}
function render(){ renderChips(); renderToolbar(); renderGrid(); updateFiltersToggle(); }
/* Mobile-only: badge on the collapsed "Filters" button showing how many
   facets are active, so it's obvious at a glance whether the (hidden)
   panel has anything applied without having to open it to check. Search
   text isn't counted -- that field stays visible outside the panel. */
function updateFiltersToggle(){
  const nonDefaultSources = enabledSources.filter(s=>s!==CURATED_TIER).length
    + (enabledSources.includes(CURATED_TIER)?0:1);
  const n = (state.category?1:0) + (state.cuisine?1:0) + state.diets.length
    + state.includeIngredients.length + state.excludeIngredients.length + nonDefaultSources;
  const badge = document.getElementById('filtersToggleBadge');
  badge.textContent = n;
  badge.hidden = n===0;
}
function toggleFilterPanel(){
  document.getElementById('filtersToggle').classList.toggle('open');
  document.getElementById('filterPanel').classList.toggle('open');
}
document.getElementById('filtersToggle').onclick = toggleFilterPanel;

/* ---------------- modal ---------------- */
let modalRecipe = null, modalFactor = 1;

/* Maps each of a recipe's already-tagged core ingredients to the FIRST step
   that mentions it -- deliberately first-only (not every occurrence), since
   the point is "which step do I need to have this ready for," not a
   frequency count. Bounded to one badge value per term no matter how many
   times a common ingredient like "salt" gets mentioned throughout the
   method, which is what keeps this from repeating the earlier over-tagging
   problem where every mention got bolded. */
function computeIngredientStepMap(r){
  const map = {};
  const core = r.ingredientCore || [];
  const steps = r.instructions || [];
  core.forEach(term=>{
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b', 'i');
    for(let i=0; i<steps.length; i++){
      if(re.test(steps[i])){ map[term] = i+1; break; }
    }
  });
  return map;
}
/* words too generic or too much about quantity/packaging to mean anything
   as a step-match signal on their own */
const STEP_MATCH_STOPWORDS = new Set([
  'with','into','from','about','until','over','under','through','before','after',
  'cups','cup','tablespoons','tablespoon','teaspoons','teaspoon','ounces','ounce',
  'pounds','pound','grams','gram','liters','liter','cloves','clove','cans','jars',
  'package','packages','sticks','stick','pieces','piece','inch','inches','pinch',
  'large','small','medium','fresh','chopped','sliced','diced','minced','ground',
]);
function lineTokens(line){
  return line.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter(w=> w.length >= 4 && !STEP_MATCH_STOPWORDS.has(w));
}
function stepBadgesFor(line, stepMap, steps){
  const nums = new Set();
  Object.keys(stepMap).forEach(term=>{
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b', 'i');
    if(re.test(line)) nums.add(stepMap[term]);
  });
  /* ingredientCore is a NORMALIZED vocabulary built for dietary tagging --
     "margarine" tags under the parent group "butter", "spaghetti sauce"
     normalizes to "tomato sauce", plain staples like "water" get excluded
     from it entirely. None of those literally appear in the ingredient's
     own line, so the check above finds nothing for them even though the
     step obviously does mention the actual words on the line. Only run
     this fallback when that happened -- it's a broader, slightly riskier
     match, so it should never override a clean ingredientCore hit. */
  if(!nums.size && steps && steps.length){
    const toks = lineTokens(line);
    for(let i=0; i<steps.length; i++){
      if(toks.some(t=> new RegExp('\\b' + t + 's?\\b', 'i').test(steps[i]))){ nums.add(i+1); break; }
    }
  }
  if(!nums.size) return '';
  return [...nums].sort((a,b)=>a-b).map(n=>`<span class="step-badge">${n}</span>`).join('');
}
/* "Add remaining ingredients and bring to a boil" is a real, common recipe
   phrasing -- it doesn't name any of those ingredients individually, but it
   DOES mean "everything not already accounted for by an earlier step," so
   anything still unmatched after checking every other step legitimately
   belongs here rather than staying blank. */
function findRemainingStep(steps){
  for(let i=0; i<steps.length; i++){
    if(/\b(?:remaining|rest of the|other)\s+ingredients?\b/i.test(steps[i])) return i+1;
  }
  return null;
}
function renderIngredients(){
  const r = modalRecipe, f = modalFactor;
  const wrap = document.getElementById('modalIngredients');
  wrap.innerHTML = '';
  const stepMap = computeIngredientStepMap(r);
  const remainingStep = findRemainingStep(r.instructions || []);
  (r.ingredients||[]).forEach(item=>{
    const li = document.createElement('li');
    const isHeading = item.endsWith(':') && item.split(' ').length < 6;
    if(isHeading){ li.className = 'heading'; li.innerHTML = renderInline(item); wrap.appendChild(li); return; }
    const res = scaleLine(item, f);
    let badges = stepBadgesFor(item, stepMap, r.instructions);
    if(!badges && remainingStep) badges = `<span class="step-badge">${remainingStep}</span>`;
    li.innerHTML = `<span class="ing-text">${renderInline(res.text)}${res.unscaled && f!==1 ? ' <span class="unscaled-note">· unscaled</span>' : ''}</span><span class="ing-badge-slot">${badges}</span>`;
    wrap.appendChild(li);
  });
}
function renderScaleBar(){
  const r = modalRecipe, sv = r._servings, f = modalFactor;
  const host = document.getElementById('modalScale');
  const active = f !== 1;
  const mult = v => `<button type="button" class="mult-btn ${f===v?'on':''}" data-mult="${v}">${v===0.5?'½':v}×</button>`;
  /* the yield block keeps its own column so the row never shifts as numbers change */
  const yieldBlock = (sv && sv.servingBased)
    ? `<div class="step">
         <button type="button" id="svDown">−</button>
         <div class="step-val">${fmtNum(sv.base*f)}</div>
         <button type="button" id="svUp">+</button>
       </div>`
    : `<span class="sb-yield">${sv ? zwsp(escapeHTML(String(r.servings))) : '—'}</span>`;
  host.innerHTML = `
    <div class="scale-bar ${active?'active':''}">
      <div class="sb-block">
        <span class="sb-key">Scale</span>
        <span class="sb-mults">${mult(0.5)}${mult(1)}${mult(2)}${mult(3)}</span>
      </div>
      <div class="sb-block">
        <span class="sb-key">Servings</span>
        ${yieldBlock}
      </div>
      ${active ? `<div class="sb-block">
          <span class="sb-flag">scaled ${fmtNum(f)}×</span>
          <button type="button" class="mult-btn" id="svReset">reset</button>
        </div>` : ''}
    </div>`;
  host.querySelectorAll('[data-mult]').forEach(b2=>{
    b2.onclick = ()=>{ modalFactor = parseFloat(b2.dataset.mult); renderScaleBar(); renderIngredients(); };
  });
  const reset = host.querySelector('#svReset');
  if(reset) reset.onclick = ()=>{ modalFactor = 1; renderScaleBar(); renderIngredients(); };
  const up = host.querySelector('#svUp'), down = host.querySelector('#svDown');
  if(up)   up.onclick   = ()=>{ modalFactor = ((sv.base*modalFactor)+1)/sv.base; renderScaleBar(); renderIngredients(); };
  if(down) down.onclick = ()=>{ const n=(sv.base*modalFactor)-1; if(n<1) return;
                                modalFactor = n/sv.base; renderScaleBar(); renderIngredients(); };
}
function renderCookPanel(){
  const r = modalRecipe, host = document.getElementById('modalCook');
  const evs = cookEvents(r.id), n = evs.length, avg = avgRating(r.id);
  /* with exactly one cook logged, the average IS that entry's own rating --
     showing it here duplicates the star line the history list below already
     shows for that same entry. Only worth surfacing once there's more than
     one to actually average across. */
  const mine = n===0 ? "You haven't cooked this yet."
    : `Cooked ${n}×${(avg && n>1)?` · ${starStr(avg)}`:''} · last ${relTime(lastMade(r.id))}`;
  const otherHh = otherHouseholdId();
  const otherN = otherHh ? otherTimesMade(r.id) : 0;
  const otherBit = otherN
    ? ` · ${escapeHTML(HOUSEHOLD_LABEL[otherHh])}: ${otherN}×${(otherAvgRating(r.id) && otherN>1)?` · ${starStr(otherAvgRating(r.id))}`:''} · last ${relTime(otherLastMade(r.id))}`
    : '';
  const summary = (n===0 && !otherN) ? 'Not yet cooked.' : `${mine}${otherBit}`;
  host.innerHTML = `
    <div class="cook-panel">
      <div class="cook-row">
        <span style="color:var(--ink-soft); font-size:13px;">${summary}</span>
      </div>
      <div class="cook-form" id="cookForm">
        <input type="date" id="cookDate" value="${todayISO()}">
        <div class="rate-pick" id="ratePick">${[1,2,3,4,5].map(i=>`<span data-v="${i}">★</span>`).join('')}</div>
        <input type="text" id="cookNote" placeholder="Note for next time (optional)">
        <input type="text" id="cookLeftover" placeholder="Leftovers? (e.g. half, 2 servings)">
        <button class="cook-btn" id="cookSave">Save</button>
      </div>
      ${n ? `<div class="cook-hist">${evs.map(e=>`
        <div class="cook-hist-item">
          <span class="ch-date">${e.date}</span>
          ${e.rating?`<span class="stars">${starStr(e.rating)}</span>`:''}
          ${e.note?`<span class="ch-note">${escapeHTML(e.note)}</span>`:''}
          ${e.leftover?`<span class="ch-note">Leftovers: ${escapeHTML(e.leftover)}</span>`:''}
          <span class="ch-del" data-ev="${e.id}">remove</span>
        </div>`).join('')}</div>` : `<div class="cook-empty">Log it once and this recipe joins the rotation history.</div>`}
    </div>`;
  let rating = 0;
  const pick = host.querySelector('#ratePick');
  pick.querySelectorAll('span').forEach(sp=>{
    sp.onclick = ()=>{ rating = +sp.dataset.v;
      pick.querySelectorAll('span').forEach(x=> x.classList.toggle('lit', +x.dataset.v <= rating)); };
  });
  host.querySelector('#cookSave').onclick = ()=>{
    addCook(r.id, host.querySelector('#cookDate').value || todayISO(), rating,
      host.querySelector('#cookNote').value.trim(), host.querySelector('#cookLeftover').value.trim());
    ticks = {ing:[], step:[]}; clearTicks(r.id); setMaking(false);
    renderCookPanel(); renderGrid();
  };
  host.querySelectorAll('.ch-del').forEach(d=>{
    d.onclick = ()=>{ removeCook(d.dataset.ev); renderCookPanel(); renderGrid(); };
  });
}
async function openModal(r){
  modalRecipe = r; modalFactor = 1;
  const p = parseTime(r.prepTime), c = parseTime(r.cookTime), t = r._total;
  document.getElementById('modalSideCourse').innerHTML = r.category ? `<span class="stamp-badge">${escapeHTML(r.category)}</span>` : '—';
  document.getElementById('modalSideCuisine').textContent = r.cuisine ? zwsp(r.cuisine) : '—';
  document.getElementById('modalSideSource').textContent = r.source || '—';
  document.getElementById('modalSideServes').textContent = r.servings ? servingsLabel(r.servings) : '—';
  document.getElementById('modalSideTime').textContent =
    (p && c) ? `${fmtTime(p)} / ${fmtTime(c)}` : (t ? `${fmtTime(t)} total` : '—');
  document.getElementById('modalSideMacros').textContent = macrosLabel(r);
  document.getElementById('modalSideAdded').textContent = fmtAddedDate(addedDateOf(r));
  const modalTitleEl = document.getElementById('modalTitle');
  modalTitleEl.innerHTML = zwsp(escapeHTML(displayTitle(r)));
  modalTitleEl.classList.toggle('dual-name', !!r.nativeName);
  /* mobile-only: any long title (dual-name or just a long single name) drops
     a size and allows a 3rd wrapped line -- see .modal h2.long-title -- so
     it doesn't eat the whole fold on its own. 50 chars is comfortably past
     every normal title but well under the truly long ones. */
  modalTitleEl.classList.toggle('long-title', displayTitle(r).length > 50);

  const dietTagsList = (()=>{
    /* diet labels in r.tags come from NYT's own (unreliable -- see DIET_DEFINITIONS
       above) scrape; drop them here and show the ingredient-computed ones instead,
       so the modal doesn't contradict what the Diet filter just decided. */
    const RAW_DIET_LABELS = new Set(['Vegan','Vegan-friendly','Vegetarian','Gluten Free','Dairy Free']);
    const list = (r.tags||[]).filter(t2=>!RAW_DIET_LABELS.has(t2)).concat(recipeDietTags(r));
    if(r._ahead) list.push(r._ahead.label);
    return list;
  })();
  ['modalTags', 'modalTagsMobile'].forEach(id=>{
    const wrap = document.getElementById(id);
    wrap.innerHTML = '';
    dietTagsList.forEach(t2=>{ const s=document.createElement('span'); s.className='tagpill'; s.textContent=t2; wrap.appendChild(s); });
  });

  /* Mobile condensed metadata grid -- Course/Cuisine/Prep-Cook/Added always
     stay as short inline cells; Source and Serves are the two fields that
     can genuinely run long (a multi-author byline, a full sentence like
     "6-8 as a main dish..."), so past ~20 characters each gets pulled onto
     its own full-width wrapping line instead of being squeezed/truncated
     into half a grid row. NYT sources collapse to just "NYT" first --
     every archive NYT row's real source is already exactly "NYT Cooking",
     so nothing is lost. */
  const OWN_LINE_LEN = 20;
  const sourceVal = (r.source||'').startsWith('NYT Cooking') ? 'NYT' : (r.source || '—');
  const servesVal = r.servings ? servingsLabel(r.servings) : '—';
  const metaCell = (label, val)=> `<div class="modal-meta-cell"><span class="lbl">${label}</span><span class="val">${escapeHTML(String(val))}</span></div>`;
  const metaFull = (label, val)=> `<div class="modal-meta-full"><span class="lbl">${label}</span>${escapeHTML(String(val))}</div>`;
  document.getElementById('modalMetaGrid').innerHTML = [
    metaCell('Course', r.category || '—'),
    metaCell('Cuisine', r.cuisine || '—'),
    sourceVal.length > OWN_LINE_LEN ? metaFull('Source', sourceVal) : metaCell('Source', sourceVal),
    servesVal.length > OWN_LINE_LEN ? metaFull('Serves', servesVal) : metaCell('Serves', servesVal),
    metaCell('Prep/Cook', (parseTime(r.prepTime) && parseTime(r.cookTime)) ? `${fmtTime(parseTime(r.prepTime))} / ${fmtTime(parseTime(r.cookTime))}` : (r._total ? `${fmtTime(r._total)} total` : '—')),
    recipeMacros(r) ? metaFull('Macros', macrosLabel(r)) : '',
    metaCell('Added', fmtAddedDate(addedDateOf(r))),
    /* the tag list already shows a "Marinate"/etc pill for at-a-glance
       scanning, but that pill has no room for the actual lead time -- this
       cell carries just the number, folded into the existing grid instead
       of the old full-width colored callout block below the grid. */
    r._ahead ? metaCell('Start ahead', `${r._ahead.label} · ${fmtDur(r._ahead.minutes)}`) : '',
  ].join('');
  document.getElementById('modalAhead').innerHTML = '';

  /* Archive rows opened for the first time this visit don't have their
     ingredients/instructions/notes text on hand yet (nytBoot's bulk load
     deliberately skips it -- see NYT_LITE_COLUMNS); fetch just this one
     recipe's text now instead. Metadata/tags/cook-history above don't
     depend on it, so they render immediately either way. */
  function renderStepsAndNotes(){
    const stepsWrap = document.getElementById('modalSteps');
    stepsWrap.innerHTML = '';
    (r.instructions||[]).forEach(step=>{ const li=document.createElement('li'); li.innerHTML=renderInline(step); stepsWrap.appendChild(li); });
    document.getElementById('modalNotesWrap').innerHTML = r.notes
      ? `<div class="notes-box"><span class="notes-label">Notes &amp; Variations</span>${renderInline(r.notes)}</div>` : '';
  }
  if(r._lite){
    document.getElementById('modalScale').innerHTML = '';
    document.getElementById('modalIngredients').innerHTML = '<li class="heading">Loading…</li>';
    document.getElementById('modalSteps').innerHTML = '<li>Loading…</li>';
    document.getElementById('modalNotesWrap').innerHTML = '';
  } else {
    renderScaleBar();
    renderIngredients();
    renderStepsAndNotes();
  }
  ticks = loadTicks(r.id);
  making = (ticks.ing.length + ticks.step.length) > 0;
  document.getElementById('modalCard').classList.toggle('making', making);

  renderCookPanel();
  renderModalActionsTop();
  document.getElementById('modalShareFooter').innerHTML = '';
  wireTicks();
  paintTicks();
  if(making) requestWake();
  suppressHash = true;
  if(location.hash !== hashFor(r.id)) location.hash = hashFor(r.id);
  setTimeout(()=>{ suppressHash = false; }, 0);
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('modalCard').scrollTop = 0;
  document.getElementById('modalOverlay').scrollTop = 0;

  if(r._lite){
    await fetchRecipeDetail(r);
    if(modalRecipe !== r) return; /* closed or navigated to a different recipe while this was in flight */
    renderScaleBar();
    renderIngredients();
    renderStepsAndNotes();
    wireTicks();
    paintTicks();
  }
}
function closeModal(){
  /* a share-view visitor gets no way back to the rest of the cookbook --
     the close button is hidden (see body.share-view .modal-close), and
     Escape/backdrop-click still route through this function, so this is a
     deliberate no-op rather than a redirect that would expose the grid. */
  if(cameFromShareLink) return;
  if(typeof closeQuickMenu === 'function') closeQuickMenu();
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  modalRecipe = null;
  releaseWake();
  if(/^#r\//.test(location.hash||'')){
    suppressHash = true;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(()=>{ suppressHash = false; }, 0);
  }
}
document.getElementById('modalClose').onclick = closeModal;
document.getElementById('modalOverlay').onclick = e=>{ if(e.target.id==='modalOverlay') closeModal(); };
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

let searchTimer;
document.getElementById('searchInput').addEventListener('input', e=>{
  clearTimeout(searchTimer);
  const val = e.target.value;
  searchTimer = setTimeout(()=>{ state.query = val; renderGrid(); runArchiveSearch(val); }, 80);
});
/* Server-side full-text fallback for the ingredient/instruction text that
   nytBoot's lite bulk load no longer carries locally (see _lite / NYT_LITE_
   COLUMNS) -- fires one small indexed query per settled search term instead
   of ever re-downloading that text in bulk. Local matching (title/tags/
   already-opened recipes) is instant and unaffected; this only ADDS archive
   hits that live purely in text nobody's fetched yet. */
let archiveQueryHits = new Set(), archiveQueryFor = null, archiveSearchGen = 0;
function buildPrefixTsQuery(q){
  const words = q.toLowerCase().match(/[a-z0-9]+/g);
  if(!words || !words.length) return null;
  return words.map(w=>w+':*').join(' & ');
}
async function runArchiveSearch(q){
  if(!sb || !archiveFetchedSources.size || !enabledSources.some(s=>s!==CURATED_TIER)){ return; }
  if(!q || q.trim().length < 2){
    archiveQueryHits = new Set(); archiveQueryFor = null;
    return;
  }
  const tsQuery = buildPrefixTsQuery(q);
  if(!tsQuery) return;
  const gen = ++archiveSearchGen;
  const res = await sb.from('nyt_recipes').select('id').textSearch('search_vec', tsQuery, {config:'english'}).limit(500);
  if(gen !== archiveSearchGen) return; /* a newer keystroke already superseded this request */
  if(res.error){ console.error('archive full-text search error', res.error); return; }
  archiveQueryHits = new Set((res.data||[]).map(row=>row.id));
  archiveQueryFor = q;
  render();
}
/* Adding a chip requires an explicit action -- pressing Enter, or picking a
   suggestion from the datalist dropdown -- never just typing text that
   happens to exactly match an option, which used to add it silently
   mid-keystroke and felt like the field was grabbing input out from under you.

   A native datalist selection and manual typing both fire 'input' with no
   reliable event to tell them apart -- except InputEvent.inputType, which
   browsers leave empty/undefined for a datalist pick but always set (e.g.
   "insertText") for a real keystroke. That's what distinguishes "selected"
   from "typed it out by hand" below. */
function wireIngredientInput(inputId, optionsFn, stateKey){
  const input = document.getElementById(inputId);
  const tryAdd = ()=>{
    const val = input.value;
    if(optionsFn().includes(val)){
      if(!state[stateKey].includes(val)) state[stateKey] = [...state[stateKey], val];
      input.value = '';
      render();
      document.getElementById(inputId).focus();
    }
  };
  input.addEventListener('input', e=>{
    if(!e.inputType) tryAdd(); /* datalist selection, not a keystroke */
  });
  input.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); tryAdd(); }
  });
}
wireIngredientInput('ingIncludeInput', computeIncludeIngredientOptions, 'includeIngredients');
wireIngredientInput('ingExcludeInput', computeExcludeIngredientOptions, 'excludeIngredients');

render();

/* ============================================================
   PHASE 2 — week planner, suggestions, shopping + prep, history
   ============================================================ */

/* ---------------- date helpers (Mon-start weeks) ---------------- */
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function isoOf(d){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function dateOf(iso){ return new Date(iso+'T00:00:00'); }
function addDays(iso, n){ const d=dateOf(iso); d.setDate(d.getDate()+n); return isoOf(d); }
function mondayOf(iso){ const d=dateOf(iso); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return isoOf(d); }
function fmtDayLabel(iso){ const d=dateOf(iso); return MONTHS[d.getMonth()].slice(0,3)+' '+d.getDate(); }
function fmtRange(a,b){
  const x=dateOf(a), y=dateOf(b);
  const sameMonth = x.getMonth()===y.getMonth();
  return MONTHS[x.getMonth()]+' '+x.getDate()+' – '+(sameMonth?'':MONTHS[y.getMonth()]+' ')+y.getDate()+', '+y.getFullYear();
}

/* ---------------- preferences ---------------- */
function prefs(){
  const p = DATA.prefs || (DATA.prefs = {});
  if(p.household === undefined) p.household = 2;
  if(!p.rituals) p.rituals = [];
  if(p.dinnerOnly === undefined) p.dinnerOnly = true;
  return p;
}
const DINNER_CATEGORIES = ['Main','Soup'];
function isDinnerish(r){ return DINNER_CATEGORIES.indexOf(r.category) !== -1; }

/* ---------------- plan accessors ---------------- */
/* Each day can hold multiple dishes across lunch and dinner, so a plan
   "slot" is its own record (id, iso, mealType) rather than one entry per
   day. A slot is either a cookbook recipe (recipeId), a manual/off-cookbook
   dish (manualName + manualIngredients), or a leftover pointer (leftoverOf
   -> another slot's id). */
function slotsFor(iso){
  return DATA.plan.filter(s=> s.iso===iso && !s._d)
    .sort((a,b)=> (a.mealType==='lunch'?0:1) - (b.mealType==='lunch'?0:1) || (a._t||0)-(b._t||0));
}
function dinnerSlotsFor(iso){ return slotsFor(iso).filter(s=> s.mealType!=='lunch'); }
function slotById(id){ return DATA.plan.find(s=> s.id===id && !s._d) || null; }
function addSlot(iso, mealType, data){
  const row = Object.assign({id:uid(), iso, mealType: mealType||'dinner'}, data, {_t: Date.now()});
  DATA.plan.push(row);
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'plan_days', row});
  return row;
}
function updateSlot(id, patch){
  const s = slotById(id);
  if(!s) return;
  Object.assign(s, patch, {_t: Date.now()});
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'plan_days', row:s});
}
function removeSlot(id){
  const s = DATA.plan.find(x=>x.id===id);
  if(s){ s._d = true; s._t = Date.now(); }
  persist();
  if(s && typeof pushWrite === 'function') pushWrite({table:'plan_days', row:s});
}
function recipeById(id){ return RECIPES.find(r=>r.id===id) || null; }
/* recipes transcribed before we started tagging addedDate all share one
   backfilled date; anything added after 2026-08-23 carries a real one. */
function addedDateOf(r){ return r.addedDate || '2026-08-23'; }
function fmtAddedDate(iso){
  const d = new Date(iso+'T00:00:00');
  return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(-2);
}
function slotServings(entry, r){
  if(entry && entry.servings) return entry.servings;
  const sv = r && r._servings;
  return (sv && sv.servingBased) ? sv.base : null;
}
function slotFactor(entry, r){
  const sv = r && r._servings;
  if(!sv || !sv.servingBased) return 1;
  const want = slotServings(entry, r);
  return want ? want / sv.base : 1;
}

/* ---------------- key ingredients (for overlap + shopping) ---------------- */
const STAPLE_WORDS = ['salt','pepper','water','olive oil','oil','butter','sugar','flour','garlic','onion',
  'kosher salt','black pepper','vegetable oil','cooking spray','ice'];
const SECTION_RULES = [
  ['Produce',        /\b(lettuce|lemon|lime|orange|apple|banana|onion|shallot|garlic|ginger|potato|tomato|carrot|celery|pepper[s]?\b|bell pepper|cabbage|kale|chard|spinach|broccoli|cauliflower|zucchini|squash|eggplant|mushroom|cilantro|parsley|basil|thyme|rosemary|sage|mint|dill|scallion|cucumber|avocado|corn|bean sprout|leek|turnip|radish|herb|salad|arugula|pea[s]?\b|chile|chili pepper|jalapeno|serrano)/i],
  ['Meat & Seafood', /\b(chicken|beef|pork|lamb|turkey|duck|bacon|sausage|chorizo|prosciutto|ham|steak|thighs?\b|breasts?\b|ground (beef|pork|lamb|turkey|chicken|veal|sausage)|shrimp|fish|salmon|anchov|clam|mussel|squid|meatball)/i],
  ['Dairy & Eggs',   /\b(milk|cream|butter|cheese|yogurt|egg[s]?\b|ricotta|parmesan|mozzarella|feta|cheddar|gruyere|sour cream|creme|mascarpone|cotija|pecorino|labne)/i],
  ['Frozen',         /\b(frozen|ice cream|puff pastry|phyllo|waffle fries)/i],
  ['Bakery',         /\b(bread|baguette|ciabatta|sourdough|roll|tortilla|pita|bun|brioche|panko|breadcrumb)/i],
  ['Spices',         /\b(cumin|coriander|turmeric|paprika|cinnamon|cardamom|nutmeg|cayenne|curry powder|garam masala|oregano|bay leaf|peppercorn|chili powder|red pepper flakes|italian seasoning|seasoning|vanilla|saffron|fennel seed|dried thyme|dried oregano)/i],
  ['Pantry',         /\b(flour|sugar|rice|pasta|noodle|stock|broth|can|jar|vinegar|oil|sauce|paste|bean[s]?\b|lentil|chickpea|nut[s]?\b|almond|walnut|pecan|pistachio|cashew|peanut|honey|syrup|soy|coconut milk|tahini|mustard|mayo|olive|caper|raisin|date[s]?\b|chocolate|yeast|baking powder|baking soda|cornstarch|oat|quinoa|farro|couscous|wine|sherry|bourbon)/i]
];
function sectionFor(text){
  for(const [name, re] of SECTION_RULES) if(re.test(text)) return name;
  return 'Other';
}
function ingredientNoun(line){
  let s = line
    .replace(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(lbs?|pounds?|oz|ounces?|g|kg|ml|l|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|sprigs?|slices?|cans?|bunch(es)?|sticks?|quarts?|pints?|packages?|heads?|knobs?|strips?|large|small|medium)\b\.?\s*/i, '')
    .split(/,| - |—/)[0]
    .replace(/\b(fresh|freshly|finely|coarsely|roughly|thinly|chopped|minced|grated|sliced|diced|peeled|crushed|drained|rinsed|packed|ground|whole|plain|full-fat|low-sodium|unsalted|boneless|skinless|extra-virgin|homemade|optional|divided|softened|melted|beaten|smashed|torn|trimmed|cooked|uncooked|dried|prepared)\b/gi, ' ')
    .replace(/\s+/g,' ').trim().toLowerCase();
  return s;
}
/* Heuristic English singularizer, scoped to shopping-list merge keys only
   (not ingredientNoun itself, which other matching logic like haveInInventory
   already depends on as-is) -- so "2 onions" from one recipe and "1 large
   onion" from another land on the same shopping-list line instead of two. */
const SINGULAR_EXCEPTIONS = new Set(['hummus','asparagus','molasses','couscous','watercress','swiss','citrus','leftovers']);
function singularizeWord(w){
  if(SINGULAR_EXCEPTIONS.has(w)) return w;
  if(/[^aeiou]ies$/.test(w)) return w.slice(0,-3)+'y';        /* berries -> berry */
  if(/oes$/.test(w)) return w.slice(0,-2);                     /* tomatoes/potatoes -> tomato/potato */
  if(/(ches|shes|xes|zes)$/.test(w)) return w.slice(0,-2);     /* dishes/boxes -> dish/box */
  if(/ss$/.test(w) || /us$/.test(w)) return w;                 /* glass, hummus-like: leave alone */
  if(/s$/.test(w) && w.length>3) return w.slice(0,-1);         /* onions -> onion */
  return w;
}
function mergeNoun(line){
  const n = ingredientNoun(line);
  if(!n) return n;
  const words = n.split(' ');
  words[words.length-1] = singularizeWord(words[words.length-1]);
  return words.join(' ');
}
function keyIngredients(r){
  const out = new Set();
  (r.ingredients||[]).forEach(line=>{
    const n = ingredientNoun(line);
    if(!n || n.length < 3) return;
    if(STAPLE_WORDS.some(w=> n===w || n.indexOf(w)!==-1 && n.length < w.length+4)) return;
    out.add(n);
  });
  return out;
}
const KEY_CACHE = new Map();
function keyIng(r){ if(!KEY_CACHE.has(r.id)) KEY_CACHE.set(r.id, keyIngredients(r)); return KEY_CACHE.get(r.id); }
const PERISHABLE_SECTIONS = ['Produce','Dairy & Eggs','Meat & Seafood'];
const HERB_RE = /\b(basil|cilantro|parsley|dill|mint|thyme|rosemary|sage|tarragon|chive|oregano|scallion|herb)\b/i;
/* Overlap is scored by what would otherwise go to waste: a half-bunch of dill or
   a tub of ricotta is worth far more than a shared pantry staple. */
function overlapWeight(a, b){
  let w = 0, shared = [];
  keyIng(a).forEach(x=>{
    if(!keyIng(b).has(x)) return;
    shared.push(x);
    if(HERB_RE.test(x)) w += 3.0;
    else if(/\b(can|canned|jarred|jar|dried|frozen|paste|powder)\b/i.test(x)) w += 0.5;
    else if(PERISHABLE_SECTIONS.indexOf(sectionFor(x)) !== -1) w += 2.0;
    else w += 0.5;
  });
  return {weight: w, shared};
}
function overlapCount(a, b){ return overlapWeight(a, b).shared.length; }

/* ---------------- suggestion engine ---------------- */
function hashJitter(str){ let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))|0; return Math.abs(h)%7; }
/* what fraction of a recipe's key ingredients are already in some tier of storage --
   used both to nudge score and to say plainly "you have what this needs" in why. */
function inventoryMatchRatio(r){
  const ing = [...keyIng(r)];
  if(!ing.length) return 0;
  return ing.filter(n=> haveInInventory(n)).length / ing.length;
}
function scoreFor(r, iso, ctx){
  if(ctx.used.has(r.id)) return -Infinity;
  const dayIdx = (dateOf(iso).getDay()+6)%7;      /* 0 = Monday */
  const weeknight = dayIdx <= 3;
  let s = 0, why = [];

  const n = timesMade(r.id), d = daysSince(lastMade(r.id));
  if(n === 0){ s += 52; why.push('try something new'); }
  else if(d >= STALE_DAYS){ s += 44 + Math.min(d - STALE_DAYS, 200)/10; why.push("haven't had it in a while"); }
  else if(d >= 30){ s += 8; }
  else { s -= 65; }
  if(n >= 3 && d >= 30){ s += 10; why.push('a regular favourite'); }

  const avg = avgRating(r.id);
  if(avg) s += (avg - 3) * 4.5;
  if(avg === 5) why.unshift('5-star favorite');

  const t = r._plan;
  if(t !== null){
    if(weeknight && t > 50){ s -= (t - 50) / 2; }
    if(!weeknight && t > 60){ s += 7; }
    if(weeknight && t <= 40){ s += 6; }
  }
  if(r._ahead && weeknight) s -= 14;

  const cuisineHits = ctx.slotted.filter(o=> o.cuisine === r.cuisine).length;
  if(cuisineHits) s -= 34 * cuisineHits;
  const catHits = ctx.slotted.filter(o=> o.category === r.category).length;
  if(catHits >= 4) s -= 12 * (catHits - 3);

  let ov = 0, shared = [];
  ctx.slotted.forEach(other=>{
    const o = overlapWeight(r, other);
    if(o.weight > ov){ ov = o.weight; shared = o.shared; }
  });
  if(ov >= 2){
    s += Math.min(ov, 9) * 7;
    const herb = shared.find(x=> HERB_RE.test(x));
    why.push(herb ? ('shares the '+herb) : 'uses what you already need');
  }

  /* separate from week-to-week overlap: does the pantry/fridge/freezer already
     cover this recipe right now? */
  const invRatio = inventoryMatchRatio(r);
  if(keyIng(r).size && invRatio >= 0.99){ s += 12; why.unshift('have all the ingredients'); }
  else if(invRatio >= 0.6){ s += 5; }

  /* Using up something before it goes bad beats almost every other reason to
     cook a given dish tonight -- weighted and surfaced ahead of the plainer
     "have all the ingredients" case above. */
  const expiring = usesExpiringSoon(r);
  if(expiring.length){ s += 20; why.unshift('uses '+expiring[0]+' before it goes bad'); }

  /* a dish big enough to feed the household twice is a mild plus, not a driver */
  const sv = r._servings;
  if(sv && sv.servingBased && sv.base >= prefs().household * 2) s += 5;

  s += hashJitter(r.id + iso);
  return {score: s, why: why.slice(0,2).join(' · ')};
}
function weekContext(weekStart, skipIso){
  const used = new Set(), cuisines = new Set(), slotted = [];
  for(let i=0;i<7;i++){
    const iso = addDays(weekStart, i);
    if(iso === skipIso) continue;
    dinnerSlotsFor(iso).forEach(e=>{
      if(e.leftoverOf || !e.recipeId) return;
      const r = recipeById(e.recipeId);
      if(!r) return;
      used.add(r.id); cuisines.add(r.cuisine); slotted.push(r);
    });
  }
  return {used, cuisines, slotted};
}
function candidatesFor(iso, ctx, includeAll){
  const pool = RECIPES.filter(r=> includeAll ? true : isDinnerish(r));
  return pool.map(r=>{
    const sc = scoreFor(r, iso, ctx);
    return sc === -Infinity ? null : {r, score: sc.score, why: sc.why};
  }).filter(Boolean).sort((a,b)=> b.score - a.score);
}
/* ---------------- prep tasks ---------------- */
function prepTasks(weekStart){
  const out = [];
  for(let i=0;i<7;i++){
    const iso = addDays(weekStart, i);
    dinnerSlotsFor(iso).forEach(e=>{
      if(e.leftoverOf || !e.recipeId) return;
      const r = recipeById(e.recipeId);
      if(!r || !r._ahead) return;
      const lead = r._ahead.minutes;
      const onIso = lead >= 8*60 ? addDays(iso, -1) : iso;
      out.push({when: onIso, forIso: iso, recipe: r, label: r._ahead.label, minutes: lead});
    });
  }
  return out.sort((a,b)=> a.when.localeCompare(b.when));
}

/* ---------------- inventory (pantry / fridge / freezer / shopping) ---------------- */
function invItems(kind){ return DATA.inventory.items.filter(it=> it.kind===kind && !it._d); }
function addInvItem(kind, name, qty, unit, listId, useBy){
  const row = {id:uid(), kind, name, qty: qty||'', unit: unit||'', listId: listId||null, useBy: useBy||null, _t: Date.now()};
  DATA.inventory.items.push(row);
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'inventory_items', kind, row});
  return row;
}
/* ---------------- use-by / expiration ---------------- */
function useByStatus(iso){
  if(!iso) return null;
  const d = -daysSince(iso);
  if(d < 0) return {label:'expired '+relTime(iso), urgency:'over'};
  if(d === 0) return {label:'use today', urgency:'soon'};
  if(d <= 3) return {label:'use in '+d+'d', urgency:'soon'};
  return {label:'use by '+iso, urgency:'ok'};
}
/* Pantry/fridge/freezer items with a use-by inside the urgency window,
   matched against recipes the same way haveInInventory() already does --
   reusing that matching logic rather than a second one. */
function expiringSoonNouns(){
  const all = [...invItems('pantry'), ...invItems('fridge'), ...invItems('freezer')];
  return all.filter(it=> it.useBy && hasQty(it) && useByStatus(it.useBy).urgency!=='ok')
    .map(it=> String(it.name).toLowerCase());
}
function usesExpiringSoon(r){
  const soon = expiringSoonNouns();
  if(!soon.length) return [];
  return [...keyIng(r)].filter(n=> soon.some(s=> n.indexOf(s)!==-1));
}
/* ---------------- named shopping lists ---------------- */
/* "Which list am I even looking at" was the actual complaint -- one
   unnamed always-current bucket couldn't distinguish "this week" from
   "Costco run" from "party". Lists themselves sync (shared across the
   household, like everything else); which one you're currently VIEWING is
   local-only per device (localStorage) -- Nick and Tyler might reasonably
   be looking at different lists on their own phones at the same time. */
function getShoppingLists(){ return DATA.shoppingLists.filter(l=>!l._d).sort((a,b)=>(a._t||0)-(b._t||0)); }
function addShoppingList(name){
  const row = {id:uid(), name, _t: Date.now()};
  DATA.shoppingLists.push(row);
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'shopping_lists', row});
  return row;
}
function renameShoppingList(id, name){
  const l = DATA.shoppingLists.find(x=>x.id===id);
  if(!l) return;
  l.name = name; l._t = Date.now();
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'shopping_lists', row:l});
}
function deleteShoppingList(id){
  const l = DATA.shoppingLists.find(x=>x.id===id);
  if(!l) return;
  l._d = true; l._t = Date.now();
  DATA.inventory.items.filter(it=> it.kind==='shopping' && it.listId===id && !it._d).forEach(it=>{
    it._d = true; it._t = Date.now();
    if(typeof pushWrite === 'function') pushWrite({table:'inventory_items', kind: it.kind, row: it});
  });
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'shopping_lists', row: l});
}
const ACTIVE_SHOP_LIST_KEY = 'cookbook.activeShopList';
function getActiveShopListId(){ try{ return localStorage.getItem(ACTIVE_SHOP_LIST_KEY) || null; }catch(e){ return null; } }
function setActiveShopListId(id){ try{ localStorage.setItem(ACTIVE_SHOP_LIST_KEY, id||''); }catch(e){} }
/* Ensures there's always at least one list to land on, and that the
   locally-remembered "active" one still actually exists (it may have been
   deleted from another device, or this may be a first-ever visit). */
function ensureActiveShopList(){
  let lists = getShoppingLists();
  if(!lists.length){
    addShoppingList('Shopping list');
    lists = getShoppingLists();
  }
  let active = getActiveShopListId();
  if(!active || !lists.some(l=>l.id===active)){
    active = lists[0].id;
    setActiveShopListId(active);
  }
  return active;
}
function removeInvItem(id){
  const it = DATA.inventory.items.find(x=>x.id===id);
  if(it){ it._d = true; it._t = Date.now(); }
  persist();
  if(it && typeof pushWrite === 'function') pushWrite({table:'inventory_items', kind: it.kind, row: it});
}
/* marking something empty both zeroes it out in place and (if not already
   queued) drops it onto the shopping list, so "ran out" becomes "need to buy"
   without a separate step. */
function markInvEmpty(id){
  const it = DATA.inventory.items.find(x=>x.id===id);
  if(!it) return;
  it.qty = 0; it._t = Date.now();
  const already = invItems('shopping').some(s=> s.name.toLowerCase() === it.name.toLowerCase());
  persist();
  if(typeof pushWrite === 'function') pushWrite({table:'inventory_items', kind: it.kind, row: it});
  if(!already) addInvItem('shopping', it.name, '', it.unit, ensureActiveShopList());
}
function hasQty(it){ return !(it.qty===0 || it.qty==='0' || it.qty===''); }
/* ---------------- shopping list ---------------- */
function haveInInventory(noun){
  const inv = [...invItems('pantry'), ...invItems('fridge'), ...invItems('freezer')];
  return inv.find(it=> it && it.name && hasQty(it) && noun.indexOf(String(it.name).toLowerCase()) !== -1);
}
function buildShoppingList(weekStart, listId){
  const bySection = {};
  const seen = new Map();
  /* weekStart is optional -- a standalone shopping list (no meal plan involved)
     just skips straight to the manually-added "extra" items below. Manual
     extras only ever belong to one named list at a time (listId) -- the
     week-based "Shopping & prep" panel (weekStart set) shows recipe-driven
     ingredients only, not mixed in with whichever named list happens to be
     active, since a specific week isn't itself one of the named lists. */
  for(let i=0; weekStart && i<7; i++){
    const iso = addDays(weekStart, i);
    slotsFor(iso).forEach(e=>{
      if(e.leftoverOf) return;
      if(e.recipeId){
        const r = recipeById(e.recipeId);
        if(!r) return;
        const f = slotFactor(e, r);
        (r.ingredients||[]).forEach(line=>{
          if(line.trim().endsWith(':')) return;
          const noun = mergeNoun(line);
          if(!noun || noun.length < 3) return;
          const scaled = scaleLine(line, f).text;
          const sec = sectionFor(line);
          const key = sec + '|' + noun;
          if(seen.has(key)){ seen.get(key).from.push(displayTitle(r)); return; }
          const item = {key, text: scaled, from: [displayTitle(r)], have: !!haveInInventory(noun)};
          seen.set(key, item);
          (bySection[sec] || (bySection[sec] = [])).push(item);
        });
      } else if(e.manualName && e.manualIngredients && e.manualIngredients.length){
        e.manualIngredients.forEach(line=>{
          const noun = mergeNoun(line);
          if(!noun || noun.length < 2) return;
          const sec = sectionFor(line);
          const key = sec + '|manual|' + noun;
          if(seen.has(key)){ seen.get(key).from.push(e.manualName); return; }
          const item = {key, text: line, from: [e.manualName], have: !!haveInInventory(noun)};
          seen.set(key, item);
          (bySection[sec] || (bySection[sec] = [])).push(item);
        });
      }
    });
  }
  if(!weekStart){
    /* Manually-added items now sort into the same grocery-aisle sections
       (Produce, Dairy & Eggs, Pantry, ...) as recipe-driven ingredients
       instead of landing in one undifferentiated "Shopping list" catch-all
       -- auto-assigned by name via the same sectionFor() rules, no need to
       pick a category when adding an item. Also merged by noun the same way
       recipe-driven ingredients are: saving two recipes that both call for
       onions (or one for "onions", one for "1 large onion") lands one
       "onion" line, not two, since "Save ingredients to list" has no other
       opportunity to notice the overlap the way a week's plan does. */
    const extraSeen = new Map();
    invItems('shopping').filter(it=> it.listId === listId).forEach(it=>{
      const sec = sectionFor(it.name);
      const noun = mergeNoun(it.name);
      const text = [it.qty, it.unit, it.name].filter(Boolean).join(' ');
      const key = (noun && noun.length >= 3) ? 'extra|'+sec+'|'+noun : 'extra|id|'+it.id;
      if(extraSeen.has(key)){
        const item = extraSeen.get(key);
        item.from.push('added manually');
        item.invIds.push(it.id);
        return;
      }
      const item = {key, text, from: ['added manually'], have: false, invIds: [it.id]};
      extraSeen.set(key, item);
      (bySection[sec] || (bySection[sec] = [])).push(item);
    });
  }
  return bySection;
}
/* Checked-off ("bought while out and about") state -- local to this device
   on purpose: a shopping trip is normally one person, one phone, and this
   list is fully recomputed from the live plan/inventory on every render
   anyway (it's not a saved/named list of its own -- see the household
   question this raised), so there's nothing meaningful to sync yet. */
const SHOP_CHECKED_KEY = 'cookbook.shopChecked';
function loadShopChecked(){ try{ return JSON.parse(localStorage.getItem(SHOP_CHECKED_KEY)) || {}; }catch(e){ return {}; } }
function isShopChecked(key){ return !!loadShopChecked()[key]; }
function toggleShopChecked(key){
  const m = loadShopChecked();
  if(m[key]) delete m[key]; else m[key] = true;
  try{ localStorage.setItem(SHOP_CHECKED_KEY, JSON.stringify(m)); }catch(e){}
}
function clearShopChecked(){ try{ localStorage.removeItem(SHOP_CHECKED_KEY); }catch(e){} }
const SECTION_ORDER = ['Produce','Meat & Seafood','Dairy & Eggs','Bakery','Frozen','Pantry','Spices','Other'];

/* ---------------- view switching ---------------- */
let view = 'cookbook';
let weekStart = mondayOf(todayISO());

function setView(v){
  view = v;
  document.getElementById('cookbookView').style.display    = v==='cookbook' ? '' : 'none';
  document.getElementById('planView').style.display        = v==='plan'     ? '' : 'none';
  document.getElementById('shoppingViewWrap').style.display = v==='shopping' ? '' : 'none';
  document.getElementById('historyView').style.display     = v==='history'  ? '' : 'none';
  document.getElementById('storageView').style.display     = v==='storage'  ? '' : 'none';
  document.querySelectorAll('#viewTabs .vt').forEach(b=> b.classList.toggle('on', b.dataset.view===v));
  document.getElementById('viewTabsMobile').value = v;
  if(v==='plan') renderWeek();
  if(v==='shopping') renderStandaloneShopping();
  if(v==='history') renderHistory();
  if(v==='storage') renderStorage();
}
document.querySelectorAll('#viewTabs .vt').forEach(b=> b.onclick = ()=> setView(b.dataset.view));
document.getElementById('viewTabsMobile').onchange = (e)=> setView(e.target.value);
/* the "Cookbook" tab was removed (2026-09-02) -- clicking the site title is now
   the way back from Plan/History/Storage, since those tabs no longer have a
   sibling "Cookbook" button to click back to. */
document.getElementById('homeTitle').onclick = ()=> setView('cookbook');

/* ---------------- week rendering ---------------- */
function slotRowHTML(s, iso){
  if(s.leftoverOf){
    const src = slotById(s.leftoverOf);
    const srcR = src && src.recipeId ? recipeById(src.recipeId) : null;
    const srcName = srcR ? displayTitle(srcR) : (src && src.manualName) || '';
    return `<div class="slot leftover" data-sid="${s.id}">
        <div class="slot-title">Leftovers</div>
        <div class="slot-meta">${src?`<span class="lo-pill">from ${DAY_NAMES[(dateOf(src.iso).getDay()+6)%7]}</span>`:''}${srcName?`<span>${escapeHTML(srcName)}</span>`:''}</div>
        <div class="slot-actions"><button data-clear="${s.id}">×</button></div>
      </div>`;
  }
  if(s.manualName){
    return `<div class="slot" data-sid="${s.id}">
        <div class="slot-title">${escapeHTML(s.manualName)}</div>
        <div class="slot-meta"><span class="lo-pill">custom dish</span></div>
        <div class="slot-actions">
          <button data-add="${iso}" data-meal="${s.mealType}" data-swap="${s.id}">edit</button>
          <button data-lo="${s.id}">leftovers →</button>
          <button data-clear="${s.id}">×</button>
        </div>
      </div>`;
  }
  const r = recipeById(s.recipeId);
  if(!r) return `<div class="slot-empty" data-sid="${s.id}"><button data-clear="${s.id}">missing recipe — clear</button></div>`;
  const serv = slotServings(s, r);
  const cooked = cookEvents(r.id).some(ev=> ev.date === iso);
  const meta = [];
  if(r._plan) meta.push(`<span>${fmtDur(r._plan)}</span>`);
  if(serv) meta.push(`<span>serves ${serv}</span>`);
  meta.push(`<span>${zwsp(escapeHTML(r.cuisine))}</span>`);
  if(serv && serv >= prefs().household * 2) meta.push(`<span class="lo-pill">makes leftovers</span>`);
  if(r._ahead) meta.push(`<span class="ahead-pill">${r._ahead.label}</span>`);
  if(cooked) meta.push(`<span class="cooked-flag">✓ cooked</span>`);
  return `<div class="slot" data-sid="${s.id}">
      <div class="slot-title" data-open="${r.id}">${zwsp(escapeHTML(displayTitle(r)))}</div>
      <div class="slot-meta">${meta.join('')}</div>
      <div class="slot-actions">
        <button class="${cooked?'done':''}" data-cook="${s.id}">${cooked?'✓ cooked':'cooked'}</button>
        <button data-add="${iso}" data-meal="${s.mealType}" data-swap="${s.id}">swap</button>
        <button data-lo="${s.id}">leftovers →</button>
        <button data-clear="${s.id}">×</button>
      </div>
    </div>`;
}
function mealBlockHTML(iso, mealType, label){
  const slots = slotsFor(iso).filter(s=> (s.mealType||'dinner') === mealType);
  let html = `<div class="meal-block"><div class="meal-label">${label}</div>`;
  slots.forEach(s=> html += slotRowHTML(s, iso));
  /* the per-day "suggest" button (separate from the removed "Suggest the
     week") was one more full row on every single empty day -- the picker
     opened by "+ add dinner" already leads with the same top suggestion
     ("Suggested for this night"), so this was a second way to reach the
     exact same thing, at a real cost in vertical space across 7 empty
     days. */
  html += `<div class="slot-empty">
      <button data-add="${iso}" data-meal="${mealType}">+ add ${label.toLowerCase()}</button>
    </div></div>`;
  return html;
}
function renderWeek(){
  const grid = document.getElementById('weekGrid');
  document.getElementById('weekRange').textContent = fmtRange(weekStart, addDays(weekStart,6));
  grid.innerHTML = '';
  const today = todayISO();

  for(let i=0;i<7;i++){
    const iso = addDays(weekStart, i);
    const cell = document.createElement('div');
    cell.className = 'day' + (iso===today ? ' today' : '') + (iso<today ? ' past' : '');
    let inner = `<div class="day-head"><span>${DAY_NAMES[i]}</span><span class="dnum">${dateOf(iso).getDate()}</span></div>`;
    /* .day-body wraps Dinner+Lunch so mobile can lay the day out as
       [date column] [meals column] side by side instead of the date
       taking a full row of its own above them -- see the mobile .day
       flex-direction:row override. */
    inner += `<div class="day-body">`;
    inner += mealBlockHTML(iso, 'dinner', 'Dinner');
    inner += mealBlockHTML(iso, 'lunch', 'Lunch');
    inner += `</div>`;
    cell.innerHTML = inner;
    grid.appendChild(cell);
  }

  grid.querySelectorAll('[data-add]').forEach(b=> b.onclick = ()=> openPicker(b.dataset.add, b.dataset.meal, b.dataset.swap||null));
  grid.querySelectorAll('[data-clear]').forEach(b=> b.onclick = ()=>{ removeSlot(b.dataset.clear); renderWeek(); });
  grid.querySelectorAll('[data-open]').forEach(b=> b.onclick = ()=>{ const r=recipeById(b.dataset.open); if(r) openModal(r); });
  grid.querySelectorAll('[data-lo]').forEach(b=> b.onclick = ()=>{
    const srcId = b.dataset.lo, src = slotById(srcId);
    if(!src) return;
    const next = addDays(src.iso, 1);
    const already = slotsFor(next).filter(s=> (s.mealType||'dinner') === (src.mealType||'dinner'));
    if(already.length && !confirm('Add leftovers alongside what is already planned for the next day?')) return;
    addSlot(next, src.mealType||'dinner', {leftoverOf: srcId});
    renderWeek();
  });
  grid.querySelectorAll('[data-cook]').forEach(b=> b.onclick = ()=>{
    const sid = b.dataset.cook, s = slotById(sid);
    if(!s || !s.recipeId) return;
    const existing = cookEvents(s.recipeId).find(ev=> ev.date === s.iso);
    if(existing) removeCook(existing.id); else addCook(s.recipeId, s.iso, null, '');
    renderWeek(); renderGrid();
  });

  renderUseupStrip();
  renderPrepStrip();
  renderWeekSummary();
  if(document.getElementById('shopPanel').dataset.open) renderShop();
}

/* Surfaces recipes that use up something already expiring, right on the plan
   view -- scoreFor() already weighs this (usesExpiringSoon, +20, top billing
   in "why") but that only mattered once you'd opened a day's picker; this
   puts the same signal in front of you without asking first. Scoped to the
   curated RECIPES set only, same as scoreFor/candidatesFor and the "What I
   can make now" sort -- archive rows don't carry ingredients locally until
   opened, so scanning all 60k+ per render isn't an option. */
function renderUseupStrip(){
  const host = document.getElementById('useupStrip');
  if(!host) return;
  if(!expiringSoonNouns().length){ host.innerHTML = ''; return; }
  const ctx = weekContext(weekStart, null);
  const today = todayISO();
  const cands = RECIPES
    .filter(r=> isDinnerish(r) && !ctx.used.has(r.id) && usesExpiringSoon(r).length)
    .map(r=> ({r, sc: scoreFor(r, today, ctx)}))
    .sort((a,b)=> b.sc.score - a.sc.score)
    .slice(0,3);
  if(!cands.length){ host.innerHTML = ''; return; }
  host.innerHTML = `<div class="useup-strip"><b>Use it up before it goes bad</b>` +
    cands.map(({r,sc})=>`
      <div class="useup-card">
        <span>${escapeHTML(displayTitle(r))}<br><span class="uc-why">${escapeHTML(sc.why)}</span></span>
        <button class="tb-btn" data-useup-add="${escapeHTML(r.id)}">Add to plan</button>
      </div>`).join('') + `</div>`;
  host.querySelectorAll('[data-useup-add]').forEach(b=>{
    b.onclick = ()=>{ const r = recipeById(b.dataset.useupAdd); if(r) openAddToPlanMenu(b, r); };
  });
}
function renderPrepStrip(){
  const host = document.getElementById('prepStrip');
  const tasks = prepTasks(weekStart);
  if(!tasks.length){ host.innerHTML=''; return; }
  host.innerHTML = `<div class="prep-strip"><b>Prep ahead this week</b>` + tasks.map(t=>{
    const dayName = DAY_NAMES[(dateOf(t.when).getDay()+6)%7];
    const forName = DAY_NAMES[(dateOf(t.forIso).getDay()+6)%7];
    const same = t.when === t.forIso;
    return `<div class="pline">${dayName} ${fmtDayLabel(t.when)} — <b>${t.label.toLowerCase()}</b> the ${escapeHTML(displayTitle(t.recipe))}${same?` (about ${fmtDur(t.minutes)} before you eat)`:` for ${forName}`}</div>`;
  }).join('') + `</div>`;
}

function renderWeekSummary(){
  const host = document.getElementById('weekSummary');
  let filled=0, mins=0, news=0; const cuis=new Set();
  for(let i=0;i<7;i++){
    dinnerSlotsFor(addDays(weekStart,i)).forEach(e=>{
      if(e.leftoverOf) return;
      if(!e.recipeId){ if(e.manualName) filled++; return; }
      const r = recipeById(e.recipeId); if(!r) return;
      filled++; mins += r._plan||0; cuis.add(r.cuisine);
      if(timesMade(r.id)===0) news++;
    });
  }
  if(!filled){ host.innerHTML=''; return; }
  host.innerHTML = `<div class="week-summary">
    <span><b>${filled}</b> dinners planned</span>
    <span><b>${cuis.size}</b> cuisines</span>
    <span><b>${news}</b> never made before</span>
    <span>about <b>${fmtDur(Math.round(mins/filled))}</b> a night on average</span>
  </div>`;
}

function renderShopInto(hostId, ws, rerender){
  const host = document.getElementById(hostId);
  /* The week-based "Shopping & prep" panel (ws set) has no named-list concept
     of its own -- a specific week isn't one of your named lists, it's
     recipe-driven ingredients for THAT week. Only the standalone Shopping
     tab deals in named lists. */
  const activeId = ws ? null : ensureActiveShopList();
  const lists = ws ? [] : getShoppingLists();
  const activeList = lists.find(l=>l.id===activeId);
  const list = buildShoppingList(ws, activeId);
  const secs = SECTION_ORDER.filter(s=> list[s] && list[s].length);
  const title = ws ? `Shopping list — ${fmtRange(ws, addDays(ws,6))}` : (activeList ? activeList.name : 'Shopping list');
  const anyChecked = Object.keys(loadShopChecked()).length > 0;
  const hasExtras = ws ? false : invItems('shopping').some(it=> it.listId===activeId);

  const listSwitcher = ws ? '' : `<div class="shop-lists">
    ${lists.map(l=>`<button class="tb-btn${l.id===activeId?' on':''}" data-switch-list="${l.id}">${escapeHTML(l.name)}</button>`).join('')}
    <button class="tb-btn" id="shopNewList">+ New list</button>
  </div>`;
  const headActions = ws ? '' : `<div class="shop-head-actions">
    <button class="tb-btn" id="shopRenameList" title="Rename this list">Rename</button>
    ${lists.length>1 ? `<button class="tb-btn" id="shopDeleteList" title="Delete this list">Delete list</button>` : ''}
    ${(hasExtras || anyChecked) ? `<button class="tb-btn clear-btn" id="shopClearList">Clear list</button>` : ''}
  </div>`;

  if(!secs.length){
    host.innerHTML = `<div class="shop">${listSwitcher}<div class="shop-head"><h3>${escapeHTML(title)}</h3>${headActions}</div><div class="shop-empty">${ws ? 'Plan some dinners first, or add items from Storage.' : 'Nothing on this list yet — add items below.'}</div></div>`;
  } else {
    /* Every item (recipe-driven or manual) gets a check-off you can tap while
       actually at the store -- "have I bought this yet" -- separate from
       deleting, which only makes sense for the manually-added ones (a
       recipe-driven line comes back on its own next time you plan that
       dinner, so "delete" would just be undone by the plan itself). Clear
       list resets both: removes every item on THIS list and forgets which
       boxes were checked, for starting the next trip fresh. */
    host.innerHTML = `<div class="shop">
      ${listSwitcher}
      <div class="shop-head">
        <h3>${escapeHTML(title)}</h3>
        ${headActions}
      </div>
      <div class="shop-cols">${secs.map(s=>`
        <div class="shop-sec"><h4>${s}</h4><ul>${list[s].map(it=>{
          const checked = isShopChecked(it.key);
          return `<li class="${checked?'shop-checked':''}">
            <span class="shop-check" data-check="${escapeHTML(it.key)}" role="checkbox" aria-checked="${checked}">${checked?'☑':'☐'}</span>
            <span class="shop-item-text">${it.have?'<span class="from">[have] </span>':''}${zwsp(escapeHTML(it.text))}${it.from.length>1?` <span class="from">×${it.from.length}</span>`:''}</span>
            ${it.invIds?` <span class="ch-del" data-del="${it.invIds.join(',')}">delete</span>`:''}
          </li>`;
        }).join('')}</ul></div>`).join('')}</div>
    </div>`;
  }
  host.querySelectorAll('[data-check]').forEach(el=> el.onclick = ()=>{ toggleShopChecked(el.dataset.check); rerender(); });
  host.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=>{ b.dataset.del.split(',').forEach(removeInvItem); rerender(); });
  host.querySelectorAll('[data-switch-list]').forEach(b=> b.onclick = ()=>{ setActiveShopListId(b.dataset.switchList); rerender(); });
  const newListBtn = host.querySelector('#shopNewList');
  if(newListBtn) newListBtn.onclick = ()=>{
    const name = prompt('Name for the new list (e.g. "Costco run", "Party"):');
    if(!name || !name.trim()) return;
    const row = addShoppingList(name.trim());
    setActiveShopListId(row.id);
    rerender();
  };
  const renameBtn = host.querySelector('#shopRenameList');
  if(renameBtn) renameBtn.onclick = ()=>{
    const name = prompt('Rename this list:', activeList ? activeList.name : '');
    if(!name || !name.trim()) return;
    renameShoppingList(activeId, name.trim());
    rerender();
  };
  const deleteListBtn = host.querySelector('#shopDeleteList');
  if(deleteListBtn) deleteListBtn.onclick = ()=>{
    if(!confirm(`Delete "${activeList ? activeList.name : 'this list'}" and everything on it?`)) return;
    deleteShoppingList(activeId);
    setActiveShopListId(null); /* ensureActiveShopList picks a fresh one next render */
    rerender();
  };
  const clearBtn = host.querySelector('#shopClearList');
  if(clearBtn) clearBtn.onclick = ()=>{
    if(!confirm('Clear this list? This removes every item on it and un-checks everything.')) return;
    invItems('shopping').filter(it=>it.listId===activeId).forEach(it=> removeInvItem(it.id));
    clearShopChecked();
    rerender();
  };
}
function renderShop(){ renderShopInto('shopPanel', weekStart, renderShop); }
function renderStandaloneShopping(){ renderShopInto('shoppingView', null, renderStandaloneShopping); }

/* ---------------- storage (pantry / fridge / freezer / shopping) ---------------- */
function renderStorage(){
  const host = document.getElementById('storagePanel');
  const label = {pantry:'Pantry', fridge:'Fridge', freezer:'Freezer'};
  const kindSec = k => `
    <div class="inv-sec">
      <h4>${label[k]}</h4>
      <ul class="inv-list">${invItems(k).map(it=>{
        const st = useByStatus(it.useBy);
        return `
        <li class="inv-row" data-id="${it.id}">
          <span class="inv-name${hasQty(it)?'':' inv-out'}">${escapeHTML(it.name)}</span>
          <span class="inv-qty">${escapeHTML([it.qty,it.unit].filter(Boolean).join(' '))}</span>
          ${st ? `<span class="inv-useby inv-useby-${st.urgency}">${escapeHTML(st.label)}</span>` : ''}
          <button class="ch-del" data-empty="${it.id}">out</button>
          <button class="ch-del" data-remove="${it.id}">×</button>
        </li>`;
      }).join('') || '<li class="inv-empty">Nothing tracked yet.</li>'}</ul>
      <div class="inv-add">
        <input type="text" placeholder="Item" id="invName-${k}">
        <input type="text" placeholder="Qty" id="invQty-${k}">
        <input type="text" placeholder="Unit" id="invUnit-${k}">
        <input type="date" placeholder="Use by" id="invUseBy-${k}" title="Use by (optional)">
        <button class="cook-btn" data-addkind="${k}">Add</button>
      </div>
    </div>`;
  const shopping = invItems('shopping');
  host.innerHTML = `<div class="settings">
    <h3>Storage — ${escapeHTML(HOUSEHOLD_LABEL[currentHousehold()]||'')}</h3>
    <p class="hint">Private to your household. Mark something "out" to zero it and drop it onto the shopping list automatically.</p>
    <div class="inv-grid">
      ${INVENTORY_KINDS.map(kindSec).join('')}
      <div class="inv-sec">
        <h4>Shopping list</h4>
        <ul class="inv-list">${shopping.map(it=>`
          <li class="inv-row" data-id="${it.id}">
            <span class="inv-name">${escapeHTML([it.qty,it.unit,it.name].filter(Boolean).join(' '))}</span>
            <button class="ch-del" data-remove="${it.id}">bought</button>
          </li>`).join('') || '<li class="inv-empty">Nothing on the list.</li>'}</ul>
        <div class="inv-add">
          <input type="text" placeholder="Item" id="invName-shopping">
          <input type="text" placeholder="Qty" id="invQty-shopping">
          <input type="text" placeholder="Unit" id="invUnit-shopping">
          <button class="cook-btn" data-addkind="shopping">Add</button>
        </div>
      </div>
    </div>
  </div>`;
  host.querySelectorAll('[data-addkind]').forEach(b=> b.onclick = ()=>{
    const k = b.dataset.addkind;
    const nameEl = document.getElementById('invName-'+k);
    const name = nameEl.value.trim();
    if(!name) return;
    const useByEl = document.getElementById('invUseBy-'+k);
    addInvItem(k, name, document.getElementById('invQty-'+k).value.trim(), document.getElementById('invUnit-'+k).value.trim(), k==='shopping' ? ensureActiveShopList() : undefined, useByEl ? useByEl.value || null : null);
    renderStorage();
  });
  host.querySelectorAll('[data-empty]').forEach(b=> b.onclick = ()=>{ markInvEmpty(b.dataset.empty); renderStorage(); });
  host.querySelectorAll('[data-remove]').forEach(b=> b.onclick = ()=>{ removeInvItem(b.dataset.remove); renderStorage(); });
}

document.getElementById('weekPrev').onclick  = ()=>{ weekStart = addDays(weekStart,-7); renderWeek(); };
document.getElementById('weekNext').onclick  = ()=>{ weekStart = addDays(weekStart, 7); renderWeek(); };
document.getElementById('weekToday').onclick = ()=>{ weekStart = mondayOf(todayISO()); renderWeek(); };
document.getElementById('clearWeek').onclick = ()=>{
  if(!confirm('Clear every meal planned this week?')) return;
  for(let i=0;i<7;i++) slotsFor(addDays(weekStart,i)).forEach(s=> removeSlot(s.id));
  renderWeek();
};
document.getElementById('shopBtn').onclick = ()=>{
  const p = document.getElementById('shopPanel');
  if(p.dataset.open){ p.dataset.open=''; p.innerHTML=''; }
  else { p.dataset.open='1'; renderShop(); }
};
document.getElementById('shopAddBtn').onclick = ()=>{
  const nameEl = document.getElementById('shopAddName');
  const name = nameEl.value.trim();
  if(!name) return;
  addInvItem('shopping', name, document.getElementById('shopAddQty').value.trim(), document.getElementById('shopAddUnit').value.trim(), ensureActiveShopList());
  nameEl.value = ''; document.getElementById('shopAddQty').value=''; document.getElementById('shopAddUnit').value='';
  nameEl.focus();
  renderStandaloneShopping();
};
['shopAddName','shopAddQty','shopAddUnit'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('shopAddBtn').click(); });
});

/* ---------------- household settings ---------------- */
function renderSettings(){
  const host = document.getElementById('settingsPanel');
  if(!host.dataset.open){ host.innerHTML=''; return; }
  const p = prefs();
  const me = currentHousehold();
  const otherHousehold = Object.keys(HOUSEHOLD_LABEL).find(h=>h!==me);
  host.innerHTML = `<div class="settings">
    <div class="house-row">
      <span class="rday">Kitchen</span>
      <span style="font-weight:600;">${escapeHTML(HOUSEHOLD_LABEL[me]||me)}</span>
      ${otherHousehold ? `<button type="button" class="cook-btn" id="switchHousehold" style="padding:3px 10px; font-size:12px;">Switch to ${escapeHTML(HOUSEHOLD_LABEL[otherHousehold])}</button>` : ''}
    </div>
    <div class="house-row">
      <span class="rday">Household</span>
      <div class="step">
        <button type="button" id="hhDown">−</button>
        <div class="step-val">${p.household}</div>
        <button type="button" id="hhUp">+</button>
      </div>
      <span class="hint" style="margin:0; font-size:12.5px;">used to spot meals big enough to leave leftovers</span>
    </div>
    <div class="submit-recipe">
      <div class="rday" style="margin-bottom:8px;">Submit a recipe</div>
      <div class="hint" style="margin:0 0 10px;">Goes in as a draft -- nobody sees it in the cookbook until someone publishes it below.</div>
      <input type="text" id="subTitle" placeholder="Recipe title">
      <input type="hidden" id="subCategory" value="">
      <div id="subCategoryChips" class="picker-course-chips" style="margin-top:8px;"></div>
      <input type="text" id="subCuisine" placeholder="Cuisine (optional)" style="margin-top:8px; width:100%; box-sizing:border-box;">
      <input type="text" id="subServings" placeholder="Servings (optional)" style="margin-top:8px;">
      <textarea id="subIngredients" placeholder="Ingredients, one per line" rows="4" style="margin-top:8px;"></textarea>
      <textarea id="subInstructions" placeholder="Steps, one per line" rows="4" style="margin-top:8px;"></textarea>
      <input type="text" id="subNotes" placeholder="Notes (optional)" style="margin-top:8px;">
      <input type="text" id="subBy" placeholder="Your name (optional)" style="margin-top:8px;">
      <button class="cook-btn" id="subSave" style="margin-top:10px;">Submit draft</button>
      <span class="make-prog" id="subMsg"></span>
    </div>
    ${pendingSubmissions.length ? `<div class="submit-recipe">
      <div class="rday" style="margin-bottom:8px;">Pending recipes (${pendingSubmissions.length})</div>
      ${pendingSubmissions.map(s=>`
        <div class="cook-hist-item">
          <span class="ch-date">${escapeHTML(s.title)}</span>
          ${s.submitted_by?`<span class="ch-note">from ${escapeHTML(s.submitted_by)}</span>`:''}
          <button class="cook-btn" data-pub="${s.id}" style="padding:3px 8px; font-size:11px;">Publish</button>
          <span class="ch-del" data-del="${s.id}">delete</span>
        </div>`).join('')}
    </div>` : ''}
  </div>`;
  const setHH = n =>{
    p.household = Math.max(1, Math.min(20, n)); p._t = Date.now(); persist(); renderSettings(); renderWeek();
    if(typeof pushWrite === 'function') pushWrite({table:'prefs', row:p});
  };
  host.querySelector('#hhUp').onclick   = ()=> setHH(p.household+1);
  host.querySelector('#hhDown').onclick = ()=> setHH(p.household-1);
  const switchBtn = host.querySelector('#switchHousehold');
  if(switchBtn) switchBtn.onclick = ()=> setHousehold(otherHousehold);
  const subCatChips = host.querySelector('#subCategoryChips');
  subCatChips.innerHTML = ALL_CATEGORIES.map(cat=>
    `<span class="facet-link" data-course="${escapeHTML(cat)}">${escapeHTML(cat)}</span>`).join('');
  subCatChips.querySelectorAll('[data-course]').forEach(el=> el.onclick = ()=>{
    const hidden = host.querySelector('#subCategory');
    const wasActive = el.classList.contains('active');
    subCatChips.querySelectorAll('.facet-link').forEach(x=> x.classList.remove('active'));
    hidden.value = wasActive ? '' : el.dataset.course;
    if(!wasActive) el.classList.add('active');
  });
  host.querySelector('#subSave').onclick = async ()=>{
    const title = host.querySelector('#subTitle').value.trim();
    const msg = host.querySelector('#subMsg');
    if(!title){ msg.textContent = 'needs a title'; return; }
    const ingredients = host.querySelector('#subIngredients').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const instructions = host.querySelector('#subInstructions').value.split('\n').map(s=>s.trim()).filter(Boolean);
    msg.textContent = 'saving…';
    const res = await submitFamilyRecipe({
      title, category: host.querySelector('#subCategory').value, cuisine: host.querySelector('#subCuisine').value.trim(),
      servings: host.querySelector('#subServings').value.trim(), ingredients, instructions,
      notes: host.querySelector('#subNotes').value.trim(), submittedBy: host.querySelector('#subBy').value.trim(),
    });
    msg.textContent = res.error ? `couldn't save: ${res.error.message}` : 'submitted -- see it below once published';
  };
  host.querySelectorAll('[data-pub]').forEach(b=> b.onclick = ()=> publishSubmission(b.dataset.pub));
  host.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=> deleteSubmission(b.dataset.del));
}
document.getElementById('setBtn').onclick = ()=>{
  const h = document.getElementById('settingsPanel');
  h.dataset.open = h.dataset.open ? '' : '1';
  document.getElementById('setBtn').classList.toggle('on', !!h.dataset.open);
  renderSettings();
};

/* ---------------- picker ---------------- */
let pickerIso = null, pickerMeal = 'dinner', pickerSwapId = null, pickerCourse = null;
function openPicker(iso, mealType, swapId){
  pickerIso = iso;
  pickerMeal = mealType || 'dinner';
  pickerSwapId = swapId || null;
  pickerCourse = null;
  const label = pickerMeal === 'lunch' ? 'Lunch' : 'Dinner';
  document.getElementById('pickerTitle').textContent =
    label + ' for ' + DAY_NAMES[(dateOf(iso).getDay()+6)%7] + ' ' + fmtDayLabel(iso);
  document.getElementById('pickerInput').value = '';
  document.getElementById('pickerCustomForm').classList.remove('open');
  document.getElementById('pcName').value = '';
  document.getElementById('pcIngredients').value = '';
  if(pickerSwapId){
    const s = slotById(pickerSwapId);
    if(s && s.manualName){
      document.getElementById('pcName').value = s.manualName;
      document.getElementById('pcIngredients').value = (s.manualIngredients||[]).join('\n');
      document.getElementById('pickerCustomForm').classList.add('open');
    }
  }
  document.getElementById('pickerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderPicker();
  setTimeout(()=>document.getElementById('pickerInput').focus(), 30);
}
function closePicker(){
  document.getElementById('pickerOverlay').classList.remove('open');
  document.body.style.overflow=''; pickerIso=null; pickerMeal='dinner'; pickerSwapId=null;
}
async function pickRecipe(recipeId){
  if(pickerSwapId) updateSlot(pickerSwapId, {recipeId, manualName: undefined, manualIngredients: undefined, leftoverOf: undefined});
  else addSlot(pickerIso, pickerMeal, {recipeId});
  closePicker(); renderWeek();
  /* the picker lets you plan a dish straight off its card, without ever
     opening its modal -- but the shopping list needs real ingredient lines,
     and a lite archive row (see NYT_LITE_COLUMNS) doesn't have them locally
     yet. Fetch now so the list is right by the time anyone looks at it,
     rather than silently missing this dish's items. */
  const r = recipeById(recipeId);
  if(r && r._lite){ await fetchRecipeDetail(r); renderWeek(); }
}
function saveCustomDish(){
  const name = document.getElementById('pcName').value.trim();
  if(!name) return;
  const ingredients = document.getElementById('pcIngredients').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(pickerSwapId) updateSlot(pickerSwapId, {manualName: name, manualIngredients: ingredients, recipeId: undefined, leftoverOf: undefined});
  else addSlot(pickerIso, pickerMeal, {manualName: name, manualIngredients: ingredients});
  closePicker(); renderWeek();
}
function renderPicker(){
  const q = document.getElementById('pickerInput').value.trim().toLowerCase();
  const ctx = weekContext(weekStart, pickerIso);

  const chipsHost = document.getElementById('pickerCourseChips');
  chipsHost.innerHTML = ALL_CATEGORIES.map(cat=>
    `<span class="facet-link${pickerCourse===cat?' active':''}" data-course="${escapeHTML(cat)}">${escapeHTML(cat)}</span>`).join('');
  chipsHost.querySelectorAll('[data-course]').forEach(el=> el.onclick = ()=>{
    pickerCourse = pickerCourse === el.dataset.course ? null : el.dataset.course;
    renderPicker();
  });

  /* "Suggested for tonight" is always dinner-scoped and algorithmically ranked --
     a distinct feature from the browsable list below, which a course pick or a
     typed search should search across the FULL catalog, not just dinner dishes
     (typing "brownie" or clicking Dessert should just work, not require first
     finding a hidden "include every course" checkbox). */
  const sug = document.getElementById('pickerSuggest');
  if(!q && !pickerCourse){
    const top = candidatesFor(pickerIso, ctx, false).slice(0,3);
    sug.innerHTML = top.length ? `<div class="picker-sug"><h4>Suggested for this night</h4>${top.map(c=>
      `<div class="prow" data-pick="${c.r.id}">
         <span class="pt">${zwsp(escapeHTML(displayTitle(c.r)))}</span>
         <span class="why">${c.why||''}</span>
         <span class="pm">${c.r._plan?fmtDur(c.r._plan):''} · ${zwsp(escapeHTML(c.r.cuisine))}</span>
       </div>`).join('')}</div>` : '';
  } else sug.innerHTML = '';

  let pool;
  if(q || pickerCourse){
    pool = RECIPES.filter(r=> !ctx.used.has(r.id));
    if(pickerCourse) pool = pool.filter(r=> r.category === pickerCourse);
    if(q) pool = pool.filter(r=> matchesQuery(r, q));
    pool.sort((a,b)=> displayTitle(a).localeCompare(displayTitle(b)));
  } else {
    pool = candidatesFor(pickerIso, ctx, false).map(c=>c.r);
  }

  const rows = pool.slice(0, 120);
  document.getElementById('pickerList').innerHTML = rows.map(r=>{
    const n = timesMade(r.id), last = lastMade(r.id);
    return `<div class="prow" data-pick="${r.id}">
      <span class="pt">${zwsp(escapeHTML(displayTitle(r)))}</span>
      <span class="pm">${n?`made ${n}× · ${relTime(last)}`:'never made'} · ${r._plan?fmtDur(r._plan):''} · ${zwsp(escapeHTML(r.cuisine))}</span>
    </div>`;
  }).join('') || `<div class="cook-empty">Nothing matches that.</div>`;

  document.querySelectorAll('#pickerOverlay [data-pick]').forEach(el=> el.onclick = ()=> pickRecipe(el.dataset.pick));
}
document.getElementById('pickerClose').onclick = closePicker;
document.getElementById('pickerOverlay').onclick = e=>{ if(e.target.id==='pickerOverlay') closePicker(); };
document.getElementById('pickerInput').addEventListener('input', renderPicker);
document.getElementById('pickerCustomToggle').onclick = ()=> document.getElementById('pickerCustomForm').classList.toggle('open');
document.getElementById('pcSave').onclick = saveCustomDish;

/* ---------------- history ---------------- */
/* A 4-month mostly-empty calendar grid (entries truncated to ~4 characters
   to fit a day cell) wasn't actually answering "what have we cooked" --
   a reverse-chronological list is: every entry reads in full, newest
   first, searchable, and costs nothing when a month had 2 dinners logged
   instead of 30. */
let historyRenderLimit = 50;
function renderHistory(){
  const all = DATA.cookLog.filter(e=>!e._d).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const q = (document.getElementById('historySearch').value||'').trim().toLowerCase();
  const filtered = q ? all.filter(e=>{
    const r = recipeById(e.recipeId);
    return r && displayTitle(r).toLowerCase().includes(q);
  }) : all;

  const toShow = filtered.slice(0, historyRenderLimit);
  const host = document.getElementById('historyList');
  host.innerHTML = toShow.length ? toShow.map(e=>{
    const r = recipeById(e.recipeId);
    return `<div class="hist-row" data-open="${e.recipeId}">
      <div class="hist-date">${fmtAddedDate(e.date)}</div>
      <div class="hist-main">
        <div class="hist-title">${r?zwsp(escapeHTML(displayTitle(r))):'(recipe no longer on file)'}</div>
        <div class="hist-meta">
          ${e.rating?`<span class="hist-stars">${starStr(e.rating)}</span>`:''}
          ${e.note?`<span class="hist-note">${escapeHTML(e.note)}</span>`:''}
          ${e.leftover?`<span class="hist-note">Leftovers: ${escapeHTML(e.leftover)}</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="shop-empty">${q ? 'Nothing matches that.' : "Nothing logged yet — mark a recipe cooked and it'll show up here."}</div>`;
  host.querySelectorAll('[data-open]').forEach(el=> el.onclick = ()=>{ const r=recipeById(el.dataset.open); if(r) openModal(r); });

  const remaining = filtered.length - toShow.length;
  const moreWrap = document.getElementById('historyLoadMore');
  moreWrap.innerHTML = remaining > 0
    ? `<button class="load-more-btn" id="histLoadMoreBtn">Show ${Math.min(50, remaining)} more (${remaining} left)</button>` : '';
  if(remaining > 0) document.getElementById('histLoadMoreBtn').onclick = ()=>{ historyRenderLimit += 50; renderHistory(); };

  const cuis = new Set(all.map(e=>{ const r=recipeById(e.recipeId); return r?r.cuisine:null; }).filter(Boolean));
  const never = RECIPES.filter(r=> timesMade(r.id)===0).length;
  document.getElementById('histStats').innerHTML = `<div class="hist-stats">
    <div class="hstat"><b>${all.length}</b>logged all time</div>
    <div class="hstat"><b>${cuis.size}</b>cuisines cooked</div>
    <div class="hstat"><b>${never}</b>never made yet</div>
  </div>`;
}
let historySearchTimer;
document.getElementById('historySearch').addEventListener('input', ()=>{
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(()=>{ historyRenderLimit = 50; renderHistory(); }, 80);
});

document.addEventListener('keydown', e=>{ if(e.key==='Escape') closePicker(); });
prefs();
setView('cookbook');

/* ============================================================
   PHASE 3 — theme, deep links, making mode, screen wake, mobile
   ============================================================ */

/* ---------------- theme (always dark by default) ---------------- */
/* comment above has said "dark by default" for a while, but this actually
   returned 'light' whenever nothing was saved yet -- so every fresh device/
   browser opened in light mode regardless of OS dark-mode setting until you
   manually toggled it once. Fixed to match the stated intent. */
/* Always boots dark now, full stop -- this used to fall back to localStorage
   first, which meant a device that had 'light' saved from testing before
   dark became the intended default would keep loading light forever
   regardless of that default. activeTheme is the in-memory source of truth
   for the toggle within this visit; nothing is persisted across reloads
   anymore, so every fresh load is guaranteed dark, and the toggle still
   works normally for as long as this tab stays open. */
let activeTheme = 'dark';
function currentTheme(){ return activeTheme; }
function applyTheme(mode){
  activeTheme = mode;
  document.documentElement.setAttribute('data-theme', mode);
  const b = document.getElementById('themeBtn');
  if(b) b.textContent = mode==='dark' ? '◐ Light' : '◑ Dark';
}
applyTheme('dark');
document.getElementById('themeBtn').onclick = ()=> applyTheme(currentTheme()==='dark' ? 'light' : 'dark');

/* ---------------- making mode (transient, device-local) ---------------- */
let making = false;
function makeKey(id){ return 'cookbook.making.'+id; }
function loadTicks(id){
  try{ return JSON.parse(localStorage.getItem(makeKey(id))) || {ing:[], step:[]}; }
  catch(e){ return {ing:[], step:[]}; }
}
function saveTicks(id, t){ try{ localStorage.setItem(makeKey(id), JSON.stringify(t)); }catch(e){} }
function clearTicks(id){ try{ localStorage.removeItem(makeKey(id)); }catch(e){} }
let ticks = {ing:[], step:[]};

function paintTicks(){
  const ing = document.getElementById('modalIngredients');
  const steps = document.getElementById('modalSteps');
  [...ing.querySelectorAll('li')].forEach((li,i)=>{
    if(li.classList.contains('heading')) return;
    li.classList.toggle('tick', ticks.ing.indexOf(i) !== -1);
  });
  [...steps.querySelectorAll('li')].forEach((li,i)=> li.classList.toggle('tick', ticks.step.indexOf(i) !== -1));
  const ingTotal = [...ing.querySelectorAll('li:not(.heading)')].length;
  const stepTotal = steps.querySelectorAll('li').length;
  /* querySelectorAll, not getElementById -- #modalActionsTop (desktop) and
     #modalActionsMobile both render a #makeProg span (see
     renderModalActionsTop), so both copies need updating, not just
     whichever one getElementById happens to find first. */
  document.querySelectorAll('.make-prog').forEach(prog=>{
    prog.textContent = making
      ? `${ticks.ing.length} of ${ingTotal} ingredients · ${ticks.step.length} of ${stepTotal} steps`
      : '';
  });
}
function toggleTick(kind, i){
  const arr = ticks[kind], at = arr.indexOf(i);
  if(at === -1) arr.push(i); else arr.splice(at,1);
  saveTicks(modalRecipe.id, ticks);
  paintTicks();
}
function wireTicks(){
  const ing = document.getElementById('modalIngredients');
  const steps = document.getElementById('modalSteps');
  [...ing.querySelectorAll('li')].forEach((li,i)=>{
    if(li.classList.contains('heading')) return;
    li.onclick = ()=>{ if(making) toggleTick('ing', i); };
  });
  [...steps.querySelectorAll('li')].forEach((li,i)=> li.onclick = ()=>{ if(making) toggleTick('step', i); });
}
function setMaking(on){
  making = on;
  document.getElementById('modalCard').classList.toggle('making', on);
  renderModalActionsTop();
  paintTicks();
  if(on) requestWake(); else releaseWake();
}
/* The three top-of-card actions (Start Making, Share, Mark as Cooked) render
   as one uniform row -- all the same button style/size, per Tyler's call
   after seeing the layout options. Share stays one button, not three: it
   opens a small menu with the native share sheet / print / copy-link options
   that used to be their own separate buttons in the main column. Mark as
   Cooked just toggles the #cookForm that renderCookPanel() renders down in
   the left column's cook-log section -- the button and the form it opens
   don't need to be next to each other in the DOM. */
function renderModalActionsTop(){
  /* Rendered into BOTH #modalActionsTop (desktop sidebar, unchanged) and
     #modalActionsMobile (mobile, right under the title -- see openModal) --
     every internal lookup below is host.querySelector-scoped (not
     document.getElementById), so the same ids inside each copy don't
     collide with each other. */
  ['modalActionsTop', 'modalActionsMobile'].forEach(hostId=>{
  const host = document.getElementById(hostId);
  /* two rows: the mode-toggle actions (Start Making / Mark Cooked) on top,
     then Share/Print below. Share via... already puts the recipe's link
     into whatever app the OS share sheet picks, so a separate Copy Link
     button next to it was redundant -- except on a
     browser with no share-sheet support at all (Firefox desktop, notably),
     where this is now the only way to hand off a link short of Print; if
     that turns out to matter, Copy Link is one line to bring back. */
  const mobile = hostId === 'modalActionsMobile';
  /* Mobile gets a compact 2-row layout, same shape as desktop, but with
     real SVG icons (not emoji -- 🖶/⤴ render as an unrecognizable box on
     some platforms/fonts) each paired with a short visible text label.
     Icon-only buttons had no way to be understood on a touch device (no
     hover to reveal a `title` tooltip) -- a checkmark alone doesn't say
     "mark cooked" to anyone, and the print glyph specifically was
     unreadable, which is what made it look like an unlabeled empty box. */
  const ckIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>`;
  const shareIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><polyline points="7 8 12 3 17 8"/><path d="M5 21h14a2 2 0 0 0 2-2v-5"/><path d="M5 21a2 2 0 0 1-2-2v-5"/></svg>`;
  const printIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
  const listIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/><polyline points="4 6 5 7 7 5"/><polyline points="4 12 5 13 7 11"/></svg>`;
  const planIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`;
  /* Save to list / Add to plan: get their own row rather than crowding into
     action-row-top -- they're lower-frequency than Start Making/Cooked/
     Share/Print, and both open a small popover (see openAddToListMenu/
     openAddToPlanMenu) rather than acting immediately like their row-mates. */
  host.innerHTML = mobile
    ? `<div class="action-row-top">
        <button class="icon-btn make-btn ${making?'on':''}" id="makeToggle">${making?'⏸':'▶'} ${making?'Making mode on':'Start making'}</button>
        <button class="icon-btn" id="markCookedTop">${ckIcon} Cooked</button>
        <button class="icon-btn" id="shareNative">${shareIcon} Share</button>
        <button class="icon-btn" id="printRecipe">${printIcon} Print</button>
      </div>
      ${making ? `<div class="make-sub"><span class="make-prog" id="makeProg"></span><button class="icon-btn" id="makeReset">reset ticks</button></div>` : ''}
      <div class="action-row-secondary">
        <button class="icon-btn" id="addToListBtn">${listIcon} Save to list</button>
        <button class="icon-btn" id="addToPlanBtn">${planIcon} Add to plan</button>
      </div>`
    : `<div class="action-row-top">
        <button class="icon-btn ${making?'on':''}" id="makeToggle">${making?'Making mode on':'Start making'}</button>
        <button class="icon-btn" id="markCookedTop">Mark cooked</button>
      </div>
      ${making ? `<div class="make-sub"><span class="make-prog" id="makeProg"></span><button class="icon-btn" id="makeReset">reset ticks</button></div>` : ''}
      <div class="action-row-top">
        <button class="icon-btn" id="shareNative">Share via&hellip;</button>
        <button class="icon-btn" id="printRecipe">Print</button>
      </div>
      <div class="action-row-secondary">
        <button class="icon-btn" id="addToListBtn">Save to list&hellip;</button>
        <button class="icon-btn" id="addToPlanBtn">Add to plan&hellip;</button>
      </div>`;

  host.querySelector('#makeToggle').onclick = ()=> setMaking(!making);
  const rst = host.querySelector('#makeReset');
  if(rst) rst.onclick = ()=>{ ticks={ing:[],step:[]}; clearTicks(modalRecipe.id); paintTicks(); };

  host.querySelector('#markCookedTop').onclick = ()=>{
    const f = document.getElementById('cookForm');
    if(!f) return;
    f.classList.toggle('open');
    /* the cook panel now lives at the very bottom of the recipe (see
       openModal) -- toggling it open with no scroll left it invisible off
       the bottom of a long recipe, reading as "the button doesn't do
       anything" even though it correctly opened the form down there. */
    if(f.classList.contains('open')) f.scrollIntoView({behavior:'smooth', block:'center'});
  };

  const sn = host.querySelector('#shareNative');
  if(sn) sn.onclick = ()=>{
    /* Just the link now, not a full text dump of the recipe -- someone
       outside the household getting a wall of copy-pasted ingredients/
       steps in a text message is worse than just handing them the actual
       page, which already renders the whole recipe properly (and, as of
       the share-view fix, without any way to browse the rest of the family
       cookbook from there). */
    const shareUrl = `${location.origin}${location.pathname}${hashFor(modalRecipe.id)}`;
    if(navigator.share){
      navigator.share({title: modalRecipe.title, url: shareUrl}).catch(()=>{});
      return;
    }
    /* Share was only ever rendered when navigator.share existed, which
       made it silently disappear in any context (browser, PWA install
       state, etc.) where the Web Share API isn't available -- always show
       the button, and copy-to-clipboard here instead when there's no
       native share sheet to hand off to. */
    const original = sn.innerHTML;
    const showFeedback = (text)=>{ sn.innerHTML = text; setTimeout(()=>{ sn.innerHTML = original; }, 1500); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(shareUrl)
        .then(()=> showFeedback('Copied!'))
        .catch(()=> showFeedback('Could not copy'));
    } else {
      showFeedback('Not supported here');
    }
  };
  /* Actual class-toggling + scale-to-fit now lives on the `beforeprint` event
     (see below) rather than here -- that fires for EVERY print path (this
     button, Cmd+P, iOS share-sheet Print), not just this click, so a recipe
     printed any other way still gets the same one-page treatment. */
  host.querySelector('#printRecipe').onclick = ()=> window.print();
  host.querySelector('#addToListBtn').onclick = e=> openAddToListMenu(e.currentTarget);
  host.querySelector('#addToPlanBtn').onclick = e=> openAddToPlanMenu(e.currentTarget);
  });
}

/* ---------------- quick popovers: save-to-list / add-to-plan ---------------- */
/* Small anchored menu shared by both actions rather than a full modal --
   these are one-tap choices (which list, which day/meal), not multi-field
   forms, so a heavier dialog would be more chrome than the task needs. */
function closeQuickMenu(){
  const el = document.getElementById('quickMenu');
  if(el) el.remove();
  document.removeEventListener('mousedown', quickMenuOutsideClick, true);
  document.removeEventListener('keydown', quickMenuEscape, true);
}
function quickMenuOutsideClick(e){
  const el = document.getElementById('quickMenu');
  if(el && !el.contains(e.target)) closeQuickMenu();
}
function quickMenuEscape(e){ if(e.key === 'Escape') closeQuickMenu(); }
function openQuickMenu(anchor, html){
  closeQuickMenu();
  const el = document.createElement('div');
  el.id = 'quickMenu';
  el.className = 'quick-menu';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + window.scrollY + 6;
  let left = r.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 8;
  if(left > maxLeft) left = Math.max(8, maxLeft);
  el.style.top = top + 'px';
  el.style.left = left + 'px';
  setTimeout(()=>{
    document.addEventListener('mousedown', quickMenuOutsideClick, true);
    document.addEventListener('keydown', quickMenuEscape, true);
  }, 0);
  return el;
}
function flashButton(btn, text){
  const original = btn.innerHTML;
  btn.innerHTML = text;
  setTimeout(()=>{ btn.innerHTML = original; }, 1500);
}
/* Same "skip headings, skip bare unit fragments" filter buildShoppingList
   already applies to recipe-driven ingredients -- so a manually-saved
   recipe's ingredients land on the list looking the same as ones pulled in
   through meal planning, not as a separate lower-quality path. */
function addRecipeIngredientsToList(r, listId){
  (r.ingredients||[]).forEach(line=>{
    if(line.trim().endsWith(':')) return;
    const noun = ingredientNoun(line);
    if(!noun || noun.length < 3) return;
    addInvItem('shopping', line, '', '', listId);
  });
}
function openAddToListMenu(anchor){
  const lists = getShoppingLists();
  const html = `
    <div class="qm-title">Save ingredients to&hellip;</div>
    ${lists.map(l=>`<button class="qm-item" data-list="${escapeHTML(l.id)}">${escapeHTML(l.name)}</button>`).join('')}
    <div class="qm-new">
      <input id="qmNewListName" type="text" placeholder="New list name">
      <button class="icon-btn qm-new-btn" id="qmNewListGo">Create</button>
    </div>`;
  const el = openQuickMenu(anchor, html);
  el.querySelectorAll('[data-list]').forEach(b=> b.onclick = ()=>{
    addRecipeIngredientsToList(modalRecipe, b.dataset.list);
    closeQuickMenu();
    flashButton(anchor, 'Saved!');
  });
  const go = ()=>{
    const name = document.getElementById('qmNewListName').value.trim();
    if(!name) return;
    const l = addShoppingList(name);
    addRecipeIngredientsToList(modalRecipe, l.id);
    closeQuickMenu();
    flashButton(anchor, 'Saved!');
  };
  el.querySelector('#qmNewListGo').onclick = go;
  el.querySelector('#qmNewListName').addEventListener('keydown', e=>{ if(e.key==='Enter') go(); });
}
function openAddToPlanMenu(anchor, recipe){
  const target = recipe || modalRecipe;
  const days = [];
  for(let i=0;i<14;i++) days.push(addDays(todayISO(), i));
  const html = `
    <div class="qm-title">Add to plan&hellip;</div>
    <div class="qm-days">
      ${days.map(iso=>`
        <div class="qm-day">
          <span class="qm-day-label">${DAY_NAMES[(dateOf(iso).getDay()+6)%7].slice(0,3)} ${fmtDayLabel(iso)}</span>
          <button class="icon-btn qm-item" data-iso="${iso}" data-meal="lunch">Lunch</button>
          <button class="icon-btn qm-item" data-iso="${iso}" data-meal="dinner">Dinner</button>
        </div>`).join('')}
    </div>`;
  const el = openQuickMenu(anchor, html);
  el.querySelectorAll('[data-iso]').forEach(b=> b.onclick = async ()=>{
    addSlot(b.dataset.iso, b.dataset.meal, {recipeId: target.id});
    closeQuickMenu();
    flashButton(anchor, 'Added!');
    /* a lite archive row (see NYT_LITE_COLUMNS) has no ingredients locally
       yet -- fetch now so the plan's shopping list is right by the time
       anyone looks at it, same reasoning as pickRecipe() below. */
    if(target && target._lite) await fetchRecipeDetail(target);
    if(typeof renderWeek === 'function') renderWeek();
  });
}

/* ---------------- screen wake lock ---------------- */
let wakeLock = null, wakeOn = false;
function wakeSupported(){ return 'wakeLock' in navigator; }
async function requestWake(){
  if(!wakeSupported()) return;
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeOn = true;
    wakeLock.addEventListener('release', ()=>{ wakeOn = false; });
  }catch(e){ wakeOn = false; }
}
function releaseWake(){
  try{ if(wakeLock) wakeLock.release(); }catch(e){}
  wakeLock = null; wakeOn = false;
}
/* browsers drop the lock when the tab is backgrounded -- take it again on return */
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible' && making && !wakeOn) requestWake();
});

/* ---------------- deep links (#r/<id>) ---------------- */
let suppressHash = false;
function hashFor(id){ return '#r/' + id; }
function openFromHash(){
  const m = (location.hash||'').match(/^#r\/(.+)$/);
  if(!m){ if(modalRecipe) closeModal(); return; }
  const r = recipeById(decodeURIComponent(m[1]));
  if(r && (!modalRecipe || modalRecipe.id !== r.id)) openModal(r);
}
window.addEventListener('hashchange', ()=>{ if(!suppressHash) openFromHash(); });

/* ---------------- modal action row ---------------- */

setTimeout(openFromHash, 0);

/* ============================================================
   PHASE 4 — Supabase backend: auth-gated planner, live sync,
   offline queue. The curated cookbook stays public and static (the
   RECIPES array below); the bulk NYT Cooking import instead lives in
   a public-read-only `nyt_recipes` table (see nytBoot() further down)
   fetched once and merged into RECIPES at runtime. Everything a
   household member writes (cook log, plan, inventory, prefs)
   lives in Postgres behind row-level security keyed to three
   allow-listed emails.
   ============================================================ */

/* Fill these in from Supabase -> Settings -> API. The anon key is
   meant to be public; real access control is the RLS policy on
   each table (see supabase_setup.sql), not secrecy of this key. */
const SUPABASE_URL = 'https://kubvqmptumftqtfqrifs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1YnZxbXB0dW1mdHF0ZnFyaWZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDc0NzcsImV4cCI6MjEwMzA4MzQ3N30.uWvku48avh5aUIp6V7lwGoNz-nk6RT1SiHaKODyWI2Q';

const sb = (SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let realtimeChannel = null;

/* ---------------- client-side error logging ---------------- */
/* Every regression this session (the "me" ReferenceError that broke every
   recipe-open, the quick-menu z-index bug) was only caught because someone
   happened to notice and paste a console screenshot. Logs to
   migrations/008's client_errors table instead of waiting on that -- fire
   and forget, deduped per tab so a loop-y error can't spam the table or
   itself trip more errors. */
const LOGGED_ERRORS = new Set();
function logClientError(message, stack, url){
  try{
    if(!sb) return;
    const trimmedMsg = String(message||'').slice(0, 500);
    const trimmedStack = String(stack||'').slice(0, 2000);
    const dedupeKey = trimmedMsg + '|' + trimmedStack.slice(0, 200);
    if(LOGGED_ERRORS.has(dedupeKey)) return;
    LOGGED_ERRORS.add(dedupeKey);
    sb.from('client_errors').insert({
      household_id: currentHousehold(),
      message: trimmedMsg, stack: trimmedStack, url: String(url||location.href)
    }).then(()=>{}, ()=>{});
  }catch(e){ /* logging must never itself throw */ }
}
window.addEventListener('error', e=>{
  logClientError(e.message, e.error && e.error.stack, location.href);
});
window.addEventListener('unhandledrejection', e=>{
  const reason = e.reason;
  logClientError(reason && reason.message ? reason.message : String(reason), reason && reason.stack, location.href);
});

/* ---------------- row <-> local shape mapping ---------------- */
/* NOTE: prefs.household is the existing integer "household size" field (used for
   leftover heuristics); the multi-tenant household GROUP id lives in a separate
   household_id text column on every synced table, to avoid colliding with it. */
function rowToCook(r){ return {id:r.id, recipeId:r.recipe_id, date:r.date, rating:r.rating, note:r.note||'', leftover:r.leftover||'', household:r.household_id||'deemer-berdux', _d:!!r.deleted, _t:Date.parse(r.updated_at)}; }
function rowToPlan(r){
  return {
    id: r.slot_id, iso: r.iso_date, mealType: r.meal_type||'dinner',
    recipeId: r.recipe_id||undefined,
    manualName: r.manual_name||undefined, manualIngredients: r.manual_ingredients||undefined,
    leftoverOf: r.leftover_of||undefined, ritual: !!r.ritual, servings: r.servings||undefined,
    _d: !!r.deleted, _t: Date.parse(r.updated_at)
  };
}
function rowToInv(r){ return {id:r.id, kind:r.kind, name:r.name, qty:r.qty, unit:r.unit, listId:r.list_id||null, useBy:r.use_by||null, _d:!!r.deleted, _t:Date.parse(r.updated_at)}; }
function rowToInterested(r){ return {id:r.recipe_id, _d:!!r.deleted, _t:Date.parse(r.updated_at)}; }
function rowToShoppingList(r){ return {id:r.id, name:r.name, _d:!!r.deleted, _t:Date.parse(r.updated_at)}; }

async function remoteFetchAll(){
  if(!sb) return null;
  const hh = currentHousehold();
  const otherHh = Object.keys(HOUSEHOLD_LABEL).find(h=>h!==hh);
  const [cl, pd, iv, pf, it, sl, ocl] = await Promise.all([
    sb.from('cook_log').select('*').eq('household_id', hh),
    sb.from('plan_days').select('*').eq('household_id', hh),
    sb.from('inventory_items').select('*').eq('household_id', hh),
    sb.from('prefs').select('*').eq('household_id', hh).maybeSingle(),
    sb.from('interested_recipes').select('*').eq('household_id', hh),
    sb.from('shopping_lists').select('*').eq('household_id', hh),
    /* Ratings/last-made ARE shared across households (unlike interested,
       plan, shopping, inventory) -- but only as a read-only, low-detail
       view (recipe id / rating / date, no notes or leftover text) kept in
       its own array (DATA.otherCookLog), never merged into DATA.cookLog.
       Merging it would silently pull the other household's cooking
       activity into lastMade()/candidatesFor()'s staleness math, which is
       exactly what "shouldn't affect each other's planning" rules out. */
    otherHh ? sb.from('cook_log').select('recipe_id,rating,date').eq('household_id', otherHh) : Promise.resolve({data:[]})
  ]);
  if(cl.error || pd.error || iv.error || pf.error){
    console.error('Supabase fetch error', cl.error||pd.error||iv.error||pf.error);
    return null;
  }
  /* interested_recipes and shopping_lists are both newer than the other
     tables -- if a migration hasn't been run yet, that table simply doesn't
     exist. That's a real, expected transitional state, not a reason to fail
     cook_log/plan_days/inventory/prefs too -- degrade to empty instead of
     returning null for the whole fetch. */
  if(it.error) console.error('interested_recipes fetch error (has the migration been run?)', it.error);
  if(sl.error) console.error('shopping_lists fetch error (has the migration been run?)', sl.error);
  if(ocl.error) console.error('other-household cook_log fetch error', ocl.error);
  const p = pf.data || {household: currentHousehold(), rituals: [], updated_at: new Date(0).toISOString()};
  return {
    version: 1,
    cookLog: cl.data.map(rowToCook),
    plan: pd.data.map(rowToPlan),
    inventory: {items: iv.data.map(rowToInv)},
    interested: it.error ? [] : it.data.map(rowToInterested),
    shoppingLists: sl.error ? [] : sl.data.map(rowToShoppingList),
    otherCookLog: ocl.error ? [] : (ocl.data||[]).map(r=>({recipeId:r.recipe_id, rating:r.rating, date:r.date})),
    prefs: Object.assign({household: p.household, rituals: p.rituals||[]}, {_t: Date.parse(p.updated_at)})
  };
}

/* ---------------- NYT Cooking bulk import (read-only, public) ---------------- */
/* Lives in its own Supabase table (nyt_recipes), NOT the static RECIPES array --
   19,163 rows is too much to keep hand-editing/committing to index.html. Fetched
   once per device and cached (rather than re-fetched every page load) to stay
   well under Supabase's free-tier egress cap -- recipes here change rarely, so a
   stale cache is a non-issue; bump NYT_CACHE_VERSION to force every device to
   refetch after a real data change (e.g. once category/cuisine get filled in).
   needs_review rows (broken/placeholder instructions from the import) are
   excluded at the query level -- that cleanup is a separate future workstream,
   not shown in the cookbook yet.

   Cache lives in IndexedDB, NOT localStorage -- the full NYT payload (ingredients/
   instructions/notes for ~17,700 recipes) is tens of MB as JSON, well past
   localStorage's typical 5-10MB per-origin quota. A `localStorage.setItem` over
   quota throws, and the original implementation swallowed that silently in a
   bare try/catch, so the cache never actually persisted -- every single page
   load paid the full ~20-request paginated fetch, with no visible error at all.
   IndexedDB's quota is far higher (typically hundreds of MB+), so this actually
   persists across visits. */
const NYT_CACHE_KEY = 'cookbook.nytRecipes';
const NYT_CACHE_VERSION = 18; /* bumped: v17 cache still had full ingredients/instructions/notes text baked into every cached row; v18 switches the bulk fetch to a lightweight column set (see nytBoot/NYT_LITE_COLUMNS) so a cold load isn't ~94MB of JSON */
/* Columns needed to browse/filter/render a card, WITHOUT the ~70%-of-payload
   ingredients/instructions/notes text -- that gets fetched per-recipe, on
   demand, only when its modal is actually opened (see fetchRecipeDetail). */
const NYT_LITE_COLUMNS = 'id,title,category,cuisine,source,servings,needs_review,total_time,cook_time,prep_time,tags,ingredient_core,ingredient_all,ingredient_dietary,ahead_label,ahead_minutes,kcal,protein,carbs,fat';
const NYT_DB_NAME = 'cookbookCache', NYT_DB_STORE = 'nytRecipes';

function openNytDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NYT_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(NYT_DB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function loadNytCache(key){
  try{
    const db = await openNytDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NYT_DB_STORE, 'readonly');
      const req = tx.objectStore(NYT_DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }catch(e){ return null; } /* corrupt/missing/unsupported -- fall through to a fresh fetch */
}
async function saveNytCache(key, payload){
  try{
    const db = await openNytDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(NYT_DB_STORE, 'readwrite');
      tx.objectStore(NYT_DB_STORE).put(payload, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }catch(e){ console.error('nyt cache save failed', e); } /* cache is a nice-to-have, not fatal if it fails */
}

function rowToNytRecipe(r){
  return {
    id: r.id,
    title: r.title,
    category: r.category || null,
    cuisine: r.cuisine || null,
    source: r.source,
    servings: r.servings || '',
    ingredients: r.ingredients || [],
    instructions: r.instructions || [],
    notes: r.notes || '',
    /* the bulk archive fetch (see nytBoot) deliberately omits ingredients/
       instructions/notes -- they're ~70% of a row's payload and unneeded
       until this specific recipe is actually opened. _lite marks a row as
       still missing that text so openModal() knows to fetch it on demand;
       rows built from a detail fetch (fetchRecipeDetail) or from the old
       full-row cache format never set it. */
    _lite: !('ingredients' in r),
    needsReview: !!r.needs_review,
    totalTime: r.total_time || null,
    cookTime: r.cook_time || null,
    prepTime: r.prep_time || null,
    /* nyt_recipes now also holds ~27k non-NYT recipes from other sites (food.com,
       epicurious.com, etc.) -- only stamp the NYT Cooking tag when the row's own
       source actually says so, instead of blindly tagging every row in the table */
    tags: r.source === 'NYT Cooking' ? [...new Set([...(r.tags || []), 'NYT Cooking'])] : (r.tags || []),
    ingredientCore: r.ingredient_core || [],
    ingredientAll: r.ingredient_all || [],
    ingredientDietary: r.ingredient_dietary || [],
    /* Precomputed server-side (see set_nyt_recipes_ahead_flags.sql) instead of
       running detectAhead() over instructions text that a lite row doesn't
       have locally -- without this, "Needs Extra Prep" would silently read
       as false for every archive recipe until it's individually opened. */
    _aheadPrecomputed: r.ahead_label ? {label: r.ahead_label, minutes: r.ahead_minutes} : null,
    addedDate: '2026-09-02',
    _fromArchive: true, /* distinguishes archive rows from the curated ~955 -- see archiveSourceOf() */
  };
}

/* Computing _ahead/_servings/_total/_plan for ~45k rows in one synchronous
   pass blocks the main thread for a few solid seconds -- long enough that
   clicks made during that window just queue up and appear to do nothing.
   Chunk it and yield back to the browser between batches so the page stays
   responsive (and cached repeat-visit loads, which skip this entirely, are
   unaffected). Returns a promise so callers that need the merge finished
   before rendering can still await it. */
async function mergeNytRecipes(rows){
  const existingIds = new Set(RECIPES.map(r=>r.id));
  const CHUNK = 2000;
  for(let i=0; i<rows.length; i+=CHUNK){
    rows.slice(i, i+CHUNK).forEach(r=>{
      if(existingIds.has(r.id)) return;
      /* the one-time _ahead/_servings/_total/_plan derived-index pass already ran
         over RECIPES at load, before these rows existed -- redo it per-row here or
         cards/scale-bar/plan-ahead logic would silently see undefined for all of them. */
      /* lite rows don't have instructions text locally to run detectAhead()
         against -- use the precomputed flag from the bulk fetch instead (see
         rowToNytRecipe); non-lite rows (already-detailed, or from an older
         full-row cache) still get it computed live as before. */
      r._ahead    = r._lite ? r._aheadPrecomputed : detectAhead(r);
      r._servings = parseServings(r.servings);
      r._total    = totalTime(r);
      r._plan     = planMinutes(r);
      RECIPES.push(r);
    });
    if(i+CHUNK < rows.length) await new Promise(res=>setTimeout(res,0));
  }
}

/* Fills in the ingredients/instructions/notes text that nytBoot's bulk fetch
   deliberately left out (see NYT_LITE_COLUMNS) -- called from openModal()
   the moment a lite archive row is actually opened. One tiny single-row
   request instead of that text riding along in the 46k-row bulk load that
   was stalling out on weaker connections. Mutates the row in place so it's
   only ever fetched once per visit, whichever card/link opens it next. */
async function fetchRecipeDetail(r){
  if(!r._lite || !sb) return r;
  const res = await sb.from('nyt_recipes').select('ingredients,instructions,notes').eq('id', r.id).single();
  if(!res.error && res.data){
    r.ingredients = res.data.ingredients || [];
    r.instructions = res.data.instructions || [];
    r.notes = res.data.notes || '';
    r._lite = false;
  }
  return r;
}

/* ---------------- family recipe submissions (CMS-lite) ----------------
   Lets a family member add a recipe from the site itself, no GitHub/JSON
   editing needed. Submissions land as a "draft" in the family_submissions
   table (see create_family_submissions_table.sql) and only join the real
   cookbook once someone in the household hits Publish on it -- at that
   point it's mapped into a normal recipe object here and merged into
   RECIPES the same way nyt_recipes rows already are. */
let pendingSubmissions = [];
function submissionToRecipe(row){
  return {
    id: 'sub-' + row.id,
    title: row.title,
    category: row.category || null,
    cuisine: row.cuisine || null,
    source: row.submitted_by ? `Family recipe (submitted by ${row.submitted_by})` : 'Family recipe (submitted)',
    servings: row.servings || '',
    ingredients: row.ingredients || [],
    instructions: row.instructions || [],
    notes: row.notes || '',
    needsReview: false,
    cookTime: null, prepTime: null, tags: [],
    ingredientCore: [], ingredientAll: [], ingredientDietary: [],
    addedDate: (row.published_at || row.created_at || '').slice(0,10) || todayISO(),
  };
}
async function familySubmissionsBoot(){
  if(!sb) return;
  const res = await sb.from('family_submissions').select('*').order('created_at', {ascending:false});
  if(res.error){ console.error('family_submissions fetch failed', res.error); return; }
  const rows = res.data || [];
  pendingSubmissions = rows.filter(r=>r.status==='draft');
  const published = rows.filter(r=>r.status==='published').map(submissionToRecipe);
  const existingIds = new Set(RECIPES.map(r=>r.id));
  let added = false;
  published.forEach(r=>{ if(!existingIds.has(r.id)){ RECIPES.push(r); added = true; } });
  if(added) render();
  renderSettings(); /* no-op if the panel's closed -- see its own dataset.open guard */
}
async function submitFamilyRecipe(data){
  if(!sb) return {error:{message:'Supabase not configured'}};
  const res = await sb.from('family_submissions').insert({
    title: data.title, category: data.category || null, cuisine: data.cuisine || null,
    servings: data.servings || null, ingredients: data.ingredients, instructions: data.instructions,
    notes: data.notes || '', submitted_by: data.submittedBy || '',
  });
  if(!res.error) await familySubmissionsBoot();
  return res;
}
async function publishSubmission(id){
  if(!sb) return;
  await sb.from('family_submissions').update({status:'published', published_at: new Date().toISOString()}).eq('id', id);
  await familySubmissionsBoot();
}
async function deleteSubmission(id){
  if(!sb) return;
  await sb.from('family_submissions').delete().eq('id', id);
  await familySubmissionsBoot();
}

/* Approximate row counts for the 4 archive source buttons, shown next to
   their label the same way Family/Curated already shows its (real, local)
   count -- fetched once at boot via count=estimated (a Postgres planner
   estimate, not an actual COUNT(*)) rather than count=exact, which was
   confirmed to 500/timeout on this table at its current size (see nytBoot).
   An estimate is perfectly fine for a UI badge; if a query fails, that
   button just shows no number rather than blocking anything else.
   (archiveSourceCounts itself is declared much earlier, next to
   enabledSources -- see the comment there for why.) */
function fmtCompactCount(n){
  if(n == null) return '';
  if(n < 1000) return String(n);
  return Math.round(n/1000) + 'k'; /* whole-k, no decimal -- every character counts to fit 5 buttons on one line */
}
async function loadArchiveSourceCounts(){
  if(!sb) return;
  const specs = [
    ['NYT Cooking', c=>c.eq('archive_source', 'nyt')],
    ['Epicurious', c=>c.eq('archive_source', 'epicurious')],
    ['BBC Good Food', c=>c.eq('archive_source', 'bbc')],
    ['Other recipe sites', c=>c.eq('archive_source', 'other')],
  ];
  await Promise.all(specs.map(async ([src, filter])=>{
    /* this endpoint has confirmed intermittent 500s/timeouts even on the
       cheap `estimated` count (not just the `exact` one nytBoot avoids),
       and BBC's specifically was seen failing outright at 3 attempts (a
       narrower id-prefix filter on this column apparently costs more to
       plan than the wider ones, not less) -- more attempts with a longer
       backoff clears it far more reliably than leaving a button
       permanently blank over what's ultimately a transient blip. */
    for(let attempt = 1; attempt <= 5; attempt++){
      try{
        let q = sb.from('nyt_recipes').select('id', {count:'estimated', head:true}).eq('needs_review', false);
        q = filter(q);
        const res = await q;
        if(!res.error && res.count != null){ archiveSourceCounts[src] = res.count; syncToolbar(); return; }
      }catch(e){ /* fall through to retry */ }
      if(attempt < 5) await new Promise(r=>setTimeout(r, 500 * attempt));
    }
    console.error('archive source count failed after retries', src);
  }));
  syncToolbar();
}
/* Once fetched, archive rows stay in RECIPES for the rest of the visit --
   toggling a source off/on after that first fetch is just a filter change
   (see archiveSourceOf() in matchesFiltersExcept), not an add/remove of
   thousands of DOM-adjacent rows every click. The Curated tier never needs
   a fetch at all (it's baked into the page); each of the other 4 fetches
   independently the first time IT specifically gets turned on (tracked per-
   source in archiveFetchedSources), not as one shared fetch for all 4 --
   see nytBoot's comment for why that used to make one button take 37s. */
async function toggleSource(src){
  if(src === CURATED_TIER){
    enabledSources = enabledSources.includes(src) ? enabledSources.filter(s=>s!==src) : [...enabledSources, src];
    renderToolbar(); render();
    return;
  }
  const turningOn = !enabledSources.includes(src);
  const needsFetch = turningOn && !archiveFetchedSources.has(src);
  /* Only a NEW fetch is blocked while another is already in flight --
     toggling a source that's already loaded on/off is just a filter
     change (no network involved) and should stay instant regardless of
     what else is loading, instead of every button waiting in line behind
     whichever one you clicked first. */
  if(needsFetch && archiveLoading) return;
  enabledSources = turningOn ? [...enabledSources, src] : enabledSources.filter(s=>s!==src);
  if(needsFetch){
    archiveLoading = true;
    currentlyLoadingSource = src;
    renderToolbar(); /* shows "Loading…" on this button right away, before the await below */
    /* Also flip "955/955" over to a Loading… indicator right away, without
       paying for a full renderGrid() rebuild just to change this one
       label -- render() (which does call renderGrid) doesn't run again
       until AFTER the fetch finishes, so nothing was visibly changing for
       however long the fetch actually took. */
    document.getElementById('resultCount').innerHTML = `<span class="loading-spin">&#8635;</span> Loading…`;
    try{
      await nytBoot(src); /* merges into RECIPES and calls render() itself once done */
      archiveFetchedSources.add(src);
    }catch(e){
      /* whatever the cause, archiveLoading must never come out of this
         still true -- that's what left every source button permanently
         disabled (can't turn NYT/BBC back off, can't try another one)
         after a failed load instead of just showing the failure and
         letting you retry. */
      console.error('nytBoot failed', e);
    }finally{
      archiveLoading = false;
      currentlyLoadingSource = null;
    }
  }
  renderToolbar(); render();
  if(turningOn) runArchiveSearch(state.query);
}
async function nytBoot(src){
  if(!sb) return;
  const cacheKey = NYT_CACHE_KEY + ':' + src;
  const cached = await loadNytCache(cacheKey);
  if(cached && cached.version === NYT_CACHE_VERSION && Array.isArray(cached.rows)){
    /* A version bump is a manual step (see NYT_CACHE_VERSION comment) and it's
       been forgotten more than once after an import -- cache trust used to
       also be double-checked against a live `count=exact` row count, but
       that query itself started returning 500s once this table passed ~60k
       rows (a Postgres statement timeout on the count, confirmed directly
       against the API) -- which was the actual cause of archive loads
       taking 20+ seconds and then locking up: a failed count silently
       dropped the whole fetch below into a slow one-page-at-a-time fallback.
       Trusting the cache version alone is less thorough (an in-place edit
       that doesn't change row count needs an explicit version bump, same
       limitation as before) but doesn't depend on a query that's now
       unreliable at this table size. */
    console.log(`nytBoot(${src}): cache hit, showing ${cached.rows.length} cached recipes, skipping the network fetch`);
    await mergeNytRecipes(cached.rows);
    render();
    return;
  }
  console.log(`nytBoot(${src}): no usable cache, fetching from Supabase`);

  /* PostgREST caps a single response at 1000 rows by default. Each of the 4
     archive sources now fetches only its own rows (filtered server-side --
     see ARCHIVE_SOURCE_FILTERS) instead of one shared ~60k-row pull for
     whichever button happened to be clicked first -- turning on just NYT
     (~19k rows) used to also silently download Epicurious/BBC/Other on top
     of it, which is what made a single button take 37 seconds. Pages within
     THIS source's own fetch still go out in concurrent batches, walking
     forward without needing to know the total row count up front (see the
     count=exact reliability note above) -- a batch containing a short or
     failed page marks the end. */
  /* Concurrency and retry count both walked back down from an earlier
     attempt at this (10 / 5 attempts) that assumed every timeout was a
     one-off blip -- during an actual sustained rough patch on this
     endpoint, that combination makes the WORST case dramatically longer
     (5 retries x a growing backoff, repeated per page) instead of failing
     fast, which is what turned into a 30+ second hang that never
     resolved. Fewer concurrent requests is also gentler on a
     resource-constrained backend that's already struggling. A hard
     overall deadline below is the real fix for "never ends", though --
     no amount of retry tuning guarantees an upper bound on its own. */
  const PAGE_SIZE = 1000, CONCURRENCY = 5, OVERALL_DEADLINE_MS = 15000;
  const startedAt = Date.now();
  let allData = [], hadError = false, timedOut = false;
  async function fetchPage(from){
    for(let attempt = 1; attempt <= 3; attempt++){
      let q = sb.from('nyt_recipes').select(NYT_LITE_COLUMNS).eq('needs_review', false);
      q = ARCHIVE_SOURCE_FILTERS[src](q);
      const res = await q.order('id').range(from, from + PAGE_SIZE - 1);
      if(!res.error) return res.data;
      console.error(`nyt_recipes fetch error (${src}, page starting at ${from}, attempt ${attempt})`, res.error);
      if(attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
    }
    hadError = true;
    return null;
  }
  let from = 0, done = false;
  while(!done){
    if(Date.now() - startedAt > OVERALL_DEADLINE_MS){
      /* whatever is already fetched gets kept and merged/rendered below --
         this is what guarantees "never ends" can't actually happen, no
         matter how degraded the backend is right now. */
      timedOut = true; hadError = true;
      console.error(`nytBoot(${src}): stopping after ${OVERALL_DEADLINE_MS}ms -- backend seems degraded, keeping ${allData.length} rows fetched so far`);
      break;
    }
    const starts = []; for(let i=0; i<CONCURRENCY; i++) starts.push(from + i*PAGE_SIZE);
    const batch = await Promise.all(starts.map(fetchPage));
    for(const data of batch){
      if(!data){ done = true; break; }
      allData = allData.concat(data);
      if(data.length < PAGE_SIZE){ done = true; break; }
    }
    from += CONCURRENCY * PAGE_SIZE;
  }
  const rows = allData.map(rowToNytRecipe);
  /* only cache on a fully clean fetch -- a partial result cached would silently
     cap every future load at whatever happened to succeed this one time */
  if(!hadError){
    await saveNytCache(cacheKey, {version: NYT_CACHE_VERSION, rows});
  }
  const before = RECIPES.length;
  await mergeNytRecipes(rows);
  if(RECIPES.length !== before) render(); /* only re-render if the fetch actually added anything new vs. the cache */
  if(hadError) console.error(`nytBoot(${src}): stopped early after fetching ${allData.length} recipes -- see errors above`);
  else console.log(`nytBoot(${src}): fetch complete, ${allData.length} rows fetched, RECIPES now has ${RECIPES.length} total`);
}

/* ---------------- offline write queue ---------------- */
const QUEUE_KEY = 'cookbook.pendingWrites';
function loadQueue(){ try{ return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }catch(e){ return []; } }
function saveQueue(q){ try{ localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }catch(e){} }
function enqueue(op){ const q = loadQueue(); q.push(op); saveQueue(q); }

/* op.hh is the household stamped by pushWrite() at the moment an edit was
   MADE, not whatever household happens to be active when this op finally
   sends. Queued/offline writes can sit for a while -- without this, a
   pending write made under one household would get flushed under whichever
   household is active by the time it succeeds, mislabeling it if someone
   switches households (Settings > Switch to...) before it flushes. Falls
   back to a live currentHousehold() only for ops queued before this fix
   existed (already in someone's localStorage) that never got an op.hh. */
async function runOp(op){
  const hh = op.hh || currentHousehold();
  if(op.table === 'cook_log'){
    return sb.from('cook_log').upsert({
      id: op.row.id, recipe_id: op.row.recipeId, date: op.row.date,
      rating: op.row.rating, note: op.row.note, leftover: op.row.leftover||'',
      household_id: op.row.household || hh, deleted: !!op.row._d,
      updated_at: new Date(op.row._t).toISOString()
    });
  }
  if(op.table === 'plan_days'){
    return sb.from('plan_days').upsert({
      slot_id: op.row.id, iso_date: op.row.iso, household_id: hh,
      meal_type: op.row.mealType||'dinner', recipe_id: op.row.recipeId||null,
      manual_name: op.row.manualName||null, manual_ingredients: op.row.manualIngredients||null,
      leftover_of: op.row.leftoverOf||null, ritual: !!op.row.ritual, servings: op.row.servings||null,
      deleted: !!op.row._d, updated_at: new Date(op.row._t).toISOString()
    });
  }
  if(op.table === 'inventory_items'){
    return sb.from('inventory_items').upsert({
      id: op.row.id, household_id: hh, kind: op.kind, name: op.row.name,
      qty: (op.row.qty===''||op.row.qty===undefined) ? null : op.row.qty, unit: op.row.unit||null,
      list_id: op.row.listId||null, use_by: op.row.useBy||null,
      deleted: !!op.row._d, updated_at: new Date(op.row._t).toISOString()
    });
  }
  if(op.table === 'shopping_lists'){
    return sb.from('shopping_lists').upsert({
      id: op.row.id, household_id: hh, name: op.row.name,
      deleted: !!op.row._d, updated_at: new Date(op.row._t).toISOString()
    });
  }
  if(op.table === 'prefs'){
    return sb.from('prefs').upsert({
      household_id: hh, household: op.row.household, rituals: op.row.rituals,
      updated_at: new Date(op.row._t).toISOString()
    });
  }
  if(op.table === 'interested_recipes'){
    return sb.from('interested_recipes').upsert({
      recipe_id: op.row.id, household_id: hh, deleted: !!op.row._d, updated_at: new Date(op.row._t).toISOString()
    });
  }
}

let flushing = false;
async function flushQueue(){
  if(!sb || flushing) return;
  flushing = true;
  let q = loadQueue();
  while(q.length){
    const op = q[0];
    try{
      const {error} = await runOp(op);
      if(error) throw error;
      q.shift(); saveQueue(q);
    }catch(e){ break; }  /* still offline or a real error -- stop and retry later */
  }
  flushing = false;
  setSyncState(q.length ? 'error' : 'ok');
}
window.addEventListener('online', flushQueue);

/* every local mutation goes through here instead of writing straight
   to Supabase, so the UI never blocks on network and offline edits
   are never lost -- they just wait in the queue. Stamping op.hh here,
   at the moment the edit is made, is what keeps a queued write correctly
   attributed even if the household is switched before it flushes -- see
   the comment on runOp(). */
function pushWrite(op){
  if(op.hh === undefined) op.hh = currentHousehold();
  enqueue(op);
  flushQueue();
}

/* ---------------- realtime ---------------- */
function subscribeRealtime(){
  if(!sb || realtimeChannel) return;
  realtimeChannel = sb.channel('household-sync')
    .on('postgres_changes', {event:'*', schema:'public', table:'cook_log'}, onRemoteChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'plan_days'}, onRemoteChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'inventory_items'}, onRemoteChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'prefs'}, onRemoteChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'interested_recipes'}, onRemoteChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'shopping_lists'}, onRemoteChange)
    .subscribe();
}
function unsubscribeRealtime(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}
let remoteDebounce = null;
function onRemoteChange(){
  /* a full refetch-and-merge is simpler and plenty fast at family-cookbook scale
     compared to patching in one changed row at a time */
  clearTimeout(remoteDebounce);
  remoteDebounce = setTimeout(async ()=>{
    const remote = await remoteFetchAll();
    if(!remote) return;
    DATA = mergeStates(remote, DATA);
    /* read-only cross-household view -- always just the latest fetch, never
       run through the offline merge machinery above (nothing local ever
       edits it, so there's nothing to reconcile). */
    DATA.otherCookLog = remote.otherCookLog || [];
    persist(true);
    render();
    if(view==='plan') renderWeek();
    if(view==='history') renderHistory();
    if(view==='storage') renderStorage();
  }, 400);
}

/* ---------------- sync status pill ---------------- */
let syncState = 'off';
function setSyncState(s){ syncState = s; paintAuth(); }
function syncLabel(){
  return {off:'', ok:'● synced', error:'▲ retrying…', syncing:'◍ syncing…'}[syncState] || '';
}

/* ---------------- sync status ---------------- */
/* Still no code, no real login -- but there are two households sharing this
   now (see resolveHouseholdThenBoot()), so this is just a quiet sync
   indicator, not the thing that decides which household's data you see. */
function paintAuth(){
  const host = document.getElementById('authArea');
  if(!sb){ host.innerHTML = `<span class="icon-btn" style="cursor:default">Supabase not configured</span>`; return; }
  host.innerHTML = `<span class="icon-btn sync-dot s-${syncState==='error'?'error':'ok'}" style="cursor:default">${syncLabel()}</span>`;
}

/* ---------------- boot ---------------- */
function applyAuthGate(){
  document.querySelectorAll('#viewTabs .vt[data-view="plan"], #viewTabs .vt[data-view="shopping"], #viewTabs .vt[data-view="history"], #viewTabs .vt[data-view="storage"]')
    .forEach(b=> b.style.display = '');
  document.querySelectorAll('#viewTabsMobile option[value="plan"], #viewTabsMobile option[value="shopping"], #viewTabsMobile option[value="history"], #viewTabsMobile option[value="storage"]')
    .forEach(o=> o.style.display = '');
}
async function authBoot(){
  paintAuth(); applyAuthGate();
  if(!sb) return;
  const remote = await remoteFetchAll();
  if(remote){
    DATA = mergeStates(remote, DATA);
    DATA.otherCookLog = remote.otherCookLog || [];
    persist(true); render();
  }
  subscribeRealtime();
  flushQueue();
}
/* Nothing that reads or writes household-scoped data (authBoot, the
   submission queue, realtime sync) may run until we're sure which
   household this device is -- resolveHouseholdThenBoot() is the only
   thing allowed to call these directly. */
function startApp(){
  authBoot();
  /* the archive never auto-loads -- see toggleSource(), which is the only
     thing that ever calls nytBoot() now; every fresh load starts curated-only */
  familySubmissionsBoot();
  loadArchiveSourceCounts();
}
function resolveHouseholdThenBoot(){
  if(currentHousehold()){ startApp(); return; }
  const gate = document.getElementById('householdGate');
  const btnsHost = document.getElementById('householdGateBtns');
  btnsHost.innerHTML = Object.keys(HOUSEHOLD_LABEL).map(hh=>
    `<button type="button" class="cook-btn" data-hh="${hh}" style="padding:14px; font-size:15px;">${escapeHTML(HOUSEHOLD_LABEL[hh])}</button>`
  ).join('');
  btnsHost.querySelectorAll('[data-hh]').forEach(b=>{
    b.onclick = ()=>{
      try{ localStorage.setItem(HOUSEHOLD_STORAGE_KEY, b.dataset.hh); }catch(e){}
      gate.classList.remove('open');
      startApp();
    };
  });
  gate.classList.add('open');
}
resolveHouseholdThenBoot();

/* Scale the whole recipe card down just enough to fit one printed page,
   rather than letting a long method spill onto a second page. The fixed
   compact sizing in the print CSS above (3-column ingredients, 2-column
   steps, 9.5px type) already gets most recipes to one page on its own --
   this only kicks in for the genuinely longest ones, and only shrinks
   further than that baseline, never below it and never enlarging a short
   recipe past its normal print size. transform:scale on the whole `.modal`
   box is what most "fit to one page" print tools do: it scales the
   rendered box (and, in Chrome/Firefox, the pagination engine's own idea
   of how tall that box is) without having to hand-tune font sizes per
   recipe length. */
function fitPrintToOnePage(){
  const el = document.getElementById('modalCard');
  if(!el) return;
  el.style.transform = '';
  el.style.width = '';
  el.style.maxWidth = '';
  el.style.transformOrigin = 'top left';
  const PX_PER_IN = 96, PAGE_MARGIN_IN = 0.4, PAGE_HEIGHT_IN = 11;
  const maxH = (PAGE_HEIGHT_IN - PAGE_MARGIN_IN * 2) * PX_PER_IN;
  const rect = el.getBoundingClientRect();
  if(rect.height > maxH){
    const scale = Math.max(0.3, maxH / rect.height);
    el.style.transform = `scale(${scale})`;
    /* compensate width so the now-narrower scaled box still fills the
       printable width instead of leaving the right half of the page blank
       -- the print CSS's own `.modal{max-width:100%}` would otherwise clamp
       this straight back down before the transform ever runs, so it has to
       be overridden here too, not just width. */
    el.style.width = (100 / scale) + '%';
    el.style.maxWidth = 'none';
  }
}
function resetPrintFit(){
  const el = document.getElementById('modalCard');
  if(el){ el.style.transform = ''; el.style.width = ''; el.style.maxWidth = ''; el.style.transformOrigin = ''; }
}
/* beforeprint/afterprint (not the button's own click handler) so every
   print path gets the same one-page treatment, not just this app's Print
   button -- see the big comment above the print CSS for why that matters. */
window.addEventListener('beforeprint', ()=>{
  document.body.classList.add('printing');
  fitPrintToOnePage();
});
/* remove the print-condensed layout once the print dialog closes --
   afterprint fires whether the user actually printed or cancelled, either
   way the page should go back to its normal on-screen appearance */
window.addEventListener('afterprint', ()=>{
  document.body.classList.remove('printing');
  resetPrintFit();
});

/* register the app-shell service worker so the page itself (not just the
   already-cached recipe data) loads with no network -- see sw.js. Registered
   last, after boot, so a slow/failed registration never delays first paint. */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=> console.error('sw registration failed', e));
  });
}

