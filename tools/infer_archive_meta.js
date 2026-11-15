// JavaScriptCore worker (osascript -l JavaScript) used by tools/infer_archive_meta.py.
// Runs the app's OWN servings/macro maths (src/nutrition.js) over archive rows, so the numbers
// are produced by exactly the code the site runs -- no second implementation to drift.
//   osascript -l JavaScript tools/infer_archive_meta.js <mode> <in.json> <out.json> [divisors.json]
//   mode "mass":  rows [{id, ingredients, servings}]            -> [{id, mass, base}]
//   mode "infer": rows [{id, category, ingredients, servings, needServings}] + fit {category: [a, b], _default: [a, b]}
//                   (servings = round(exp(a + b*ln(grams))), clamped to 1..24)
//                                                               -> [{id, servings, est, kcal, protein, carbs, fat}]
ObjC.import('Foundation');
function readFile(p){ return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
function writeFile(p, s){ $.NSString.stringWithString(s).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null); }
function run(argv){
  const root = $.NSString.stringWithString(argv[argv.length > 4 ? 4 : 3] || '').stringByDeletingLastPathComponent;  // unused; keeps argv simple
  const here = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('NUTRITION_JS'));
  const N = (new Function(readFile(here) + '\nreturn {parseServings, estimateMacros, recipeMass, macroServingBase};'))();
  const mode = argv[0], rows = JSON.parse(readFile(argv[1]));
  const out = [];
  if(mode === 'mass'){
    rows.forEach(r=>{
      const sv = N.parseServings(r.servings);
      const base = (sv && sv.servingBased) ? N.macroServingBase({servings: r.servings, _servings: sv}) : null;
      out.push({id: r.id, mass: N.recipeMass(r), base: base});
    });
  } else {
    const div = JSON.parse(readFile(argv[3]));
    rows.forEach(r=>{
      let servings = r.servings, est = false;
      if(r.needServings){
        const mass = N.recipeMass(r), f = div[r.category] || div._default;
        if(mass >= 60 && f){ servings = String(Math.max(1, Math.min(24, Math.round(Math.exp(f[0] + f[1] * Math.log(mass)))))); est = true; } else servings = null;
      }
      let m = null;
      if(servings){
        const sv = N.parseServings(servings);
        if(sv) m = N.estimateMacros({ingredients: r.ingredients, servings: servings, _servings: sv});
      }
      out.push({id: r.id, servings: servings, est: est, kcal: m && m.kcal, protein: m && m.protein, carbs: m && m.carbs, fat: m && m.fat});
    });
  }
  writeFile(argv[2], JSON.stringify(out));
  return 'ok ' + out.length;
}
