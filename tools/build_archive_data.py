#!/usr/bin/env python3
"""Builds the static archive (NYT / Epicurious / BBC / Other) served by GitHub Pages.

The ~60k-row bulk archive used to be read live from the Supabase `nyt_recipes`
table. It never changes, so it now ships as static JSON next to index.html and
the app no longer touches Supabase for it. Source of truth for the rebuild is the
lossless snapshot in backups/nyt_recipes/ (all columns, incl. needs_review rows).

Output (data/archive/):
  manifest.json        {version, counts{source: n}, liteShards{source: k}, detailBuckets}
  lite/<src>-<i>.json  card columns (NYT_LITE_COLUMNS in src/app.js), needs_review=false
  detail/<b>.json      {id: {ingredients, instructions, notes}} for ids whose
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
import collections, glob, hashlib, json, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / 'backups' / 'nyt_recipes'
OUT = ROOT / 'data' / 'archive'
LITE_COLS = ('id,title,category,cuisine,source,servings,needs_review,total_time,cook_time,'
             'prep_time,tags,ingredient_core,ingredient_all,ingredient_dietary,ahead_label,'
             'ahead_minutes,kcal,protein,carbs,fat').split(',')
DETAIL_COLS = ('ingredients', 'instructions', 'notes')
DETAIL_BUCKETS = 512
LITE_SHARD_ROWS = 5000
SOURCES = ('nyt', 'epicurious', 'bbc', 'other')
# MUST match the tokenizer in runArchiveSearch() in src/app.js
WORD_RE = re.compile(r"[a-z][a-z'\-]{2,}")


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

    if OUT.exists():
        shutil.rmtree(OUT)
    counts, shards = {}, {}
    for src in SOURCES:
        part = [r for r in rows if r['archive_source'] == src]
        counts[src] = len(part)
        n = 0
        for i in range(0, len(part), LITE_SHARD_ROWS):
            dump(OUT / 'lite' / f'{src}-{n}.json', [{c: r.get(c) for c in LITE_COLS} for r in part[i:i + LITE_SHARD_ROWS]])
            n += 1
        shards[src] = n
        dump(OUT / 'search' / f'{src}.json', search_index(part))
    if sum(counts.values()) != len(rows):
        sys.exit(f'unknown archive_source values: {len(rows)} rows, {sum(counts.values())} bucketed')

    buckets = [dict() for _ in range(DETAIL_BUCKETS)]
    for r in rows:
        buckets[fnv1a32(r['id']) % DETAIL_BUCKETS][r['id']] = {c: r.get(c) for c in DETAIL_COLS}
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
