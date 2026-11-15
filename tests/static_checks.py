#!/usr/bin/env python3
"""Static checks -- fast, no browser, no network. Run by tests/run.sh and by CI
(.github/workflows/tests.yml) on every push.   python3 tests/static_checks.py

Needs: pip install esprima pyyaml
"""
import glob, json, pathlib, re, sys
import esprima, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
failures, passed = [], 0


def check(name):
    def deco(fn):
        global passed
        try:
            fn()
            passed += 1
            print(f'ok    {name}')
        except AssertionError as e:
            failures.append(name)
            print(f'FAIL  {name}\n        {e}')
        return fn
    return deco


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


APP = read('src/app.js')
HEAD = read('src/head.html')

# Browser-provided names app.js may use without declaring.
BROWSER_GLOBALS = set('''window document location history navigator localStorage indexedDB console fetch alert confirm prompt
  setTimeout clearTimeout setInterval clearInterval requestAnimationFrame performance getComputedStyle
  Promise Map Set Object Array JSON Math Date String Number Boolean RegExp Error Intl Symbol
  parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent undefined NaN Infinity
  Uint8Array Uint32Array CSS DOMException URL URLSearchParams Blob FileReader TextEncoder KeyboardEvent Event caches self arguments RECIPES'''.split())


@check('src/app.js, sw.js and the test scripts parse as JavaScript')
def _():
    for rel in ['src/app.js', 'sw.js', 'tests/cases.js', 'tests/mock_supabase.js', 'tests/runner.js']:
        try:
            esprima.parseScript(read(rel))
        except Exception as e:
            raise AssertionError(f'{rel}: {e}')


@check('src/app.js uses no name that is never declared (the "esc() is not defined" class of bug)')
def _():
    tree = esprima.parseScript(APP).toDict()
    declared, used = set(), set()

    def pattern(p):
        if not p:
            return
        t = p['type']
        if t == 'Identifier':
            declared.add(p['name'])
        elif t == 'ObjectPattern':
            for prop in p['properties']:
                pattern(prop.get('value') or prop.get('argument'))
        elif t == 'ArrayPattern':
            for el in p['elements']:
                pattern(el)
        elif t in ('AssignmentPattern',):
            pattern(p['left'])
        elif t == 'RestElement':
            pattern(p['argument'])

    def walk(n, parent=None, key=None):
        if isinstance(n, list):
            for x in n:
                walk(x, parent, key)
            return
        if not isinstance(n, dict) or 'type' not in n:
            return
        t = n['type']
        if t == 'VariableDeclarator':
            pattern(n['id'])
        elif t in ('FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'):
            if n.get('id'):
                declared.add(n['id']['name'])
            for p in n['params']:
                pattern(p)
        elif t == 'CatchClause':
            pattern(n.get('param'))
        elif t == 'Identifier':
            is_prop = parent and ((parent['type'] == 'MemberExpression' and key == 'property' and not parent.get('computed'))
                                  or (parent['type'] == 'Property' and key == 'key' and not parent.get('computed'))
                                  or parent['type'] in ('LabeledStatement', 'BreakStatement', 'ContinueStatement'))
            if not is_prop:
                used.add(n['name'])
        for k, v in n.items():
            if k != 'type' and isinstance(v, (dict, list)):
                walk(v, n, k)

    walk(tree)
    # typeof-guarded on purpose: an optional hook that does not exist
    unknown = sorted(used - declared - BROWSER_GLOBALS - {'scheduleSync'})
    assert not unknown, f'undeclared: {unknown}'


def load_recipes():
    src = read('src/data.js')
    m = re.match(r'\s*const RECIPES\s*=\s*(\[.*\]);\s*$', src, re.S)
    assert m, 'src/data.js is not exactly `const RECIPES = [...];`'
    return json.loads(m.group(1))


