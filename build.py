#!/usr/bin/env python3
"""Rebuilds index.html from the src/ files.

index.html is one file because GitHub Pages here serves it directly from the
repo (classic Pages, no build step of its own) -- but a 2.3MB/63k-line single
file makes every fix a manual grep/sed line-range extraction. Splitting the
source into src/head.html (doctype/head/style/static markup + the Supabase
CDN <script> tag), src/data.js (the embedded RECIPES array + its precompute
pass), src/app.js (the rest of the app logic), and src/foot.html
(</body></html>) keeps editing sane while keeping the deployed artifact a
single file. .github/workflows/build.yml runs this on every push to main and
commits the result if it changed.

Do not edit index.html directly -- edit the matching src/ file and run this
script (or push; CI does it for you). A direct edit to index.html will be
silently overwritten by the next push that touches src/.
"""
import pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'src'

def read(name):
    return (SRC / name).read_text(encoding='utf-8')

def main():
    head = read('head.html')
    data = read('data.js')
    app = read('app.js')
    foot = read('foot.html')
    out = head + '<script>\n' + data + '</script>\n' + '<script>\n' + app + '</script>\n' + foot
    (ROOT / 'index.html').write_text(out, encoding='utf-8')
    print(f"wrote index.html ({len(out)} chars)")

if __name__ == '__main__':
    main()
