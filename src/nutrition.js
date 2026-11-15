/* Pure recipe maths -- no DOM, no state: serving parsing, ingredient scaling, per-serving macro
   estimates. Lives in its own file so the SAME code runs in the browser (build.py puts it ahead of
   app.js) and in tools/infer_archive_meta.js, which fills in servings/macros for archive recipes
   that arrived without them. Keep it free of anything browser-specific. */
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
/* "Serves 4" -- or, when the count was worked out from the ingredients rather than read from the recipe, "Serves ~4 (estimated)" */
function servesText(r){ return r.servingsEst ? 'Serves ~' + r.servings + ' (estimated)' : servingsLabel(r.servings); }
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
/* estimated grams for one ingredient line: the recipe's own metric conversion if it has one,
   else a generic per-unit weight, else a bare-count guess */
function lineGrams(line){
  let grams = parenGrams(line);
  if(grams != null) return grams;
  const lead = line.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(\s*)([A-Za-z]*)/);
  if(lead && parseQty(lead[1])){
    const unit = lead[3].toLowerCase().replace(/\.$/,'');
    const perUnit = UNIT_GRAMS[unit];
    return parseQty(lead[1]) * (perUnit!==undefined ? perUnit : UNIT_GRAMS_NO_UNIT);
  }
  return UNIT_GRAMS_NO_UNIT;
}
/* total estimated weight of a recipe's countable ingredients (grams) -- what the serving-count
   estimate below is based on. Skips headings and "to taste"-style lines, same as the macro maths. */
function recipeMass(r){
  let total = 0;
  (r.ingredients||[]).forEach(line=>{
    if(!line || line.trim().endsWith(':')) return;
    if(isNoScale(line)) return;
    total += lineGrams(line);
  });
  return total;
}
function estimateMacros(r){
  const base = macroServingBase(r);
  if(!base) return null;
  let kcal=0, protein=0, carbs=0, fat=0, matchedGrams=0, totalGrams=0;
  (r.ingredients||[]).forEach(line=>{
    if(!line || line.trim().endsWith(':')) return;
    if(isNoScale(line)) return;
    const grams = lineGrams(line);
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
  return m ? `≈${m.kcal} cal per serving · ${m.protein}g protein · ${m.carbs}g carbs · ${m.fat}g fat (${r.servingsEst ? 'estimated, from a guessed serving count' : 'estimated'})` : '—';
}

