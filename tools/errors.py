#!/usr/bin/env python3
"""Shows what the app has been logging to the client_errors table, grouped.

    python3 tools/errors.py [days] [--fail-if-any]      (default: last 30 days)

--fail-if-any exits with an error when there is anything to look at (used by the weekly digest workflow, so
GitHub emails you); test rows and errors from local/file:// runs are ignored.

Read-only, via the public REST API with the same anon key the site itself
ships. Each group shows how often, which households, when it last happened,
and the first line of the stack (file:line) so it can be found in src/app.js.
"""
import collections, datetime, json, pathlib, re, sys, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
app = (ROOT / 'src' / 'app.js').read_text(encoding='utf-8')
URL = re.search(r"const SUPABASE_URL = '([^']+)'", app).group(1)
KEY = re.search(r"const SUPABASE_ANON_KEY = '([^']+)'", app).group(1)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
days = int(args[0]) if args else 30
since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
q = urllib.parse.urlencode({'select': '*', 'created_at': f'gte.{since}', 'order': 'created_at.desc', 'limit': '5000'})
req = urllib.request.Request(f'{URL}/rest/v1/client_errors?{q}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
try:
    rows = json.load(urllib.request.urlopen(req, timeout=30))
except Exception as e:
    sys.exit(f'could not read client_errors ({e}) -- is the Supabase project paused?')

if '--fail-if-any' in sys.argv:
    rows = [r for r in rows if r.get('household_id') != 'test' and not str(r.get('url') or '').startswith(('file:', 'http://127.', 'http://localhost'))]

groups = collections.defaultdict(list)
for r in rows:
    first = next((ln.strip() for ln in (r.get('stack') or '').splitlines() if ln.strip()), '')
    groups[(r.get('message') or '', first)].append(r)
print(f'{len(rows)} error(s) in the last {days} days, {len(groups)} distinct\n')
for (msg, first), rs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
    hh = collections.Counter(r.get('household_id') or '?' for r in rs)
    print(f'{len(rs):4d}x  {msg[:160]}')
    if first:
        print(f'       at {first[:160]}')
    print(f'       last {rs[0]["created_at"][:16]}  first {rs[-1]["created_at"][:16]}  ' + ', '.join(f'{h} {n}' for h, n in hh.most_common()))
    if msg == 'Script error.':
        print('       (no detail: thrown inside a script served from another site. The sync library is now'
              '\n        served from this site, so new occurrences will carry a real message and stack.)')
    print()
if '--fail-if-any' in sys.argv and rows:
    sys.exit(f'{len(rows)} client error(s) in the last {days} days -- see above')
