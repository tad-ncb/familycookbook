#!/usr/bin/env python3
"""Creates a random write key for each household and prints (1) the SQL that stores only the SHA-256
hashes, and (2) each household's personal link. See migrations/017_household_keys.sql for the steps.

    python3 tools/make_household_keys.py              # new random keys
    python3 tools/make_household_keys.py --reuse FILE # print links again for keys saved earlier

The keys are shown only here -- keep this output (it is the only place the plain keys exist). Nothing is
written to disk or sent anywhere unless you redirect the output yourself."""
import hashlib, json, re, secrets, sys

HOUSEHOLDS = ['nicholas-tyler', 'chris-jen', 'craig-kelly']   # keep in step with HOUSEHOLD_LABEL in src/app.js
SITE = 'https://tad-ncb.github.io/familycookbook/'

def sql_for(keys):
    rows = ',\n  '.join(f"('{h}', '{hashlib.sha256(k.encode()).hexdigest()}')" for h, k in keys.items())
    return ("insert into household_keys (household_id, key_hash) values\n  " + rows +
            "\non conflict (household_id) do update set key_hash = excluded.key_hash;")

def main():
    if '--reuse' in sys.argv:
        keys = json.load(open(sys.argv[sys.argv.index('--reuse') + 1]))
    else:
        keys = {h: secrets.token_urlsafe(18) for h in HOUSEHOLDS}
    print('-- 1) run this in the Supabase SQL editor (after migrations/017):\n')
    print(sql_for(keys))
    print('\n-- 2) send each household its own link (opening it once saves the key on that device):\n')
    for h, k in keys.items():
        print(f'{h}: {SITE}?hh={h}&k={k}')
    print('\n-- 3) keep this output; the plain keys are not stored anywhere else.')

if __name__ == '__main__':
    main()
