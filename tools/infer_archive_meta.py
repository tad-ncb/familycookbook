#!/usr/bin/env python3
"""Fills in what archive recipes arrived without, so every source filters and scales alike.

  servings   estimated from the recipe's total ingredient weight, calibrated per course on the
             ~19k recipes that DO have a real serving count (flagged servings_est=1 so the app can
             say "~4, estimated")
  macros     kcal/protein/carbs/fat from the app's own estimator once servings exist
  cuisine    Epicurious has none: a naive-Bayes model trained on the ~46k labelled recipes in the
             other sources, applied only above a confidence that held out at >= MIN_PRECISION

Needs macOS (the servings/macro maths is src/nutrition.js, run through osascript -- the exact code
the site runs). Run via tools/build_archive_data.py; `python3 tools/infer_archive_meta.py` prints a
report on accuracy only.
"""
import collections, json, math, os, pathlib, random, re, statistics, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKER = ROOT / 'tools' / 'infer_archive_meta.js'
MIN_PRECISION = 0.85
WORD = re.compile(r"[a-z]{3,}")


def jxa(mode, rows, divisors=None):
    with tempfile.TemporaryDirectory() as d:
        i, o, v = pathlib.Path(d) / 'in.json', pathlib.Path(d) / 'out.json', pathlib.Path(d) / 'div.json'
        i.write_text(json.dumps(rows), encoding='utf-8')
        args = ['osascript', '-l', 'JavaScript', str(WORKER), mode, str(i), str(o)]
        if divisors is not None:
            v.write_text(json.dumps(divisors)); args.append(str(v))
        r = subprocess.run(args, capture_output=True, text=True, env={**os.environ, 'NUTRITION_JS': str(ROOT / 'src' / 'nutrition.js')})
        if r.returncode != 0:
            raise RuntimeError('osascript failed: ' + r.stderr[-500:])
        return json.loads(o.read_text(encoding='utf-8'))


def _ls(xs, ys):
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    return [my - slope * mx, slope]


def _fit(samples):
    """log(servings) = a + b*log(grams), per course (courses with >= 100 samples), plus a default"""
    by = collections.defaultdict(list)
    for c, m, s in samples:
        by[c].append((math.log(m), math.log(s)))
    fit = {c: _ls([x for x, _ in v], [y for _, y in v]) for c, v in by.items() if c and len(v) >= 100}
    fit['_default'] = _ls([math.log(m) for _, m, _ in samples], [math.log(s) for _, _, s in samples])
    return fit


def _predict(fit, cat, mass):
    a, b = fit.get(cat) or fit['_default']
    return max(1, min(24, round(math.exp(a + b * math.log(mass)))))


def calibrate(lite, detail, report):
    """servings-from-weight model, fitted on recipes with a real serving count; reports held-out accuracy"""
    rows = [{'id': r['id'], 'ingredients': detail[r['id']]['ingredients'], 'servings': r.get('servings') or ''} for r in lite]
    mass = {m['id']: m for m in jxa('mass', rows)}
    cat = {r['id']: r.get('category') for r in lite}
    samples = [(cat[i], m['mass'], m['base']) for i, m in mass.items() if m['base'] and 1 <= m['base'] <= 24 and m['mass'] >= 60]
    random.Random(7).shuffle(samples)
    half = len(samples) // 2
    fit = _fit(samples[:half])
    test = samples[half:]
    ratio = [_predict(fit, c, m) / s for c, m, s in test]
    within = sum(1 for x in ratio if 0.67 <= x <= 1.5) / len(ratio)
    report.append(f'servings estimate, held out on {len(test)} recipes with real counts: median ratio {statistics.median(ratio):.2f}, '
                  f'{within:.0%} within -33%/+50% of the true count (the rest are off by more -- estimates are flagged in the app)')
    return _fit(samples), mass