@check('src/data.js: curated recipes are valid JSON with sane, unique records')
def _():
    recipes = load_recipes()
    assert len(recipes) > 900, f'only {len(recipes)} recipes'
    ids = [r.get('id') for r in recipes]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    assert not dupes, f'duplicate ids: {dupes[:10]}'
    problems = []
    for r in recipes:
        rid = r.get('id')
        if not isinstance(rid, str) or not re.match(r'^[A-Za-z0-9_-]+$', rid):
            problems.append(f'{rid!r}: id must be letters/digits/-/_ (it is used in URLs and HTML attributes)')
        if not isinstance(r.get('title'), str) or not r['title'].strip():
            problems.append(f'{rid}: missing title')
        for f in ('ingredients', 'instructions'):
            v = r.get(f)
            if not isinstance(v, list) or not v or not all(isinstance(x, str) for x in v):
                problems.append(f'{rid}: {f} must be a non-empty list of strings')
        for f in ('tags', 'ingredientCore', 'ingredientAll', 'ingredientDietary'):
            if f in r and not (isinstance(r[f], list) and all(isinstance(x, str) for x in r[f])):
                problems.append(f'{rid}: {f} must be a list of strings')
        for f in ('category', 'cuisine'):
            if not isinstance(r.get(f), str) or not r[f]:
                problems.append(f'{rid}: {f} is required for curated recipes (rendered unguarded in the planner)')
        if 'addedDate' in r and not re.match(r'^\d{4}-\d{2}-\d{2}$', str(r['addedDate'])):
            problems.append(f'{rid}: addedDate {r["addedDate"]!r}')
    assert not problems, f'{len(problems)} problem(s): ' + '; '.join(problems[:8])


@check('seed cook-log entries point at recipes that exist')
def _():
    ids = {r['id'] for r in load_recipes()}
    seeds = re.findall(r'"recipeId":\s*"([^"]+)"', APP[:APP.index('/* ---------------- state layer')])
    missing = [s for s in seeds if s not in ids]
    assert not missing, f'unknown recipe ids in SEED_STATE: {missing}'


@check('HTML shell: tags balance, and no script is loaded from another site')
def _():
    html = HEAD + read('src/foot.html')
    body = re.sub(r'<!--.*?-->', '', html[html.index('</style>'):], flags=re.S)
    for tag in ('div', 'select', 'ul', 'main', 'button'):
        o, c = len(re.findall(rf'<{tag}[\s>]', body)), body.count(f'</{tag}>')
        assert o == c, f'<{tag}>: {o} opened, {c} closed'
    ext = re.findall(r'<script[^>]+src="(https?:[^"]+)"', html)
    assert not ext, f'external scripts: {ext} (vendor them: pinned, offline-capable, real error messages)'
    local = re.findall(r'<script[^>]+src="([^"]+)"', html)
    for src in local:
        assert (ROOT / src).is_file(), f'{src} is referenced but missing'


@check('service worker: every app-shell file exists, and every local script is in the shell')
def _():
    sw = read('sw.js')
    files = re.findall(r"'(\./[^']*)'", re.search(r'SHELL_FILES = \[(.*?)\];', sw, re.S).group(1))
    for f in files:
        assert f == './' or (ROOT / f[2:]).is_file(), f'{f} in SHELL_FILES does not exist (the worker would fail to install)'
    for src in re.findall(r'<script[^>]+src="([^"]+)"', HEAD):
        assert './' + src in files, f'{src} is not in SHELL_FILES -- the app would break offline'


@check('workflows: valid YAML, and their embedded Python compiles')
def _():
    for f in sorted(glob.glob(str(ROOT / '.github/workflows/*.yml'))):
        doc = yaml.safe_load(open(f))
        assert 'jobs' in doc, f'{f}: no jobs'
        for job in doc['jobs'].values():
            for step in job.get('steps', []):
                run = step.get('run') or ''
                for body in re.findall(r"<<'PYEOF'\n(.*?)\nPYEOF", run, re.S):
                    try:
                        compile(body, f, 'exec')
                    except SyntaxError as e:
                        raise AssertionError(f'{pathlib.Path(f).name}: embedded Python: {e}')


