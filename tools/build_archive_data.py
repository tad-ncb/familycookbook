#!/usr/bin/env python3
"""Builds the static archive (NYT / Epicurious / BBC / Other) served by GitHub Pages.

The ~60k-row bulk archive used to be read live from the Supabase `nyt_recipes`
table. It never changes, so it now ships as static JSON next to index.html and
the app no longer touches Supabase for it. Source of truth for the rebuild is the
lossless snapshot (all columns, incl. needs_review rows), kept on the `snapshots` branch --
see find_snapshot() below for how it is located.

Output (data/archive/):
  manifest.json        {version, counts{source: n}, liteShards{source: k}, detailBuckets}
  lite/<src>-<i>.json  card columns (NYT_LITE_COLUMNS in src/app.js), needs_review=false
  detail/<b>.json      {id: {ingredients, instructions, notes, s}} (s = source key, so a
                       link to a recipe can find which source to load) for ids whose
                       fnv1a32(id) % detailBuckets == b
  search/<src>.json    {w: [word...], p: [[delta-encoded row numbers]...]} -- which
                       rows of that source (numbered in lite order) have each word
                       in their ingredient lines. Lets the app search ingredient
                       text of recipes it hasn't downloaded the full text for.

An archive row whose id is already used by a curated recipe (src/data.js) would
never be shown -- the curated one wins. Those are different dishes that happen to
share a name, so they are kept under "<id>-<source>" instead.

The bucket hash MUST match detailBucket() in src/app.js.
"""
import collections, glob, hashlib, html, json, os, pathlib, re, shutil, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import infer_archive_meta

ROOT = pathlib.Path(__file__).resolve().parent.parent
def find_snapshot():
    """The frozen snapshot lives on the `snapshots` branch (so it is not redeployed with the site).
       One-time:  git worktree add ../familycookbook-snapshots snapshots
       or pass   --snapshot DIR   or set   SNAPSHOT_DIR."""
    if '--snapshot' in sys.argv:
        return pathlib.Path(sys.argv[sys.argv.index('--snapshot') + 1])
    if os.environ.get('SNAPSHOT_DIR'):
        return pathlib.Path(os.environ['SNAPSHOT_DIR'])
    for cand in (ROOT / 'backups' / 'nyt_recipes', ROOT.parent / 'familycookbook-snapshots'):
        if (cand / '_count.txt').exists():
            return cand
    sys.exit('snapshot not found. Run:  git worktree add ../familycookbook-snapshots snapshots   (or pass --snapshot DIR)')


SRC_DIR = find_snapshot()
OUT = ROOT / 'data' / 'archive'
LITE_COLS = ('id,title,category,cuisine,source,servings,needs_review,total_time,cook_time,'
             'prep_time,tags,ingredient_core,ingredient_all,ingredient_dietary,ahead_label,'
             'ahead_minutes,kcal,protein,carbs,fat,servings_est').split(',')   # servings_est: 1 = servings was estimated, not in the source
DETAIL_COLS = ('ingredients', 'instructions', 'notes')
DETAIL_BUCKETS = 512
LITE_SHARD_ROWS = 5000
SOURCES = ('nyt', 'epicurious', 'bbc', 'other')
# MUST match the tokenizer in runArchiveSearch() in src/app.js
WORD_RE = re.compile(r"[a-z][a-z'\-]{2,}")


# Misspelt entities seen in the scraped text (html.unescape leaves these alone)
ENTITY_FIXES = {
    '&eauce;': '\u00e9', '&eaacute;': '\u00e9', '&eucate;': '\u00e9', '&e;': '\u00e9', '&until;': '\u00e9 until',
    '&nitilde;': '\u00f1', '&entilde;': '\u00f1', '&ircirc;': '\u00ee',
    '&Deg;': '\u00b0', '&def;': '\u00b0',
    # "M&M's" / "S&B" / "s&p" were mangled into "&M;" style by an earlier HTML pass
    '&M;': '&M', '&B;': '&B', '&p;': '&p',
}
TAG_RE = re.compile(r'</?[A-Za-z][^<>]*>')          # leftover markup such as <epi recipelink="" id="123">
CTRL_RE = re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')


def clean(v):
    """Scraped text arrives with stray markup, HTML entities the app would show literally
    (425&deg;F, pur&eacute;e), control characters and ragged whitespace."""
    if not isinstance(v, str):
        return v
    for bad, good in ENTITY_FIXES.items():
        v = v.replace(bad, good)
    v = html.unescape(v)
    v = TAG_RE.sub('', v)
    v = CTRL_RE.sub('', v)
    return re.sub(r'[ \t]{2,}', ' ', v).strip()