def cuisine_model(labelled, unlabelled, report):
    """naive Bayes over ingredient names + title words"""
    def feats(r):
        return set(r.get('ingredient_core') or []) | {'t:' + w for w in WORD.findall((r.get('title') or '').lower())}
    random.Random(11).shuffle(labelled)
    cut = int(len(labelled) * 0.9)

    def train(rows):
        prior, cnt, tot, vocab = collections.Counter(), collections.defaultdict(collections.Counter), collections.Counter(), set()
        for r in rows:
            c = r['cuisine']; prior[c] += 1
            for f in feats(r): cnt[c][f] += 1; tot[c] += 1; vocab.add(f)
        return prior, cnt, tot, len(vocab), len(rows)

    def predict(model, r):
        prior, cnt, tot, V, n = model
        fs = feats(r); best = {}
        for c in prior:
            lp = math.log(prior[c] / n)
            for f in fs: lp += math.log((cnt[c][f] + 0.5) / (tot[c] + 0.5 * V))
            best[c] = lp
        m = max(best.values()); z = sum(math.exp(v - m) for v in best.values())
        top = max(best, key=best.get)
        return top, 1 / z

    model = train(labelled[:cut])
    scored = [(predict(model, r), r['cuisine']) for r in labelled[cut:]]
    thr = 0.99
    for t in [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 0.999]:
        sel = [(p, c) for p, c in scored if p[1] >= t]
        if sel and sum(1 for p, c in sel if p[0] == c) / len(sel) >= MIN_PRECISION:
            thr = t; break
    sel = [(p, c) for p, c in scored if p[1] >= thr]
    report.append(f'cuisine model, held out on {len(scored)}: at confidence >= {thr}: precision {sum(1 for p, c in sel if p[0] == c) / max(1, len(sel)):.0%}, coverage {len(sel) / len(scored):.0%}')
    full = train(labelled)
    out = {}
    for r in unlabelled:
        (c, conf) = predict(full, r)
        if conf >= thr: out[r['id']] = c
    report.append(f'cuisine assigned to {len(out)} of {len(unlabelled)} recipes without one')
    return out


def apply(lite, detail, report=None):
    """lite: list of row dicts (mutated), detail: {id: {ingredients,...}}. Returns the report lines."""
    report = report if report is not None else []
    div, mass = calibrate(lite, detail, report)
    need = []
    for r in lite:
        has_sv = bool((r.get('servings') or '').strip())
        if (not has_sv) or r.get('kcal') is None:
            need.append({'id': r['id'], 'category': r.get('category'), 'ingredients': detail[r['id']]['ingredients'], 'servings': r.get('servings') or '', 'needServings': not has_sv})
    res = {x['id']: x for x in jxa('infer', need, div)}
    by_id = {r['id']: r for r in lite}
    n_sv = n_mac = 0
    for i, x in res.items():
        r = by_id[i]
        if x['est'] and x['servings']:
            r['servings'], r['servings_est'] = x['servings'], 1; n_sv += 1
        if r.get('kcal') is None and x.get('kcal') is not None:
            for k in ('kcal', 'protein', 'carbs', 'fat'): r[k] = x[k]
            n_mac += 1
    for r in lite: r.setdefault('servings_est', 0)
    report.append(f'filled in servings for {n_sv} recipes and macros for {n_mac}')
    lab = [r for r in lite if r.get('cuisine')]
    unl = [r for r in lite if not r.get('cuisine')]
    if unl:
        for i, c in cuisine_model(lab, unl, report).items():
            by_id[i]['cuisine'] = c
    return report


if __name__ == '__main__':
    lite, detail = [], {}
    for f in sorted((ROOT / 'data' / 'archive' / 'lite').glob('*.json')): lite += json.loads(f.read_text(encoding='utf-8'))
    for f in (ROOT / 'data' / 'archive' / 'detail').glob('*.json'): detail.update(json.loads(f.read_text(encoding='utf-8')))
    print('\n'.join(apply(lite, detail)))