def fnv1a32(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return h


@check('static archive (data/archive): manifest, shards and detail buckets agree')
def _():
    arch = ROOT / 'data' / 'archive'
    if not arch.exists():
        print('        (skipped: data/archive not present)')
        return
    man = json.loads((arch / 'manifest.json').read_text())
    lite_cols = re.search(r"const NYT_LITE_COLUMNS = '([^']+)'", APP).group(1).split(',')
    keys = dict(re.findall(r"'([^']+)': '(\w+)',", APP[APP.index('const ARCHIVE_SOURCE_KEYS'):][:400]))
    assert sorted(keys.values()) == sorted(man['counts']), f'app sources {sorted(keys.values())} vs manifest {sorted(man["counts"])}'
    curated = {r['id'] for r in load_recipes()}
    seen, total = set(), 0
    for src, n in man['liteShards'].items():
        files = sorted(glob.glob(str(arch / 'lite' / f'{src}-*.json')))
        assert len(files) == n, f'{src}: {len(files)} shard files, manifest says {n}'
        rows = [r for f in files for r in json.load(open(f, encoding='utf-8'))]
        assert len(rows) == man['counts'][src], f'{src}: {len(rows)} rows, manifest says {man["counts"][src]}'
        for r in rows:
            assert list(r.keys()) == lite_cols, f'{src} {r.get("id")}: columns differ from NYT_LITE_COLUMNS in src/app.js'
            assert r['id'] not in seen, f'duplicate id {r["id"]}'
            assert not r['needs_review'], f'{r["id"]} is needs_review'
            assert isinstance(r['title'], str) and r['title'], f'{r["id"]}: no title'
            seen.add(r['id'])
        total += len(rows)
    assert total == man['total'], f'{total} rows vs manifest total {man["total"]}'
    clash = seen & curated
    assert not clash, f'archive ids shadowed by a curated recipe with the same id (rebuild with tools/build_archive_data.py): {sorted(clash)}'
    buckets = man['detailBuckets']
    assert len(glob.glob(str(arch / 'detail' / '*.json'))) == buckets, 'detail bucket count'
    found = set()
    for b in range(buckets):
        d = json.load(open(arch / 'detail' / f'{b}.json', encoding='utf-8'))
        for rid, v in d.items():
            assert fnv1a32(rid) % buckets == b, f'{rid} is in bucket {b}, the app will look in {fnv1a32(rid) % buckets}'
            assert isinstance(v.get('ingredients'), list) and isinstance(v.get('instructions'), list), f'{rid}: detail shape'
            assert v.get('s') in man['counts'], f'{rid}: detail entry has no valid source key (links to unloaded recipes need it)'
        found |= set(d)
    assert found == seen, f'{len(seen - found)} recipes have no detail text; {len(found - seen)} orphan details'
    # text cleanliness: the app shows these strings as-is, so leftover markup / entities / control characters would be visible
    tag, ent, ctrl = re.compile(r'</?[A-Za-z][^<>]*>'), re.compile(r'&(#x?[0-9A-Fa-f]+|[A-Za-z]+);'), re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')
    dirty = []
    for b in range(buckets):
        for rid, v in json.load(open(arch / 'detail' / f'{b}.json', encoding='utf-8')).items():
            for text in (v.get('ingredients') or []) + (v.get('instructions') or []) + [v.get('notes') or '']:
                if tag.search(text) or ent.search(text) or ctrl.search(text) or text != text.strip():
                    dirty.append((rid, text[:60]))
    assert not dirty, f'{len(dirty)} archive text line(s) with leftover markup/entities/control characters (re-run tools/build_archive_data.py), e.g. {dirty[:3]}'
    for src, n in man['counts'].items():
        idx = json.load(open(arch / 'search' / f'{src}.json', encoding='utf-8'))
        assert len(idx['w']) == len(idx['p']) and idx['w'] == sorted(idx['w']), f'search/{src}: words and row lists out of step'
        top = max((sum(d) for d in idx['p']), default=0)
        assert top < n, f'search/{src}: refers to row {top} but the source has {n} rows'


print()
print(f'static checks: {passed} passed, {len(failures)} failed')
sys.exit(1 if failures else 0)