def clean_list(v):
    return [clean(x) for x in v] if isinstance(v, list) else v


def curated_ids():
    src = (ROOT / 'src' / 'data.js').read_text(encoding='utf-8')
    m = re.match(r'\s*const RECIPES\s*=\s*(\[.*\]);\s*$', src, re.S)
    return {r['id'] for r in json.loads(m.group(1))}


def search_index(part):
    post = collections.defaultdict(list)
    for i, r in enumerate(part):
        for w in sorted(set(WORD_RE.findall(' '.join(r.get('ingredients') or []).lower()))):
            post[w].append(i)
    words = sorted(post)
    return {'w': words, 'p': [[ids[0]] + [b - a for a, b in zip(ids, ids[1:])] for ids in (post[w] for w in words)]}


def fnv1a32(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return h


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def main():
    rows = []
    for f in sorted(glob.glob(str(SRC_DIR / 'part-*.json'))):
        rows += json.load(open(f, encoding='utf-8'))
    expected = int((SRC_DIR / '_count.txt').read_text().strip())
    if len(rows) != expected:
        sys.exit(f'snapshot has {len(rows)} rows but _count.txt says {expected}')
    rows = [r for r in rows if not r['needs_review']]
    for r in rows:
        for k in ('title', 'notes'):
            r[k] = clean(r.get(k))
        for k in ('ingredients', 'instructions'):
            r[k] = clean_list(r.get(k))
    # a recipe with no ingredient lines is unusable (nothing to cook, scale or shop for)
    n_before = len(rows)
    rows = [r for r in rows if r.get('ingredients')]
    print(f'dropped {n_before - len(rows)} recipes with no ingredients')
    curated = curated_ids()
    taken = curated | {r['id'] for r in rows}
    renamed = []
    for r in rows:
        if r['id'] in curated:
            new = f"{r['id']}-{r['archive_source']}"
            if new in taken:
                sys.exit(f'cannot rename {r["id"]}: {new} is taken too')
            renamed.append((r['id'], new))
            taken.add(new)
            r['id'] = new
    rows.sort(key=lambda r: r['id'])
    ids = [r['id'] for r in rows]
    if len(set(ids)) != len(ids):
        sys.exit('duplicate ids in snapshot')

    # fill in servings / macros / cuisine the sources left out (see tools/infer_archive_meta.py)
    lite_all = [{c: r.get(c) for c in LITE_COLS if c != 'servings_est'} for r in rows]
    if '--no-infer' in sys.argv or sys.platform != 'darwin':
        print('skipping inference (needs macOS and no --no-infer)')
        for l in lite_all: l['servings_est'] = 0
    else:
        print('\n'.join(infer_archive_meta.apply(lite_all, {r['id']: {'ingredients': r['ingredients']} for r in rows})))
    lite_by_id = {l['id']: l for l in lite_all}

    if OUT.exists():
        shutil.rmtree(OUT)
    counts, shards = {}, {}
    for src in SOURCES:
        part = [r for r in rows if r['archive_source'] == src]
        counts[src] = len(part)
        n = 0
        for i in range(0, len(part), LITE_SHARD_ROWS):
            dump(OUT / 'lite' / f'{src}-{n}.json', [{c: lite_by_id[r['id']].get(c) for c in LITE_COLS} for r in part[i:i + LITE_SHARD_ROWS]])
            n += 1
        shards[src] = n
        dump(OUT / 'search' / f'{src}.json', search_index(part))
    if sum(counts.values()) != len(rows):
        sys.exit(f'unknown archive_source values: {len(rows)} rows, {sum(counts.values())} bucketed')

    buckets = [dict() for _ in range(DETAIL_BUCKETS)]
    for r in rows:
        buckets[fnv1a32(r['id']) % DETAIL_BUCKETS][r['id']] = {**{c: r.get(c) for c in DETAIL_COLS}, 's': r['archive_source']}
    for b, d in enumerate(buckets):
        dump(OUT / 'detail' / f'{b}.json', d)

    h = hashlib.sha1()
    for p in sorted(OUT.rglob('*.json')):
        h.update(p.read_bytes())
    dump(OUT / 'manifest.json', {'version': h.hexdigest()[:10], 'counts': counts, 'liteShards': shards,
                                 'detailBuckets': DETAIL_BUCKETS, 'total': len(rows)})
    print('rows', len(rows), counts, shards)
    print('renamed (id shared with a curated recipe):', renamed)


if __name__ == '__main__':
    main()
